import { assert, AppError } from './errors.mjs';
import { newCase, message, history, applyAnalysis, analysisValidationErrors, validateDraft, statuses, cleanText } from './domain.mjs';
import { createDemo, advanceDemo, demoAnalysis, demoDraft } from './demo.mjs';
import { analysisSchemaFor, transcriptSchema, draftSchemaFor, draftReviewSchema, boundaryReviewSchemaFor } from './schema.mjs';
import { ANALYSIS_PROMPT, TRANSCRIPT_PROMPT, DRAFT_PROMPT, DRAFT_REVIEW_PROMPT, BOUNDARY_REVIEW_PROMPT } from './prompts.mjs';
import { HANDOFF_PROMPT, HANDOFF_REPAIR_PROMPT, HANDOFF_REVIEW_PROMPT, stripInternalCitations, normalizeHandoffAttribution } from './handoff.mjs';
import { checkpoint } from './operation.mjs';
import { maskPrivate, privacyEnvelope } from './privacy.mjs';
import { readImage } from './ocr.mjs';

// Derived reasoning and suggested follow-ups are not independent source facts.
export const draftQuestionContext = questions => questions.map(({ id, title, source, status, evidence }) => ({ id, title, source, status, evidence }));
export const draftSourceContext = record => ({
  messages: record.messages.map(({ id, role, text }) => ({ id, role, text })),
  promises: record.promises.map(({ id, title, questionIds, evidence, dueText, state, confirmedAt }) => ({ id, title, questionIds, evidence, dueText, state, ...(confirmedAt ? { confirmedByUser: true } : {}) })),
});
export const analysisContext = record => ({
  messages: record.messages,
  existingQuestions: record.questions.map(({ id, title, source, status, aiStatus, evidence }) => ({ id, title, source, status: aiStatus ?? status, evidence })),
  existingPromises: record.promises.map(({ id, title, questionIds, evidence, dueText, state }) => ({ id, title, questionIds, evidence, dueText, state })),
});

function analysisUsage(results) {
  const usages = results.map(r => r.usage).filter(Boolean);
  if (!usages.length) return null;
  const sum = key => usages.reduce((n, u) => n + (u[key] || 0), 0);
  return { input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), total_tokens: sum('total_tokens'),
    input_tokens_details: { cached_tokens: usages.reduce((n, u) => n + (u.input_tokens_details?.cached_tokens || 0), 0) },
    output_tokens_details: { reasoning_tokens: usages.reduce((n, u) => n + (u.output_tokens_details?.reasoning_tokens || 0), 0) } };
}

export class ReplyTrack {
  constructor(store, ai, { ocr = readImage } = {}) {
    this.store = store; this.ai = ai; this.busy = new Set(); this.activeAI = 0; this.ocr = ocr;
    this.configRevision = 0; this.connection = { state: 'unchecked', checkedAt: null };
  }
  config() { return { configured: this.ai.configured, model: this.ai.model, connection: { ...this.connection } }; }
  configure(input) { this.ai.configure(input); this.configRevision++; this.connection = { state: 'unchecked', checkedAt: null }; return this.config(); }
  async preflight(context = {}) {
    const revision = this.configRevision;
    try {
      const result = await this.ask({ name: 'replytrack_connection', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        instructions: 'Return {"ok":true}. This is a connection test; no conversation data is provided.', data: { check: true }, maxOutputTokens: 512 }, context, 'connection');
      if (result.data?.ok !== true) throw new AppError(502, 'AI 연결 점검 응답이 올바르지 않습니다. 다시 확인해 주세요.', 'AI_FORMAT');
      checkpoint(context);
      assert(revision === this.configRevision, '점검 중 AI 설정이 변경됐어요. 새 설정으로 다시 점검해 주세요.', 409);
      this.connection = { state: 'ready', checkedAt: new Date().toISOString() };
      return this.config();
    } catch (error) {
      if (!context.signal?.aborted && revision === this.configRevision) this.connection = { state: 'failed', checkedAt: new Date().toISOString(), message: error.message };
      throw error;
    }
  }
  async ensureConnection(context) {
    if (this.connection.state !== 'ready' || Date.now() - Date.parse(this.connection.checkedAt) > 600000) await this.preflight(context);
    checkpoint(context);
  }
  async ask(params, context = {}, stage) {
    checkpoint(context, stage);
    const revision = this.configRevision;
    try {
      const result = await this.withAI(() => this.ai.structured({ ...params, signal: context.signal }));
      checkpoint(context); return result;
    } catch (error) {
      if (!context.signal?.aborted && revision === this.configRevision && ['AI_AUTH', 'AI_LIMIT', 'AI_NETWORK', 'AI_PROVIDER', 'API_KEY_REQUIRED'].includes(error.code)) {
        this.connection = { state: 'failed', checkedAt: new Date().toISOString(), message: error.message };
      }
      throw error;
    }
  }
  getVersion(id, version) {
    const c = this.store.get(id);
    assert(Number.isInteger(version) && c.version === version, '상담이 변경됐습니다. 최신 기록을 다시 불러와 주세요.', 409);
    return c;
  }
  async withAI(task) {
    assert(this.activeAI < 2, '다른 AI 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.', 429);
    this.activeAI++;
    try { return await task(); } finally { this.activeAI--; }
  }
  create(input) {
    const c = newCase(input);
    const masked = maskPrivate({ title: c.title, company: c.company, texts: c.messages.map(m => m.text) });
    c.title = masked.title; c.company = masked.company;
    c.messages.forEach((m, i) => { m.text = masked.texts[i]; });
    return this.store.create(c);
  }
  demo() { return this.store.create(createDemo()); }
  metadata(id, input) {
    const c = this.getVersion(id, input.version);
    assert(['title', 'company', 'archived'].some(key => input[key] !== undefined), '수정할 내용을 입력해 주세요.');
    if (input.title !== undefined) c.title = maskPrivate(cleanText(input.title, 100, '상담 제목'));
    if (input.company !== undefined) {
      assert(typeof input.company === 'string' && input.company.length <= 60, '업체명은 60자까지 입력할 수 있습니다.');
      c.company = maskPrivate(input.company.trim()) || '고객센터';
    }
    if (input.archived !== undefined) {
      assert(typeof input.archived === 'boolean', '보관 여부를 확인해 주세요.');
      c.archivedAt = input.archived ? (c.archivedAt || new Date().toISOString()) : null;
    }
    history(c, 'metadata', input.archived === true ? '상담을 보관했어요' : input.archived === false ? '상담을 진행 목록으로 복원했어요' : '상담 정보를 수정했어요');
    return this.store.save(c, input.version);
  }
  saveDraft(id, kind, input) {
    const c = this.getVersion(id, input.version);
    assert(['followup', 'handoff'].includes(kind) && c.drafts[kind], '먼저 초안을 생성해 주세요.', 404);
    assert(typeof input.body === 'string' && input.body.trim() && input.body.length <= 8000, '초안은 1~8,000자로 입력해 주세요.');
    // Preserve generated text and its evidence; user edits are not AI-verified facts.
    c.drafts[kind].editedBody = input.body;
    c.drafts[kind].editedAt = new Date().toISOString();
    history(c, 'draft', kind === 'followup' ? '편집한 재문의 초안을 저장했어요' : '편집한 인계 요약을 저장했어요');
    return this.store.save(c, input.version);
  }
  advance(id, version) {
    const c = this.getVersion(id, version);
    assert(c.mode === 'demo', '예제 상담에서만 사용할 수 있습니다.');
    assert(c.demoStep < 2, '모든 예제 답변을 추가했습니다.');
    return this.store.save(advanceDemo(c), version);
  }
  append(id, input) {
    const c = this.getVersion(id, input.version);
    assert(c.mode !== 'demo', '예제에서는 준비된 답변 추가 버튼을 사용해 주세요. 직접 입력하려면 새 상담을 만드세요.');
    const m = message(input);
    assert(c.messages.length < 60 && c.messages.reduce((n, m) => n + m.text.length, 0) + m.text.length <= 40000, '상담은 60개 메시지, 총 40,000자까지 지원합니다.');
    m.text = maskPrivate({ existing: c.messages.map(m => m.text), text: m.text }).text;
    c.messages.push(m); // Keep prior drafts until a new analysis actually commits.
    history(c, 'message', m.role === 'agent' ? '고객센터의 새 답변을 저장했어요' : '내 추가 질문을 저장했어요', '분석 전에도 원문은 보존됩니다.');
    return this.store.save(c, input.version);
  }
  async analyze(id, version, context = {}) {
    checkpoint(context);
    assert(!this.busy.has(id), '이 상담을 분석 중입니다. 잠시 기다려 주세요.', 409);
    this.busy.add(id);
    try {
      const c = this.getVersion(id, version);
      let result, attempts = 0, boundaryReview = null;
      const results = [];
      if (c.mode === 'demo') result = { data: demoAnalysis(c), model: '준비된 예제 · AI 호출 없음', usage: null };
      else {
        const data = analysisContext(c);
        let revision = {};
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) this.getVersion(id, version);
          result = await this.ask({ name: 'replytrack_analysis', schema: analysisSchemaFor(c.messages), instructions: ANALYSIS_PROMPT, reasoningEffort: 'medium', data: { ...data, ...revision } }, context, attempt ? 'analysis_repair' : 'analysis');
          results.push(result); attempts++;
          checkpoint(context, 'validation');
          const validationErrors = analysisValidationErrors(result.data, c.messages);
          if (!validationErrors.length) break;
          if (attempt === 1) throw new AppError(502, '분석의 원문 인용과 상태를 다시 확인했지만 맞지 않아 저장하지 않았습니다. 기존 기록은 유지됩니다.', 'AI_EVIDENCE');
          revision = { revisionFeedback: `앞선 생성에서 다음 원문 인용 또는 상태·근거의 일관성 오류가 있었습니다: ${validationErrors.join(', ')}. source는 customer, evidence는 agent의 실제 ID와 정확한 원문 부분 문자열이어야 합니다. 동의어 치환·조사 생략·띄어쓰기 수정·요약을 하지 말고 원문을 그대로 복사하세요. 미답변인데 근거가 있다면 그 근거의 관련성을 다시 판단하고, 관련 안내가 있으면 맞는 상태를 선택하고 무관한 안내면 근거에서 제외하세요. 잘못된 출력을 재사용하지 말고 제공된 원문과 기존 기록에서 전체 분석을 다시 반환하세요.` };
        }
        const uncertain = result.data.questions.filter(q => q.status === 'review' && q.evidence.length);
        if (uncertain.length) {
          this.getVersion(id, version);
          const checked = await this.ask({ name: 'replytrack_boundary_review', schema: boundaryReviewSchemaFor(uncertain.map(q => q.id)), instructions: BOUNDARY_REVIEW_PROMPT, reasoningEffort: 'medium',
            data: { messages: c.messages, questions: uncertain.map(({ id, title, source }) => ({ id, title, source })), otherQuestions: result.data.questions.filter(q => !uncertain.includes(q)).map(({ id, title, source }) => ({ id, title, source })) } }, context, 'boundary_review');
          results.push(checked);
          const decisions = checked.data?.questions;
          if (!Array.isArray(decisions) || decisions.length !== uncertain.length || new Set(decisions.map(q => q.id)).size !== uncertain.length || decisions.some(q => !uncertain.some(u => u.id === q.id) || !['partial', 'review'].includes(q.status) || typeof q.reason !== 'string' || !q.reason.trim())) throw new AppError(502, '질문 상태 검토 결과가 맞지 않아 기존 기록을 유지했습니다.', 'AI_BOUNDARY');
          const data = structuredClone(result.data);
          for (const decision of decisions) Object.assign(data.questions.find(q => q.id === decision.id), { status: decision.status, reason: decision.reason });
          result = { ...result, data }; // Preserve the original model output in evaluation logs.
          boundaryReview = { model: checked.model, questions: uncertain.length };
        }
      }
      checkpoint(context, 'saving');
      applyAnalysis(c, result.data, { model: result.model, usage: analysisUsage(results), attempts, ...(boundaryReview ? { boundaryReview } : {}) });
      return this.store.save(c, version);
    } finally { this.busy.delete(id); }
  }
  question(id, questionId, input) {
    const c = this.getVersion(id, input.version), q = c.questions.find(q => q.id === questionId);
    assert(q, '질문을 찾을 수 없습니다.', 404);
    if (input.title !== undefined) q.title = q.manualTitle = cleanText(input.title, 200, '질문 제목');
    if (input.status !== undefined) {
      assert(statuses.includes(input.status), '상태를 확인해 주세요.');
      q.status = q.manualStatus = input.status; q.reason = '사용자가 직접 지정한 상태입니다.';
    }
    if (input.applyAI === true) { q.status = q.aiStatus; q.reason = q.aiReason; q.manualStatus = null; }
    c.drafts = {};
    history(c, 'correction', '질문 확인표를 직접 수정했어요', q.title);
    return this.store.save(c, input.version);
  }
  promise(id, promiseId, input) {
    const c = this.getVersion(id, input.version), p = c.promises.find(p => p.id === promiseId);
    assert(p, '처리 약속을 찾을 수 없습니다.', 404);
    assert(typeof input.confirmed === 'boolean', '확인 여부를 선택해 주세요.');
    p.confirmedAt = input.confirmed ? new Date().toISOString() : null;
    c.drafts = {};
    history(c, 'confirmation', input.confirmed ? '실제 처리 결과를 직접 확인했어요' : '처리 결과 확인을 취소했어요', p.title);
    return this.store.save(c, input.version);
  }
  async draft(id, input, context = {}) {
    checkpoint(context);
    const c = this.getVersion(id, input.version);
    assert(c.analyzedMessageCount === c.messages.length && c.questions.length, '새 답변을 먼저 분석해 주세요.');
    assert(['followup', 'handoff'].includes(input.kind), '초안 종류를 선택해 주세요.');
    const ids = Array.isArray(input.questionIds) ? input.questionIds : [];
    const selected = c.questions.filter(q => ids.includes(q.id) && q.status !== 'answered');
    assert(input.kind === 'handoff' || selected.length, '재문의할 미해결 질문을 선택해 주세요.');
    let draft, model, review = null;
    if (c.mode === 'demo') {
      draft = validateDraft(demoDraft(c, input.kind, ids), c); model = '준비된 예제';
    } else {
      const source = { kind: input.kind, ...draftSourceContext(c), questions: draftQuestionContext(input.kind === 'followup' ? selected : c.questions) };
      let revisionFeedback = '', previousDraft = null;
      // Bound paid calls: one generation + review, with at most one repair attempt.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.ask({ name: 'replytrack_draft', schema: draftSchemaFor(c.messages), instructions: input.kind === 'handoff' ? (attempt === 0 ? HANDOFF_PROMPT : HANDOFF_REPAIR_PROMPT) : DRAFT_PROMPT, reasoningEffort: attempt === 0 ? 'low' : 'medium',
          data: { ...source, ...(revisionFeedback ? { revisionFeedback, previousDraft } : {}) } }, context, attempt ? 'draft_repair' : 'draft');
        checkpoint(context, 'validation');
        model = result.model; previousDraft = result.data;
        let candidate;
        try {
          candidate = validateDraft(input.kind === 'handoff' ? normalizeHandoffAttribution(stripInternalCitations(result.data, c), c) : result.data, c);
          if (input.kind === 'handoff') previousDraft = candidate;
        }
        catch (error) {
          if (attempt === 1) throw error;
          revisionFeedback = error.message; continue;
        }
        const checked = await this.ask({ name: 'replytrack_draft_review', schema: draftReviewSchema, instructions: input.kind === 'handoff' ? HANDOFF_REVIEW_PROMPT : DRAFT_REVIEW_PROMPT, reasoningEffort: 'medium',
          data: { ...source, draft: candidate } }, context, 'draft_review');
        if (checked.data?.valid === true) {
          draft = candidate; review = { model: checked.model, attempts: attempt + 1 }; break;
        }
        revisionFeedback = typeof checked.data?.feedback === 'string' ? checked.data.feedback.slice(0, 1500) : '선택한 모든 질문, 소비자 관점, 원문 사실과 일치하도록 수정해 주세요.';
      }
      if (!draft) throw new AppError(502, '초안을 검토했지만 선택한 질문이나 원문과 맞지 않는 부분이 남아 저장하지 않았습니다. 다시 작성해 주세요.', 'DRAFT_REVIEW');
    }
    checkpoint(context, 'saving');
    c.drafts[input.kind] = { ...draft, at: new Date().toISOString(), model, ...(review ? { review } : {}) };
    history(c, 'draft', input.kind === 'followup' ? '남은 질문으로 재문의 초안을 만들었어요' : '상담 인계 요약을 만들었어요');
    return this.store.save(c, input.version);
  }
  async prepare(input, context = {}) {
    checkpoint(context, 'masking');
    assert((typeof input.text === 'string' && input.text.trim()) || (typeof input.image === 'string' && input.image.length), '상담 텍스트나 캡처를 등록해 주세요.');
    if (input.text) cleanText(input.text, 30000, '상담 텍스트');
    if (input.image) {
      assert(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image) && input.image.length < 5600000, 'PNG, JPEG, WebP 형식의 4MB 이하 캡처를 선택해 주세요.');
      const bytes = Buffer.from(input.image.split(',')[1], 'base64');
      const kind = input.image.match(/^data:image\/(\w+)/)[1];
      const valid = kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : kind === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      assert(valid, '이미지 파일 형식과 내용이 일치하지 않습니다.');
    }
    const text = [input.text || '', input.image ? await this.ocr(input.image, context) : ''].filter(Boolean).join('\n\n');
    checkpoint(context, 'masking');
    cleanText(text, 30000, '읽은 상담 텍스트');
    const masked = privacyEnvelope(text);
    return { text: masked.data, counts: masked.counts };
  }
  async extract(input, context = {}) {
    const prepared = await this.prepare(input, context);
    const r = await this.ask({ name: 'replytrack_transcript', schema: transcriptSchema, instructions: TRANSCRIPT_PROMPT, data: { text: prepared.text } }, context, 'reading');
    const data = r.data;
    if (!data || !Array.isArray(data.messages) || !data.messages.length || data.messages.length > 60 || data.messages.some(m => !['customer','agent','unknown'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 6000)) throw new AppError(422, '읽을 수 있는 대화를 찾지 못했습니다. 직접 입력하거나 다른 캡처로 시도해 주세요.');
    checkpoint(context, 'validation');
    return { messages: data.messages.map(m => ({ role: m.role, text: maskPrivate(m.text), sentAt: m.sentAt && Number.isFinite(Date.parse(m.sentAt)) ? new Date(m.sentAt).toISOString() : null })), notes: Array.isArray(data.notes) ? data.notes.filter(x => typeof x === 'string').map(maskPrivate) : [], model: r.model };
  }
}
