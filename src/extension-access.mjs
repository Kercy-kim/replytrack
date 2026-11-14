import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assert } from './errors.mjs';

// Public manifest key pins the development ID. This is an origin allowlist, not user authentication.
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32)]
  .map(char => String.fromCharCode(97 + Number.parseInt(char, 16))).join('');
export const extensionOrigin = `chrome-extension://${id}`;

const allowed = (path, method) => method === 'GET'
  ? /^\/api\/(health|config|cases\/[\w-]+)$/.test(path)
  : method === 'POST' && (/^\/api\/(extract|cases)$/.test(path) || /^\/api\/cases\/[\w-]+\/(analyze|drafts)$/.test(path));

export function allowExtensionRequest(req, res, path) {
  assert(req.headers.origin === extensionOrigin, '이 요청의 출처를 허용하지 않습니다.', 403);
  const method = req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method;
  assert(allowed(path, method), '확장 프로그램에서 지원하지 않는 요청입니다.', 403);
  const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  assert(headers.every(x => x === 'content-type'), '허용하지 않는 요청 헤더입니다.', 403);
  res.setHeader('Access-Control-Allow-Origin', extensionOrigin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
    res.end(); return true;
  }
  return false;
}
