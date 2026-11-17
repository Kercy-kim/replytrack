import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { CaseStore } from './src/store.mjs';
import { OpenAIClient } from './src/openai.mjs';
import { ReplyTrack } from './src/service.mjs';
import { AppError, assert } from './src/errors.mjs';
import { Operations, checkpoint } from './src/operation.mjs';
import { OfficialContext, officialKey } from './src/official-context.mjs';
import { hostingConfig, createRequestGuard } from './src/hosting.mjs';
import { connectPostgres } from './src/postgres.mjs';
import { readSession, sessionCookie } from './src/accounts.mjs';
import { randomUUID } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);
staticFiles.set('/workspace.js', ['workspace.js', 'text/javascript']);
staticFiles.set('/operations.js', ['operations.js', 'text/javascript']);
staticFiles.set('/onboarding.js', ['onboarding.js', 'text/javascript']);
staticFiles.set('/email.js', ['email.js', 'text/javascript']);
staticFiles.set('/email-demo.js', ['email-demo.js', 'text/javascript']);
staticFiles.set('/presentation', ['presentation.html', 'text/html']);
staticFiles.set('/presentation.js', ['presentation.js', 'text/javascript']);
staticFiles.set('/presentation-view.js', ['presentation-view.js', 'text/javascript']);
staticFiles.set('/presentation.css', ['presentation.css', 'text/css']);
staticFiles.set('/presentation-data.json', ['presentation-data.json', 'application/json']);
staticFiles.set('/next-actions.js', ['next-actions.js', 'text/javascript']);
staticFiles.set('/inquiry-overview.js', ['inquiry-overview.js', 'text/javascript']);
staticFiles.set('/official-context.js', ['official-context.js', 'text/javascript']);
staticFiles.set('/draft-scope.js', ['draft-scope.js', 'text/javascript']);
staticFiles.set('/login', ['login.html', 'text/html']);
staticFiles.set('/login.js', ['login.js', 'text/javascript']);
staticFiles.set('/login.css', ['login.css', 'text/css']);
const publicAssets = new Set(['/login', '/login.js', '/login.css', '/styles.css', '/favicon.svg']);

export function createApp({ store, ai, ocr, faq, official, database, hosting = hostingConfig() } = {}) {
  const guard = createRequestGuard({ ...hosting, sessionAuth: !!database });
  const db = store ?? (database ? database.forUser('no-session') : new CaseStore(resolve(root, process.env.REPLYTRACK_DATA_DIR || 'data', 'replytrack.sqlite')));
  const client = ai ?? new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  const service = new ReplyTrack(db, client, { ocr, faq });
  const operations = new Operations({ queue: !!database });
  const users = new Map();
  const userContext = user => {
    if (!users.has(user.id)) {
      if (users.size >= 100) users.delete(users.keys().next().value);
      const store = database.forUser(user.id);
      users.set(user.id, { store, service: new ReplyTrack(store, client, { ocr, faq }) });
    }
    return users.get(user.id);
  };
  const officialContext = official ?? new OfficialContext({ ai: client, ...(faq ? { faq } : {}) });
  const officialStarts = new Map();
  let officialAdmission = Promise.resolve();
  const guestCleanup = database ? setInterval(() => database.accounts.purgeExpiredGuests().catch(() => console.error('Guest cleanup deferred.')), 60 * 60 * 1000) : null;
  guestCleanup?.unref();
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const port = server.address()?.port;
      const path = guard(req, res, port);
      if (path === null) return;
      const method = req.method;
      if (method === 'GET' && path === '/api/health') return json({ ok: true, app: 'ReplyTrack' });
      const sessionToken = database ? readSession(req) : null;
      const user = database ? await database.accounts.authenticate(sessionToken) : null;
      if (method === 'GET' && path === '/api/auth/me') return json({ enabled: !!database, user, ...(user ? { usage: await database.accounts.usage(user) } : {}) });
      const loginRequest = method === 'POST' && ['/api/auth/login', '/api/auth/register', '/api/auth/guest'].includes(path);
      if (database && !user && !loginRequest && !publicAssets.has(path)) {
        if (!path.startsWith('/api/') && method === 'GET') { res.writeHead(303, { Location: '/login' }); return res.end(); }
        throw new AppError(401, '로그인이 필요합니다.', 'LOGIN_REQUIRED');
      }
      if (database && ['POST','PUT','PATCH','DELETE'].includes(method)) {
        assert(req.headers.origin === (hosting.publicOrigin || `http://${req.headers.host}`), '이 요청의 출처를 허용하지 않습니다.', 403);
      }
      const current = database && user ? userContext(user) : { service, store: db };
      const currentService = current.service, currentStore = current.store;
      const owner = user?.id || 'local';
      const adminOnly = () => assert(!database || user?.role === 'admin', '관리자만 사용할 수 있어요.', 403);
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        assert(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON 요청만 지원합니다.', 415);
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; assert(size <= (path.startsWith('/api/auth/') ? 8192 : 6 * 1024 * 1024), '업로드 용량이 너무 큽니다.', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new AppError(400, '요청 내용을 읽을 수 없습니다.'); }
        assert(body && typeof body === 'object' && !Array.isArray(body), '요청 형식을 확인해 주세요.');
      }
      if (database && loginRequest) {
        if (path.endsWith('/guest') && user) return json({ user });
        const guest = user?.role === 'guest' ? { id:user.id, token:sessionToken } : undefined;
        if (guest) assert(![...operations.jobs.values()].some(j => j.owner === user.id && (j.state === 'running' || j.committing)), '진행 중인 작업이 있어요. 완료한 뒤 계정을 연결해 주세요.', 409);
        const result = path.endsWith('/guest') ? await database.accounts.startGuest()
          : path.endsWith('/login') ? await database.accounts.login(body, guest) : await database.accounts.register(body, guest);
        await database.accounts.logout(sessionToken);
        if (guest) users.delete(user.id);
        res.setHeader('Set-Cookie', sessionCookie(result.token, !!hosting.publicOrigin));
        return json({ user: result.user }, path.endsWith('/register') ? 201 : 200);
      }
      if (database && method === 'POST' && path === '/api/auth/logout') {
        operations.cancelOwner(owner);
        if (user?.role === 'guest') {
          await Promise.all([...operations.jobs.values()].filter(j => j.owner === owner && j.committing).map(j => j.done));
          await database.accounts.endGuest({ id:user.id, token:sessionToken }); users.delete(user.id);
        } else await database.accounts.logout(sessionToken);
        res.setHeader('Set-Cookie', sessionCookie('', !!hosting.publicOrigin, true));
        return json({ ok: true });
      }
      if (method === 'GET' && path === '/api/config') return json({ ...currentService.config(), managed: !!database && user?.role !== 'admin' });
      if (method === 'PUT' && path === '/api/config') {
        adminOnly(); const config = service.configure(body);
        for (const context of users.values()) { context.service.configRevision++; context.service.connection = { state: 'unchecked', checkedAt: null }; }
        return json(config);
      }
      if (method === 'POST' && path === '/api/operations') {
        const { id, kind, caseId, input = {} } = body;
        assert(['preflight', 'prepare', 'extract', 'analyze', 'draft', 'actions', 'email-explanation'].includes(kind), '작업 종류를 확인해 주세요.');
        assert(input && typeof input === 'object' && !Array.isArray(input), '작업 입력을 확인해 주세요.');
        if (kind === 'draft') assert(input.kind === 'followup', '현재는 남은 질문의 재문의 초안만 작성할 수 있어요.');
        // Do optimistic-version validation before spending any provider tokens.
        const record = ['analyze', 'draft', 'actions', 'email-explanation'].includes(kind) ? await currentService.getVersion(caseId, input.version) : null;
        if (kind === 'extract' && input.caseId) await currentService.getVersion(input.caseId, input.version);
        operations.validateStart(id, owner);
        return json(operations.start(id, async context => {
          if (database && kind !== 'prepare') await database.accounts.recordOperation(user, id);
          checkpoint(context);
          if (kind === 'preflight') return currentService.preflight(context);
          if (kind === 'prepare') return currentService.prepare(input, context);
          if (record?.mode !== 'demo') await currentService.ensureConnection(context);
          checkpoint(context);
          if (kind === 'extract') return currentService.extract(input, context);
          if (kind === 'analyze') return currentService.analyze(caseId, input.version, context);
          if (kind === 'actions') return currentService.actions(caseId, input.version, context);
          if (kind === 'email-explanation') return currentService.explainEmail(caseId, input.version, context);
          return currentService.draft(caseId, input, context);
        }, owner, kind === 'prepare' && input.image ? 'ocr' : 'general'), 202);
      }
      const operation = path.match(/^\/api\/operations\/([\w-]+)$/);
      if (operation && method === 'GET') return json(operations.get(operation[1], owner));
      if (operation && method === 'DELETE') return json(operations.cancel(operation[1], owner));
      if (method === 'GET' && path === '/api/cases') return json(await currentStore.list());
      if (method === 'POST' && path === '/api/cases') return json(await currentService.create(body), 201);
      if (method === 'POST' && path === '/api/demo') { adminOnly(); return json(await currentService.demo(body), 201); }
      if (method === 'POST' && path === '/api/extract') { assert(!database, '진행 상태가 있는 작업 요청을 사용해 주세요.', 400); return json(await currentService.extract(body)); }
      const officialMatch = path.match(/^\/api\/cases\/([\w-]+)\/official-context$/);
      if (officialMatch && ['GET', 'POST'].includes(method)) {
        const c = await currentStore.get(officialMatch[1]);
        if (database && method === 'POST') {
          const key = officialKey(c);
          if (!officialStarts.has(key)) {
            const start = officialAdmission.then(async () => {
              if (officialContext.shouldStart(c)) await database.accounts.recordOperation(user, randomUUID());
              return officialContext.start(c);
            });
            // Count only after a slot/cache decision that cannot race another
            // case's admission; omitted work must not inflate usage.
            officialAdmission = start.catch(() => {});
            officialStarts.set(key, start);
            start.finally(() => officialStarts.delete(key)).catch(() => {});
          }
          return json(await officialStarts.get(key));
        }
        return json(method === 'POST' ? officialContext.start(c) : officialContext.entries.get(officialKey(c))?.result ?? { key: officialKey(c), state: 'omitted' });
      }
      const match = path.match(/^\/api\/cases\/([\w-]+)(?:\/(analyze|messages|email-messages|questions|promises|drafts|actions|demo-next)(?:\/([\w-]+))?)?$/);
      if (match) {
        const [, id, action, item] = match;
        if (!action && method === 'GET') return json(await currentStore.get(id));
        if (!action && method === 'PATCH') return json(await currentService.metadata(id, body));
        if (!action && method === 'DELETE') { await currentService.getVersion(id, body.version); await currentStore.delete(id, body.version); return json({ deleted: true }); }
        if (action === 'analyze' && method === 'POST') { assert(!database, '진행 상태가 있는 작업 요청을 사용해 주세요.', 400); return json(await currentService.analyze(id, body.version)); }
        if (action === 'messages' && method === 'POST') return json(await currentService.append(id, body));
        if (action === 'email-messages' && method === 'POST') return json(await currentService.appendEmail(id, body));
        if (action === 'demo-next' && method === 'POST') { adminOnly(); return json(await currentService.advance(id, body.version)); }
        if (action === 'questions' && item && method === 'PATCH') return json(await currentService.question(id, item, body));
        if (action === 'promises' && item && method === 'PATCH') return json(await currentService.promise(id, item, body));
        if (action === 'actions' && item && method === 'PATCH') return json(await currentService.completeAction(id, item, body));
        if (action === 'drafts' && method === 'POST') { assert(!database, '진행 상태가 있는 작업 요청을 사용해 주세요.', 400); return json(await currentService.draft(id, body)); }
        if (action === 'drafts' && item && method === 'PATCH') return json(await currentService.saveDraft(id, item, body));
      }
      if (method === 'GET' && staticFiles.has(path)) {
        const [file, mime] = staticFiles.get(path);
        const content = await readFile(join(root, 'public', file));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); return res.end(content);
      }
      throw new AppError(404, '요청한 페이지를 찾을 수 없습니다.');
    } catch (error) {
      // No payload, headers, conversation text, or API credentials in logs.
      const status = error instanceof AppError ? error.status : 500;
      if (status === 500) console.error('Request failed:', error.name);
      if (!res.headersSent) json({ error: status === 500 ? '요청을 처리하지 못했습니다. 저장된 기록을 다시 불러와 주세요.' : error.message, code: error.code || 'REQUEST_ERROR' }, status);
      else res.end();
    }
  });
  server.requestTimeout = 120000;
  server.on('close', () => { clearInterval(guestCleanup); operations.close(); officialContext.close(); });
  return { server, service, store: db, ai: client, operations, database };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosting = hostingConfig();
  const database = process.env.DATABASE_URL ? await connectPostgres(process.env.DATABASE_URL, process.env.REPLYTRACK_DEMO_PASSWORD) : null;
  const app = createApp({ hosting, database });
  const port = Number(process.env.PORT || 3100);
  app.server.listen(port, hosting.bindHost, () => console.log(`ReplyTrack: ${hosting.publicOrigin || `http://127.0.0.1:${port}`}`));
  app.server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Server could not start.'); process.exitCode = 1; });
  if (process.argv.includes('--key-stdin')) {
    // Raw input disables terminal echo; credentials never enter shell history.
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    const lines = createInterface({ input: process.stdin, terminal: false });
    process.stdin.on('data', chunk => { if (chunk.includes(3)) stop(); });
    lines.on('line', line => {
      try { app.ai.configure(JSON.parse(line)); console.log('AI credentials configured in memory.'); }
      catch { console.log('AI credential configuration failed.'); }
    });
  }
  const stop = () => { app.operations.close(); app.server.close(async () => { await database?.close(); app.store.close(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
