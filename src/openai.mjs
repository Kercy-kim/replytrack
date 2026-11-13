import { AppError } from './errors.mjs';

export class OpenAIClient {
  constructor({ apiKey = '', model = 'gpt-5-mini', fetchImpl = fetch, timeoutMs = 90000 } = {}) {
    this.apiKey = apiKey; this.model = model; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  get configured() { return Boolean(this.apiKey); }
  configure({ apiKey, model }) {
    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim())) throw new AppError(400, 'API 키 형식을 확인해 주세요.');
      this.apiKey = apiKey.trim();
    }
    if (model !== undefined) {
      if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(model)) throw new AppError(400, '모델 이름을 확인해 주세요.');
      this.model = model;
    }
  }
  async structured({ name, schema, instructions, data, image }) {
    if (!this.configured) throw new AppError(503, 'AI 연결 설정에서 OpenAI API 키를 등록해 주세요. 예제 상담은 키 없이 체험할 수 있습니다.', 'API_KEY_REQUIRED');
    const content = [{ type: 'input_text', text: JSON.stringify(data) }];
    if (image) content.push({ type: 'input_image', image_url: image, detail: 'high' });
    const payload = {
      model: this.model, store: false, instructions,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name, strict: true, schema } },
      max_output_tokens: 6500,
    };
    if (/^gpt-5/.test(this.model)) payload.reasoning = { effort: 'low' };
    let res;
    try {
      res = await this.fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new AppError(504, 'AI 응답 시간이 초과됐습니다. 자료를 줄이거나 다시 시도해 주세요.', 'AI_TIMEOUT');
      throw new AppError(502, 'AI 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', 'AI_NETWORK');
    }
    if (!res.ok) {
      if (res.status === 401) throw new AppError(502, 'OpenAI API 키가 유효하지 않습니다. AI 연결 설정을 확인해 주세요.', 'AI_AUTH');
      if (res.status === 429) throw new AppError(429, 'OpenAI 사용량 또는 결제 한도를 확인한 뒤 다시 시도해 주세요.', 'AI_LIMIT');
      throw new AppError(502, `AI 요청을 처리하지 못했습니다. 모델 설정을 확인해 주세요. (공급자 HTTP ${res.status})`, 'AI_PROVIDER');
    }
    let response;
    try { response = await res.json(); } catch { throw new AppError(502, 'AI 응답을 읽지 못했습니다.', 'AI_FORMAT'); }
    if (response.status !== 'completed') throw new AppError(502, 'AI 분석이 완성되지 않았습니다. 기존 기록은 유지됩니다. 다시 시도해 주세요.', 'AI_INCOMPLETE');
    const parts = (response.output ?? []).flatMap(item => item.content ?? []);
    if (parts.some(p => p.type === 'refusal')) throw new AppError(422, '이 자료에 대한 AI 분석이 거절됐습니다. 입력 내용을 확인해 주세요.', 'AI_REFUSAL');
    const output = parts.filter(p => p.type === 'output_text').map(p => p.text).join('');
    try { return { data: JSON.parse(output), model: response.model ?? this.model, usage: response.usage ?? null }; }
    catch { throw new AppError(502, 'AI가 올바른 분석 형식을 반환하지 않았습니다. 다시 시도해 주세요.', 'AI_FORMAT'); }
  }
}
