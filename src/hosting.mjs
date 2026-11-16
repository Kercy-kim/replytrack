import { createHash, timingSafeEqual } from 'node:crypto';
import { assert } from './errors.mjs';

// The public origin is trusted deployment configuration, never a request header.
export function hostingConfig(env = process.env) {
  const raw = env.REPLYTRACK_PUBLIC_ORIGIN || (env.RENDER === 'true' ? env.RENDER_EXTERNAL_URL : '') || '';
  if (!raw) {
    if (env.RENDER === 'true') throw new Error('Render public URL is required.');
    return { publicOrigin: null, password: '', bindHost: '127.0.0.1' };
  }
  let url;
  try { url = new URL(raw); } catch { throw new Error('Public origin must be an HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Public origin must be an HTTPS origin without credentials, path, or query.');
  }
  const password = env.REPLYTRACK_DEMO_PASSWORD || '';
  if (password.length < 16) throw new Error('Public hosting requires REPLYTRACK_DEMO_PASSWORD with at least 16 characters.');
  return { publicOrigin: url.origin, password, bindHost: '0.0.0.0' };
}

export function createRequestGuard(config) {
  const publicHost = config.publicOrigin ? new URL(config.publicOrigin).host : null;
  const digest = text => createHash('sha256').update(text).digest();
  const expected = digest(`Basic ${Buffer.from(`replytrack:${config.password}`).toString('base64')}`);
  return (req, res, port) => {
    const host = req.headers.host;
    const local = host === `localhost:${port}` || host === `127.0.0.1:${port}`;
    assert(config.publicOrigin ? (host === publicHost || local) : local, '허용된 서비스 주소로 접속해 주세요.', 403);
    const origin = host === publicHost ? config.publicOrigin : `http://${host}`;
    assert(!req.headers.origin || req.headers.origin === origin, '이 요청의 출처를 허용하지 않습니다.', 403);
    const navigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    assert(req.headers['sec-fetch-site'] !== 'cross-site' || navigation, '다른 사이트에서 보낸 요청을 허용하지 않습니다.', 403);
    const path = new URL(req.url, origin).pathname;
    // The health check contains no account, model, or conversation information.
    if (config.publicOrigin && !config.sessionAuth && !(req.method === 'GET' && path === '/api/health')) {
      if (!timingSafeEqual(digest(req.headers.authorization || ''), expected)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="ReplyTrack", charset="UTF-8"');
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ReplyTrack에 로그인해 주세요. 사용자 이름: replytrack');
        return null;
      }
    }
    return path;
  };
}
