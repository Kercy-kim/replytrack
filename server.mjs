import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { CaseStore } from './src/store.mjs';
import { OpenAIClient } from './src/openai.mjs';
import { ReplyTrack } from './src/service.mjs';
import { AppError, assert } from './src/errors.mjs';
import { allowExtensionRequest } from './src/extension-access.mjs';

const root = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/styles.css', ['styles.css', 'text/css']], ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]]);

export function createApp({ store, ai } = {}) {
  const db = store ?? new CaseStore(resolve(root, process.env.REPLYTRACK_DATA_DIR || 'data', 'replytrack.sqlite'));
  const client = ai ?? new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  const service = new ReplyTrack(db, client);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const host = req.headers.host;
      const port = server.address()?.port;
      assert([`localhost:${port}`, `127.0.0.1:${port}`].includes(host), '로컬 주소로 접속해 주세요.', 403);
      const path = new URL(req.url, `http://${host}`).pathname;
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        if (allowExtensionRequest(req, res, path)) return;
      }
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
      if (method === 'GET' && path === '/api/config') return json({ configured: client.configured, model: client.model });
      if (method === 'PUT' && path === '/api/config') { client.configure(body); return json({ configured: client.configured, model: client.model }); }
      if (method === 'GET' && path === '/api/cases') return json(db.list());
      if (method === 'POST' && path === '/api/cases') return json(service.create(body), 201);
      if (method === 'POST' && path === '/api/demo') return json(service.demo(), 201);
      if (method === 'POST' && path === '/api/extract') return json(await service.extract(body));
      const match = path.match(/^\/api\/cases\/([\w-]+)(?:\/(analyze|messages|questions|promises|drafts|demo-next)(?:\/([\w-]+))?)?$/);
      if (match) {
        const [, id, action, item] = match;
        if (!action && method === 'GET') return json(db.get(id));
        if (!action && method === 'DELETE') { service.getVersion(id, body.version); db.delete(id, body.version); return json({ deleted: true }); }
        if (action === 'analyze' && method === 'POST') return json(await service.analyze(id, body.version));
        if (action === 'messages' && method === 'POST') return json(service.append(id, body));
        if (action === 'demo-next' && method === 'POST') return json(service.advance(id, body.version));
        if (action === 'questions' && item && method === 'PATCH') return json(service.question(id, item, body));
        if (action === 'promises' && item && method === 'PATCH') return json(service.promise(id, item, body));
        if (action === 'drafts' && method === 'POST') return json(await service.draft(id, body));
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
  return { server, service, store: db, ai: client };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  const port = Number(process.env.PORT || 3100);
  app.server.listen(port, '127.0.0.1', () => console.log(`ReplyTrack: http://127.0.0.1:${port}`));
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
