export const SERVER_URL = 'http://127.0.0.1:3100';

export class ReplyTrackApi {
  constructor(base = SERVER_URL, fetchImpl = globalThis.fetch) { this.base = base; this.fetch = fetchImpl.bind(globalThis); }
  async request(path, method = 'GET', body) {
    let response;
    try {
      response = await this.fetch(this.base + path, {
        method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000),
        credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new Error('응답이 늦어지고 있어요. 저장된 기록을 새로고침한 뒤 다시 시도해 주세요.');
      throw new Error('ReplyTrack 서버에 연결할 수 없어요. 프로젝트에서 node server.mjs를 실행한 뒤 연결을 다시 확인해 주세요.');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했어요. ReplyTrack 서버 주소와 버전을 확인해 주세요.'); }
    if (!response.ok) {
      const error = new Error(data.error || '요청을 처리하지 못했어요. 다시 시도해 주세요.');
      error.status = response.status; throw error;
    }
    return data;
  }
}
