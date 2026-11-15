import { AppError } from './errors.mjs';
import { compactReferences } from './ai-wire.mjs';
import { privacyEnvelope } from './privacy.mjs';
import { checkpoint } from './operation.mjs';
import { raceSlowRequest, observedUsage } from './ai-race.mjs';

export class OpenAIClient {
  constructor({ apiKey = '', model = 'gpt-5-mini', fetchImpl = fetch, timeoutMs = 90000, hedgeAfterMs = 25000 } = {}) {
    this.apiKey = apiKey; this.model = model; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
    this.hedgeAfterMs = hedgeAfterMs; this.activeHedges = 0;
  }
  get configured() { return Boolean(this.apiKey); }
  configure({ apiKey, model }) {
    if (apiKey !== undefined) {
      if (typeof apiKey !== 'string' || !/^sk-[A-Za-z0-9_-]{20,}$/.test(apiKey.trim())) throw new AppError(400, 'API 키 형식을 확인해 주세요.');
    }
    if (model !== undefined) {
      if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(model)) throw new AppError(400, '모델 이름을 확인해 주세요.');
    }
    if (apiKey !== undefined) this.apiKey = apiKey.trim();
    if (model !== undefined) this.model = model;
  }
  async structured({ name, schema, instructions, data, image, reasoningEffort = 'low', signal, maxOutputTokens = 6500 }) {
    checkpoint({ signal });
    if (!this.configured) throw new AppError(503, 'AI 연결 설정에서 OpenAI API 키를 등록해 주세요. 예제 상담은 키 없이 체험할 수 있습니다.', 'API_KEY_REQUIRED');
    if (image) throw new AppError(400, '캡처는 로컬에서 읽고 개인정보를 가린 텍스트로만 AI에 전달할 수 있습니다.', 'RAW_IMAGE_BLOCKED');
    const privacy = privacyEnvelope({ data, instructions });
    const wire = compactReferences(privacy.data.data, schema);
    const content = [{ type: 'input_text', text: JSON.stringify(wire.data) }];
    const payload = {
      model: this.model, store: false, instructions: `${privacy.data.instructions || ''}\n[전화번호_…], [주소_…]는 개인정보 가림 표시입니다. 표시만으로 실제 번호·주소가 서로 같은지 다른지 추정하지 말고 원문의 명시적인 변경·일치 설명에만 근거하세요. 가림 표시는 그대로 인용하세요.`,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name, strict: true, schema: wire.schema } },
      max_output_tokens: maxOutputTokens,
    };
    if (/^gpt-5/.test(this.model)) payload.reasoning = { effort: reasoningEffort };
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers = { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };
    const body = JSON.stringify(payload);
    const requestError = error => {
      checkpoint({ signal });
      if (requestSignal.aborted || error.name === 'TimeoutError' || error.name === 'AbortError') throw new AppError(504, 'AI 응답 시간이 초과됐습니다. 자료를 줄이거나 다시 시도해 주세요.', 'AI_TIMEOUT');
    };
    const request = async (attemptSignal, trace) => {
      const started = performance.now();
      let res;
      try {
        res = await this.fetch('https://api.openai.com/v1/responses', {
          method: 'POST', headers, body, signal: attemptSignal,
        });
      } catch (error) {
        requestError(error);
        throw new AppError(502, 'AI 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', 'AI_NETWORK');
      }
      trace.headersMs = Math.round(performance.now() - started);
      trace.httpStatus = res.status;
      checkpoint({ signal });
      if (!res.ok) {
        try { await res.body?.cancel(); } catch { /* Error bodies never become user-facing text. */ }
        if (res.status === 401) throw new AppError(502, 'OpenAI API 키가 유효하지 않습니다. AI 연결 설정을 확인해 주세요.', 'AI_AUTH');
        if (res.status === 429) throw new AppError(429, 'OpenAI 사용량 또는 결제 한도를 확인한 뒤 다시 시도해 주세요.', 'AI_LIMIT');
        throw new AppError(502, `AI 요청을 처리하지 못했습니다. 모델 설정을 확인해 주세요. (공급자 HTTP ${res.status})`, 'AI_PROVIDER');
      }
      let response;
      try { response = await res.json(); } catch (error) { requestError(error); throw new AppError(502, 'AI 응답을 읽지 못했습니다.', 'AI_FORMAT'); }
      trace.bodyMs = Math.round(performance.now() - started) - trace.headersMs;
      trace.usage = response.usage ?? null;
      checkpoint({ signal });
      if (response.status !== 'completed') throw new AppError(502, 'AI 분석이 완성되지 않았습니다. 기존 기록은 유지됩니다. 다시 시도해 주세요.', 'AI_INCOMPLETE');
      const parts = (response.output ?? []).flatMap(item => item.content ?? []);
      if (parts.some(p => p.type === 'refusal')) throw new AppError(422, '이 자료에 대한 AI 분석이 거절됐습니다. 입력 내용을 확인해 주세요.', 'AI_REFUSAL');
      const output = parts.filter(p => p.type === 'output_text').map(p => p.text).join('');
      // Restore only this call's aliases locally for exact-quote checks on legacy records.
      try { return { data: privacy.decode(wire.decode(JSON.parse(output))), model: response.model ?? payload.model }; }
      catch { throw new AppError(502, 'AI가 올바른 분석 형식을 반환하지 않았습니다. 다시 시도해 주세요.', 'AI_FORMAT'); }
    };
    try {
      const result = await raceSlowRequest({ request, signal: requestSignal,
        // Only the first generation (including new-reply analysis), never repairs,
        // reviews, drafts or preflight. Preserve model, effort and full source.
        delayMs: name === 'replytrack_analysis' && !data?.revisionFeedback && this.hedgeAfterMs < this.timeoutMs ? this.hedgeAfterMs : 0,
        acquireHedge: () => {
          if (this.activeHedges >= 1) return null;
          this.activeHedges++;
          return () => { this.activeHedges--; };
        } });
      checkpoint({ signal });
      return { ...result, usage: observedUsage(result.transport.attempts) };
    } catch (error) {
      try { requestError(error); } catch (mapped) { mapped.transport = error.transport; throw mapped; }
      throw error;
    }
  }
}
