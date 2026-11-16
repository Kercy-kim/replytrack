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

export function createApp({ store, ai, ocr, faq, official, hosting = hostingConfig() } = {}) {
  const guard = createRequestGuard(hosting);
  const db = store ?? new CaseStore(resolve(root, process.env.REPLYTRACK_DATA_DIR || 'data', 'replytrack.sqlite'));
  const client = ai ?? new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  const service = new ReplyTrack(db, client, { ocr, faq });
  const operations = new Operations();
  const officialContext = official ?? new OfficialContext({ ai: client, ...(faq ? { faq } : {}) });
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
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        assert(req.headers['content-type']?.split(';')[0] === 'application/json', 'JSON 요청만 지원합니다.', 415);
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; assert(size <= 6 * 1024 * 1024, '업로드 용량이 너무 큽니다.', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new AppError(400, '요청 내용을 읽을 수 없습니다.'); }
        assert(body && typeof body === 'object' && !Array.isArray(body), '요청 형식을 확인해 주세요.');
      }
      if (method === 'GET' && path === '/api/health') return json({ ok: true, app: 'ReplyTrack' });
      if (method === 'GET' && path === '/api/config') return json(service.config());
      if (method === 'PUT' && path === '/api/config') return json(service.configure(body));
      if (method === 'POST' && path === '/api/operations') {
        const { id, kind, caseId, input = {} } = body;
        assert(['preflight', 'prepare', 'extract', 'analyze', 'draft', 'actions', 'email-explanation'].includes(kind), '작업 종류를 확인해 주세요.');
        assert(input && typeof input === 'object' && !Array.isArray(input), '작업 입력을 확인해 주세요.');
        if (kind === 'draft') assert(input.kind === 'followup', '현재는 남은 질문의 재문의 초안만 작성할 수 있어요.');
        // Do optimistic-version validation before spending any provider tokens.
        const record = ['analyze', 'draft', 'actions', 'email-explanation'].includes(kind) ? service.getVersion(caseId, input.version) : null;
        return json(operations.start(id, async context => {
          if (kind === 'preflight') return service.preflight(context);
          if (kind === 'prepare') return service.prepare(input, context);
          if (record?.mode !== 'demo') await service.ensureConnection(context);
          checkpoint(context);
          if (kind === 'extract') return service.extract(input, context);
          if (kind === 'analyze') return service.analyze(caseId, input.version, context);
          if (kind === 'actions') return service.actions(caseId, input.version, context);
          if (kind === 'email-explanation') return service.explainEmail(caseId, input.version, context);
          return service.draft(caseId, input, context);
        }), 202);
      }
      const operation = path.match(/^\/api\/operations\/([\w-]+)$/);
      if (operation && method === 'GET') return json(operations.get(operation[1]));
      if (operation && method === 'DELETE') return json(operations.cancel(operation[1]));
      if (method === 'GET' && path === '/api/cases') return json(db.list());
      if (method === 'POST' && path === '/api/cases') return json(service.create(body), 201);
      if (method === 'POST' && path === '/api/demo') return json(service.demo(body), 201);
      if (method === 'POST' && path === '/api/extract') return json(await service.extract(body));
      const officialMatch = path.match(/^\/api\/cases\/([\w-]+)\/official-context$/);
      if (officialMatch && ['GET', 'POST'].includes(method)) {
        const c = db.get(officialMatch[1]);
        return json(method === 'POST' ? officialContext.start(c) : officialContext.entries.get(officialKey(c))?.result ?? { key: officialKey(c), state: 'omitted' });
      }
      const match = path.match(/^\/api\/cases\/([\w-]+)(?:\/(analyze|messages|email-messages|questions|promises|drafts|actions|demo-next)(?:\/([\w-]+))?)?$/);
      if (match) {
        const [, id, action, item] = match;
        if (!action && method === 'GET') return json(db.get(id));
        if (!action && method === 'PATCH') return json(service.metadata(id, body));
        if (!action && method === 'DELETE') { service.getVersion(id, body.version); db.delete(id, body.version); return json({ deleted: true }); }
        if (action === 'analyze' && method === 'POST') return json(await service.analyze(id, body.version));
        if (action === 'messages' && method === 'POST') return json(service.append(id, body));
        if (action === 'email-messages' && method === 'POST') return json(service.appendEmail(id, body));
        if (action === 'demo-next' && method === 'POST') return json(service.advance(id, body.version));
        if (action === 'questions' && item && method === 'PATCH') return json(service.question(id, item, body));
        if (action === 'promises' && item && method === 'PATCH') return json(service.promise(id, item, body));
        if (action === 'actions' && item && method === 'PATCH') return json(service.completeAction(id, item, body));
        if (action === 'drafts' && method === 'POST') return json(await service.draft(id, body));
        if (action === 'drafts' && item && method === 'PATCH') return json(service.saveDraft(id, item, body));
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
  server.on('close', () => { operations.close(); officialContext.close(); });
  return { server, service, store: db, ai: client, operations };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosting = hostingConfig();
  const app = createApp({ hosting });
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
  const stop = () => app.server.close(() => { app.store.close(); process.exit(0); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
