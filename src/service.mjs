import { assert, AppError } from './errors.mjs';
import { newCase, message, history, applyAnalysis, analysisValidationErrors, validateDraft, statuses, cleanText } from './domain.mjs';
import { createDemo, createRefundDemo, advanceDemo, demoAnalysis, demoDraft, demoActions } from './demo.mjs';
import { actionsSchemaFor, actionsReviewSchema, ACTIONS_PROMPT, ACTIONS_REVIEW_PROMPT, validateActions, applyActions } from './next-actions.mjs';
import { actionChecks, draftChecks, reviewPassed } from './feature-review.mjs';
import { actionsFresh } from '../public/next-actions.js';
import { analysisSchemaFor, transcriptSchema, draftSchemaFor, draftReviewSchema, boundaryReviewSchemaFor, completionReviewSchemaFor } from './schema.mjs';
import { ANALYSIS_PROMPT, TRANSCRIPT_PROMPT, DRAFT_PROMPT, DRAFT_REVIEW_PROMPT, BOUNDARY_REVIEW_PROMPT, COMPLETION_REVIEW_PROMPT } from './prompts.mjs';
import { checkpoint } from './operation.mjs';
import { maskPrivate, privacyEnvelope } from './privacy.mjs';
import { readImage } from './ocr.mjs';
import { OfficialFaq, officialGuide } from './official-guide.mjs';
import { createEmailDemo, emailDemoExplanation } from './email-demo.mjs';
import { replyAnalysisPlan, splitEmailEvidence, receiptFulfillsDifferentAction } from './email-reply.mjs';
import { FOCUSED_ANALYSIS_PROMPT, PROMISE_REVIEW_PROMPT, initialAnalysisPlan, semanticReviewPlan, unsupportedDeadlineClear } from './analysis-focus.mjs';
import { EMAIL_TRANSCRIPT_PROMPT, EMAIL_ANALYSIS_PROMPT, EMAIL_ACTIONS_PROMPT, EMAIL_EXPLANATION_PROMPT, EMAIL_EXPLANATION_REVIEW_PROMPT, emailReviewSchema, emailExplanationSchema, validateEmailExplanation, validateEmailTranscript, draftLanguagePrompt } from './email.mjs';

// Derived reasoning and suggested follow-ups are not independent source facts.
export const draftQuestionContext = questions => questions.map(({ id, title, source, status, evidence }) => ({ id, topicHint: title, source, status, evidence }));
export const draftSourceContext = (record, kind) => ({
  messages: record.messages.map(({ id, role, text }) => ({ id, role, text })),
  promises: record.promises.map(({ id, title, questionIds, evidence, dueText, state, confirmedAt }) => ({ id, title, questionIds, evidence, dueText, state, ...(confirmedAt ? { confirmedByUser: true } : {}) })),
  ...(kind === 'followup' ? { answeredQuestions: draftQuestionContext(record.questions.filter(q => q.status === 'answered')) } : {}),
  ...(kind === 'handoff' ? { pendingQuestions: record.questions.filter(q => q.status !== 'answered').map(({ id, title }) => ({ id, title })) } : {}),
});
export const analysisContext = record => ({
  messages: record.messages,
  existingQuestions: record.questions.map(({ id, title, source, status, aiStatus, evidence }) => ({ id, title, source, status: aiStatus ?? status, evidence })),
  existingPromises: record.promises.map(({ id, title, questionIds, evidence, dueText, state }) => ({ id, title, questionIds, evidence, dueText, state })),
});

// These cues select computation effort, never a question status or a new fact.
// Email interpretation, corrections, conditional policies and long threads keep medium.
export function analysisReasoningEffort(record) {
  const correction = /정정|철회|번복|변경|잘못|앞서|앞선|기한.{0,20}취소|취소.{0,20}기한|\b(correct(?:ion|ed|ing)?|incorrect|revis(?:e|ed|ion)|retract(?:ed|ion)?|instead|supersed\w*|disregard|previous(?:ly)?|chang(?:e|ed))\b/i;
  const conditional = /면|경우|조건|원칙|예외|다만|하지만|\b(if|unless|only|except|provided)\b/i;
  // A deadline for learning an answer can differ from the requested processing date.
  // Spend more reasoning on future information promises; never assign a status by regex.
  const futureInformation = /(?:안내|알려|답변|회신)[^.!?\n]{0,24}(?:겠|드릴|드리|예정)|\b(?:will|shall|going to)\b[^.!?\n]{0,80}\b(?:update|inform|confirm|reply|tell|let you know)\b/i;
  return record.channel === 'email' || record.messages.length > 8 || record.messages.reduce((n, m) => n + m.text.length, 0) > 8000 || record.messages.some(m => m.role === 'agent' && (correction.test(m.text) || conditional.test(m.text) || futureInformation.test(m.text))) ? 'medium' : 'low';
}

// Only short first-time chats qualify. These cues route computation, never assign statuses.
const futureAnswer = /(?:안내|알려|답변|회신)[^.!?\n]{0,24}(?:겠|드릴|예정)|\b(?:will|shall|going to)\b[^.!?\n]{0,80}\b(?:update|inform|reply|tell|let you know)\b/i;
export function fastInitialAnalysis(record) {
  const complex = /정정|철회|번복|변경|잘못|앞서|앞선|면|경우|조건|원칙|예외|다만|하지만|취소|\b(if|unless|only|except|provided|after|before|once|when|until|instead|correct\w*|incorrect|revis\w*|retract\w*|supersed\w*|chang(?:e|ed)|disregard|previous\w*|however)\b/i;
  // Compound questions can cite the same reply for both a concrete answer and
  // a future notice. Keep normal medium reasoning instead of low plus review.
  const questionMarkers = record.messages.filter(m => m.role === 'customer').reduce((n, m) => n + (m.text.match(/[?？]+/g)?.length || 0), 0);
  return record.channel !== 'email' && !record.analysis && !record.questions?.length && questionMarkers <= 1 && record.messages.length <= 4 && record.messages.filter(m => m.role === 'agent').length === 1 && record.messages.reduce((n, m) => n + m.text.length, 0) <= 2000 && record.messages.some(m => m.role === 'agent' && futureAnswer.test(m.text)) && !record.messages.some(m => m.role === 'agent' && complex.test(m.text));
}
export function futureAnswerNeedsReview(data, record) {
  const latestAgent = record.messages.findLast(m => m.role === 'agent')?.id;
  const notificationTiming = /언제(?:까지)?\s*(?:알려|안내|회신|답변)|(?:안내|회신|답변)[^.!?\n]{0,15}(?:시점|언제)|\bwhen\b[^.!?\n]{0,55}\b(?:tell|inform|reply|let me know|notified)\b/i;
  return data.questions.some(q => (q.status === 'answered' || (q.status === 'waiting' && notificationTiming.test(q.source?.quote || '') && data.promises.some(p => p.state === 'promised' && p.questionIds.includes(q.id) && p.dueText))) && (
    q.evidence.some(e => e.messageId === latestAgent && futureAnswer.test(e.quote)) ||
    data.promises.some(p => p.state === 'promised' && p.questionIds.includes(q.id) && futureAnswer.test(p.evidence.quote))
  ));
}
// Review a potentially invented omission, without deciding whether the answer is complete.
export const partialScopeNeedsReview = (data, record) => record.channel === 'email' && data.questions.some(q => q.status === 'partial' && /(?:다른|추가|나머지|그\s*밖)[^.!?\n]{0,24}(?:서류|자료|문서|요건|요구사항|항목)/.test(q.reason));
export const durationPromiseNeedsReview = (data, record) => record.channel === 'email' && data.promises.some(p => p.state === 'promised' && /\b(?:review|processing|assessment|verification)\s+(?:(?:usually|typically|generally)\s+)?(?:will\s+take|takes?)\b/i.test(p.evidence.quote));
// A linked action is relevant context, or its question link is wrong. Ask the
// model to resolve that inconsistency; never assign partial by a keyword rule.
export const linkedUnansweredNeedsReview = (data, record) => record.channel === 'email'
  && data.questions.some(q => q.status === 'unanswered' && data.promises.some(p => p.questionIds.includes(q.id)));

function analysisUsage(results) {
  const usages = results.map(r => r.usage).filter(Boolean);
  if (!usages.length) return null;
  const sum = key => usages.reduce((n, u) => n + (u[key] || 0), 0);
  return { input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), total_tokens: sum('total_tokens'),
    unobserved_requests: results.reduce((n, r) => n + (r.transport?.unobservedRequests ?? r.usage?.unobserved_requests ?? (r.usage ? 0 : 1)), 0),
    input_tokens_details: { cached_tokens: usages.reduce((n, u) => n + (u.input_tokens_details?.cached_tokens || 0), 0) },
    output_tokens_details: { reasoning_tokens: usages.reduce((n, u) => n + (u.output_tokens_details?.reasoning_tokens || 0), 0) } };
}

export class ReplyTrack {
  constructor(store, ai, { ocr = readImage, faq = new OfficialFaq() } = {}) {
    this.faq = faq;
    this.store = store; this.ai = ai; this.busy = new Set(); this.activeAI = 0; this.ocr = ocr;
    this.configRevision = 0; this.connection = { state: 'unchecked', checkedAt: null };
  }
  config() { return { configured: this.ai.configured, model: this.ai.model, connection: { ...this.connection } }; }
  commit(record, version, context) {
    checkpoint(context);
    const save = () => this.store.save(record, version);
    return context.commit ? context.commit(save) : save();
  }
  guide(input, context = {}) { return officialGuide(this, input, context); }
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
    const check = c => {
      assert(Number.isInteger(version) && c.version === version, '상담이 변경됐습니다. 최신 기록을 다시 불러와 주세요.', 409);
      return c;
    };
    const c = this.store.get(id);
    return c?.then ? c.then(check) : check(c);
  }
  withRecord(id, version, fn) {
    const c = this.getVersion(id, version);
    return c?.then ? c.then(fn) : fn(c);
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
  demo(input = {}) { return this.store.create(input.scenario === 'email' ? createEmailDemo() : input.scenario === 'refund' ? createRefundDemo() : createDemo()); }
  async actions(id, version, context = {}) {
    checkpoint(context);
    const c = await this.getVersion(id, version);
    const data = { messages: c.messages, existingItems: (c.nextActions?.items || []).map(({ id, title, source, condition, dueText, state, update }) => ({ id, title, source, condition, dueText, state, update })) };
    let result, checked;
    if (c.mode === 'demo') result = { data: demoActions(c), model: '준비된 예제 · AI 호출 없음' };
    else {
      result = await this.ask({ name: 'replytrack_actions', schema: actionsSchemaFor(c), instructions: ACTIONS_PROMPT + (c.channel === 'email' ? `\n${EMAIL_ACTIONS_PROMPT}` : ''), reasoningEffort: 'medium', data }, context, 'actions');
      checkpoint(context, 'validation');
      validateActions(result.data, c);
      await this.getVersion(id, version);
      checked = await this.ask({ name: 'replytrack_actions_review', schema: actionsReviewSchema, instructions: ACTIONS_REVIEW_PROMPT + (c.channel === 'email' ? `\n${EMAIL_ACTIONS_PROMPT}` : ''), reasoningEffort: 'medium', data: { ...data, items: result.data.items } }, context, 'actions_review');
      if (!reviewPassed(checked.data,actionChecks)) throw new AppError(502, '업체 요청에 누락되거나 원문과 맞지 않는 부분이 있어 저장하지 않았어요. 원문을 확인하고 다시 시도해 주세요. 이전 할 일은 유지됩니다.', 'ACTIONS_REVIEW');
    }
    checkpoint(context, 'saving');
    applyActions(c, result.data, { model: result.model, usage: analysisUsage([result, checked].filter(Boolean)), reviewed: !!checked });
    return await this.commit(c, version, context);
  }
  completeAction(id, actionId, input) {
    return this.withRecord(id, input.version, c => {
      assert(actionsFresh(c), '새 대화가 있어요. 업체 요청을 먼저 다시 확인해 주세요.', 409);
      const item = c.nextActions.items.find(a => a.id === actionId);
      assert(item, '할 일을 찾을 수 없습니다.', 404);
      assert(typeof input.completed === 'boolean', '수행 여부를 확인해 주세요.');
      assert(!input.completed || ['requested', 'reported_done'].includes(item.state), '철회되거나 다시 확인이 필요한 요청은 완료로 바꿀 수 없어요.');
      item.completedAt = input.completed ? new Date().toISOString() : null;
      history(c, 'action_confirmation', input.completed ? '요청받은 행동을 직접 수행했다고 표시했어요' : '할 일 수행 표시를 취소했어요', item.title);
      return this.store.save(c, input.version);
    });
  }
  metadata(id, input) {
    return this.withRecord(id, input.version, c => {
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
    });
  }
  saveDraft(id, kind, input) {
    return this.withRecord(id, input.version, c => {
      assert(['followup', 'handoff'].includes(kind) && c.drafts[kind], '먼저 초안을 생성해 주세요.', 404);
      assert(typeof input.body === 'string' && input.body.trim() && input.body.length <= 8000, '초안은 1~8,000자로 입력해 주세요.');
      // Preserve generated text and its evidence; user edits are not AI-verified facts.
      c.drafts[kind].editedBody = input.body;
      c.drafts[kind].editedAt = new Date().toISOString();
      history(c, 'draft', kind === 'followup' ? '편집한 재문의 초안을 저장했어요' : '편집한 인계 요약을 저장했어요');
      return this.store.save(c, input.version);
    });
  }
  advance(id, version) {
    return this.withRecord(id, version, c => {
      assert(c.mode === 'demo', '예제 상담에서만 사용할 수 있습니다.');
      assert(c.demoStep < (c.demoScenario === 'email' ? 1 : 2), '모든 예제 답변을 추가했습니다.');
      return this.store.save(advanceDemo(c), version);
    });
  }
  append(id, input) {
    return this.withRecord(id, input.version, c => {
      assert(c.mode !== 'demo', '예제에서는 준비된 답변 추가 버튼을 사용해 주세요. 직접 입력하려면 새 상담을 만드세요.');
      const m = message(input);
      assert(c.messages.length < 60 && c.messages.reduce((n, m) => n + m.text.length, 0) + m.text.length <= 40000, '상담은 60개 메시지, 총 40,000자까지 지원합니다.');
      m.text = maskPrivate({ existing: c.messages.map(m => m.text), text: m.text }).text;
      c.messages.push(m); // Keep prior drafts until a new analysis actually commits.
      history(c, 'message', m.role === 'agent' ? '고객센터의 새 답변을 저장했어요' : '내 추가 질문을 저장했어요', '분석 전에도 원문은 보존됩니다.');
      return this.store.save(c, input.version);
    });
  }
  appendEmail(id, input) {
    return this.withRecord(id, input.version, c => {
      assert(c.mode !== 'demo' && c.channel === 'email', '이메일 상담에서 사용할 수 있어요.');
      assert(Array.isArray(input.messages) && input.messages.length > 0 && input.messages.length <= 60, '추가할 이메일을 확인해 주세요.');
      const added = input.messages.map(message);
      assert(c.messages.length + added.length <= 60 && [...c.messages, ...added].reduce((n, m) => n + m.text.length, 0) <= 40000, '상담은 60개 메시지, 총 40,000자까지 지원합니다.');
      const masked = maskPrivate({ existing: c.messages.map(m => m.text), added: added.map(m => m.text) });
      added.forEach((m, i) => { m.text = masked.added[i]; });
      c.messages.push(...added);
      history(c, 'message', '새 이메일을 저장했어요', `${added.length}개 메시지 · 이전 분석과 설명은 재확인 전까지 보존됩니다.`);
      return this.store.save(c, input.version);
    });
  }
  async explainEmail(id, version, context = {}) {
    const c = await this.getVersion(id, version);
    assert(c.channel === 'email' && c.messages.some(m => m.role === 'agent'), '설명할 고객센터 이메일 답변이 필요해요.');
    if (c.mode === 'demo' && c.demoScenario === 'email') { checkpoint(context); c.emailExplanation = emailDemoExplanation(c); return await this.commit(c, version, context); }
    const messages = c.messages.filter(m => m.role === 'agent');
    const result = await this.ask({ name: 'replytrack_email_explanation', schema: emailExplanationSchema(messages), instructions: EMAIL_EXPLANATION_PROMPT, reasoningEffort: 'medium', data: { messages } }, context, 'email_explanation');
    checkpoint(context, 'validation');
    validateEmailExplanation(result.data, messages);
    await this.getVersion(id, version);
    const reviewed = await this.ask({ name: 'replytrack_email_review', schema: emailReviewSchema, instructions: EMAIL_EXPLANATION_REVIEW_PROMPT, reasoningEffort: 'medium', data: { messages, explanation: result.data } }, context, 'email_review');
    if (reviewed.data?.valid !== true) throw new AppError(502, '한국어 설명에 원문과 다른 의미나 누락이 있어 저장하지 않았어요. 다시 시도해 주세요. 이전 설명은 유지됩니다.', 'EMAIL_REVIEW');
    checkpoint(context, 'saving');
    c.emailExplanation = { ...result.data, messageCount: c.messages.length, at: new Date().toISOString(), model: result.model, usage: analysisUsage([result, reviewed]) };
    history(c, 'email_explanation', '이메일 답변의 한국어 설명을 확인했어요');
    return await this.commit(c, version, context);
  }
  async analyze(id, version, context = {}) {
    checkpoint(context);
    assert(!this.busy.has(id), '이 상담을 분석 중입니다. 잠시 기다려 주세요.', 409);
    this.busy.add(id);
    try {
      const c = await this.getVersion(id, version);
      let result, attempts = 0, boundaryReview = null, completionReview = null;
      const results = [];
      if (c.mode === 'demo') result = { data: demoAnalysis(c), model: '준비된 예제 · AI 호출 없음', usage: null };
      else {
        const data = analysisContext(c);
        const replyPlan = replyAnalysisPlan(c) ?? initialAnalysisPlan(c);
        let revision = {}, semanticRepair = false, repairPlan = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await this.getVersion(id, version);
          // Keep complex histories, semantic reviews and evidence repair at medium.
          const plan = attempt === 0 ? replyPlan : repairPlan;
          const schema = plan?.schema ?? analysisSchemaFor(c.messages, c.channel);
          if (attempt && semanticRepair && schema.properties.questions) {
            delete schema.properties.questions.items.properties.followUp;
            schema.properties.questions.items.required = schema.properties.questions.items.required.filter(k => k !== 'followUp');
          }
          const outputScope = !schema.properties.questions || schema.properties.questions.items.properties.followUp ? '' : '\n이번 출력에는 followUp이 없습니다. 재문의 문장은 별도 생성·검토하므로 생성하지 말고 상태·이유·근거·약속 판단에 집중하세요.';
          const effort = attempt ? 'medium' : plan?.effort ?? (fastInitialAnalysis(c) ? 'low' : analysisReasoningEffort(c));
          const prompt = plan?.prompt ?? (plan?.focused || (attempt && semanticRepair) ? FOCUSED_ANALYSIS_PROMPT : ANALYSIS_PROMPT);
          const request = { name: 'replytrack_analysis', schema, instructions: prompt + (c.channel === 'email' && (!plan?.prompt || plan?.initial) ? `\n${EMAIL_ANALYSIS_PROMPT}` : '') + (plan?.instructions || '') + outputScope, reasoningEffort: effort, data: { ...data, ...revision, ...plan?.input } };
          if (!attempt && plan?.parallel) {
            const scoped = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
            const controller = new AbortController();
            const parallelContext = { ...context, signal: context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal };
            const requests = [
              { ...request, schema: scoped({ questions: schema.properties.questions }), instructions: request.instructions + '\n이번 작업은 기존 질문의 상태·이유·근거만 반환합니다. 약속 추출은 별도 병렬 분석에서 수행하지만, 질문의 waiting 판단에는 전체 원문의 약속을 고려하세요.' },
              { ...request, schema: scoped({ existingPromiseUpdates: schema.properties.existingPromiseUpdates, newPromises: schema.properties.newPromises, summary: schema.properties.summary }),
                instructions: PROMISE_REVIEW_PROMPT + plan.instructions + '\nexistingQuestions는 약속의 questionIds 연결용 원문입니다. existingPromiseUpdates에는 기존 동일 행동의 갱신, newPromises에는 기존 행동과 다른 업무 수행 확약·이행 통보를 반환하세요. 단순 상태 설명이나 미완료·미수신의 부정은 수행한 업무가 아닙니다. 예를 들어 has not been restored yet는 복구 완료도 미복구 통보 업무도 아니므로 약속 목록에 넣지 않습니다. 질문 상태는 출력하지 않습니다. 후속 결과 통지 약속은 검토 행동과 별개이며, 질문 상태와 관계없이 보존하세요.' },
            ];
            let failure;
            const parts = await Promise.allSettled(requests.map(async params => {
              try { return await this.ask(params, parallelContext, 'analysis'); }
              catch (error) { if (!failure) { failure = error; controller.abort(error); } throw error; }
            }));
            if (failure) throw failure;
            checkpoint(context);
            const [questions, promises] = parts.map(p => p.value);
            result = { ...questions, data: { ...promises.data, questions: questions.data.questions } };
            results.push(questions, promises); attempts += 2;
          } else {
            result = await this.ask(request, context, attempt ? 'analysis_repair' : 'analysis');
            results.push(result); attempts++;
          }
          checkpoint(context, 'validation');
          let restoreError;
          if (plan?.restore) { try { result = { ...result, data: plan.restore(result.data) }; } catch (error) { restoreError = error.message; } }
          if (c.channel === 'email' && !restoreError) result = { ...result, data: splitEmailEvidence(result.data, c.messages) };
          const validationErrors = restoreError ? [restoreError] : analysisValidationErrors(result.data, c.messages);
          if (!restoreError && c.channel === 'email') result.data.questions.forEach((q, i) => {
            if (typeof q.title !== 'string' || !/[가-힣]/.test(q.title)) validationErrors.push(`questions[${i}].title: 원문 질문의 의미를 보존한 한국어 제목으로 작성하세요. source/evidence 인용은 원문 언어 그대로 유지하세요`);
          });
          if (!attempt) semanticRepair = !validationErrors.length;
          if (!validationErrors.length && replyPlan?.emailActionScope && receiptFulfillsDifferentAction(result.data, c)) validationErrors.push('기존 검증·심사 약속의 행동이 자료 수신만으로 이행됐다고 바뀌었습니다. 자료 수신과 검증·심사는 별개입니다. 기존 약속 ID는 같은 행동에만 쓰고, 수신은 별도의 reported로 보존하세요. 원문에서 해당 검증·심사 자체의 수행이 명시된 경우만 기존 약속을 reported로 바꾸세요');
          if (!validationErrors.length && unsupportedDeadlineClear(result.data)) validationErrors.push('기한 삭제 표시에 명시적인 철회·미정 정정 근거가 없습니다. 업무 완료·수신·접수 통보나 기한 생략만으로 deadlineCleared=true를 쓰지 마세요. 실제 철회인지 전체 원문을 재검토하고, 단순 완료 통보라면 reported와 deadlineCleared=false로 기존 기한 이력을 보존하세요');
          if (!validationErrors.length && effort === 'low' && futureAnswerNeedsReview(result.data, c)) validationErrors.push('질문과 향후 확인·안내 약속의 시간 대상을 대조하세요. 질문한 행동의 처리 날짜와 답을 알려줄 날짜가 같은지 원문을 다시 대조하세요. 안내 시점 자체를 물었고 그 시점을 받았다면 answered가 맞을 수도 있습니다. 자동으로 waiting으로 바꾸거나 유지하지 마세요');
          if (!validationErrors.length && linkedUnansweredNeedsReview(result.data, c)) validationErrors.push('관련 안내가 전혀 없다는 unanswered 질문에 처리 약속이 연결돼 있습니다. 같은 처리의 선행 절차·진행 단계가 실제로 안내됐다면 partial 등 맞는 상태와 원문 근거를 보존하세요. 기간을 확인해 알려주겠다는 별도 확약이면 waiting입니다. 약속이 다른 업무라면 잘못된 questionIds 연결을 제거하고 unanswered를 유지할 수 있습니다. 연결만 보고 자동으로 partial로 바꾸지 말고 전체 원문에서 관련성을 판단하세요');
          if (!attempt && !validationErrors.length && partialScopeNeedsReview(result.data, c)) validationErrors.push('부분 답변의 누락 사유가 원문에 실제 존재하는지 다시 확인하세요. 필요한 자료가 무엇인지 물었고 업체가 제출할 항목을 명확히 제시했다면, 그 밖의 자료가 더 있을 것이라고 추측해 partial로 낮추지 마세요. 사용자가 실제로 여러 항목을 물었거나 업체가 일부 목록이라고 명시했다면 빠진 항목을 유지해야 합니다. 자동으로 answered로 바꾸지 말고 원문에서 요구 범위를 다시 판단하세요');
          if (!attempt && !validationErrors.length && durationPromiseNeedsReview(result.data, c)) validationErrors.push('검토·처리 소요 기간 답변을 별도 업무 약속으로 만들었는지 다시 확인하세요. The review will take 3 business days처럼 기간만 설명하면 심사 기간 질문의 답이지 독립 처리 약속이 아닙니다. 원문에 이 고객 건을 검토하겠다거나 결과를 보내겠다는 별도 행동의 확약이 있을 때만 그 행동 약속을 유지하세요. 자료를 받았다는 실제 수신 통보는 reported로 보존하고 일반 심사 기간을 그 수신 기한으로 옮기지 마세요');
          if (!validationErrors.length) break;
          if (attempt === 1) throw new AppError(502, '분석의 원문 인용과 상태를 다시 확인했지만 맞지 않아 저장하지 않았습니다. 기존 기록은 유지됩니다.', 'AI_EVIDENCE');
          if (semanticRepair) {
            const ids = result.data.questions.filter(q => (effort === 'low' && futureAnswerNeedsReview({ ...result.data, questions: [q] }, c)) || partialScopeNeedsReview({ questions: [q] }, c) || linkedUnansweredNeedsReview({ ...result.data, questions: [q] }, c)).map(q => q.id);
            repairPlan = semanticReviewPlan(c, result.data, ids);
          }
          revision = { revisionFeedback: `앞선 생성에서 다음 원문 인용 또는 상태·근거의 일관성 오류가 있었습니다: ${validationErrors.join(', ')}. source는 customer, evidence는 agent의 실제 ID와 정확한 원문 부분 문자열이어야 합니다. 동의어 치환·조사 생략·띄어쓰기 수정·요약을 하지 말고 원문을 그대로 복사하세요. 미답변인데 근거가 있다면 그 근거의 관련성을 다시 판단하고, 관련 안내가 있으면 맞는 상태를 선택하고 무관한 안내면 근거에서 제외하세요. 최종 상태를 답하지 않았어도 같은 처리의 실행 방법을 안내했다면 partial이며 방법 안내를 근거에 보존하세요. 미답변 형식에 맞추려고 관련 근거만 삭제하지 마세요. 잘못된 출력을 재사용하지 말고 제공된 원문과 기존 기록에서 전체 분석을 다시 반환하세요.` };
          if (repairPlan) revision = { revisionFeedback: `의미 재검토할 우려: ${validationErrors.join(', ')}. 이전 초안의 판단을 정답으로 삼지 말고 제공한 전체 원문에서 독립적으로 재판단하세요. ${repairPlan.schema.properties.questions ? '지정한 질문과 모든 처리 약속·요약을 반환하고 그 밖의 질문은 반환하지 마세요.' : '모든 처리 약속과 요약만 반환하세요.'}` };
        }
        // A lexical cue only requests a semantic review; it never creates a promise.
        const completionCue = /완료|마쳤|해제했|처리했|접수했|수신했|\b(completed|processed|disabled|received|restored|cancelled|canceled)\b/i;
        if (!result.data.promises.length && c.messages.some(m => m.role === 'agent' && completionCue.test(m.text))) {
          await this.getVersion(id, version);
          const checked = await this.ask({ name: 'replytrack_completion_review', schema: completionReviewSchemaFor(c.messages, result.data.questions), instructions: COMPLETION_REVIEW_PROMPT, reasoningEffort: 'medium',
            data: { messages: c.messages, questions: result.data.questions.map(({ id, title, source }) => ({ id, title, source })), existingPromises: data.existingPromises } }, context, 'completion_review');
          results.push(checked);
          const promises = checked.data?.promises;
          if (!Array.isArray(promises) || new Set(promises.map(p => p?.id)).size !== promises.length || promises.some(p => !p || typeof p.id !== 'string' || !p.id || p.state !== 'reported' || typeof p.title !== 'string' || !p.title.trim() || !Array.isArray(p.questionIds) || p.questionIds.some(id => !result.data.questions.some(q => q.id === id)))) throw new AppError(502, '처리 통보 검토 결과가 맞지 않아 기존 기록을 유지했습니다.', 'AI_COMPLETION');
          const candidate = { ...result.data, promises };
          if (analysisValidationErrors(candidate, c.messages).length || promises.some(p => typeof p.dueText !== 'string' || (p.dueText && !p.evidence.quote.includes(p.dueText)))) throw new AppError(502, '처리 통보의 원문 근거가 맞지 않아 기존 기록을 유지했습니다.', 'AI_COMPLETION');
          result = { ...result, data: candidate };
          completionReview = { model: checked.model, promises: promises.length };
        }
        const uncertain = result.data.questions.filter(q => q.status === 'review' && q.evidence.length);
        if (uncertain.length) {
          await this.getVersion(id, version);
          const checked = await this.ask({ name: 'replytrack_boundary_review', schema: boundaryReviewSchemaFor(uncertain.map(q => q.id), c.messages), instructions: BOUNDARY_REVIEW_PROMPT, reasoningEffort: 'medium',
            data: { messages: c.messages, questions: uncertain.map(({ id, title, source }) => ({ id, title, source })), otherQuestions: result.data.questions.filter(q => !uncertain.includes(q)).map(({ id, title, source }) => ({ id, title, source })) } }, context, 'boundary_review');
          results.push(checked);
          const decisions = checked.data?.questions;
          if (!Array.isArray(decisions) || decisions.length !== uncertain.length || new Set(decisions.map(q => q.id)).size !== uncertain.length || decisions.some(q => !uncertain.some(u => u.id === q.id) || !['partial', 'review'].includes(q.status) || typeof q.reason !== 'string' || !q.reason.trim() || !Array.isArray(q.evidence) || !q.evidence.length)) throw new AppError(502, '질문 상태 검토 결과가 맞지 않아 기존 기록을 유지했습니다.', 'AI_BOUNDARY');
          const data = structuredClone(result.data);
          for (const decision of decisions) Object.assign(data.questions.find(q => q.id === decision.id), { status: decision.status, reason: decision.reason, evidence: decision.evidence });
          if (analysisValidationErrors(data, c.messages).length) throw new AppError(502, '질문 상태 검토의 원문 근거가 맞지 않아 기존 기록을 유지했습니다.', 'AI_BOUNDARY');
          result = { ...result, data }; // Preserve the original model output in evaluation logs.
          boundaryReview = { model: checked.model, questions: uncertain.length };
        }
      }
      checkpoint(context, 'saving');
      applyAnalysis(c, result.data, { model: result.model, usage: analysisUsage(results), attempts, ...(boundaryReview ? { boundaryReview } : {}), ...(completionReview ? { completionReview } : {}) });
      return await this.commit(c, version, context);
    } finally { this.busy.delete(id); }
  }
  question(id, questionId, input) {
    return this.withRecord(id, input.version, c => {
      const q = c.questions.find(q => q.id === questionId);
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
    });
  }
  promise(id, promiseId, input) {
    return this.withRecord(id, input.version, c => {
      const p = c.promises.find(p => p.id === promiseId);
      assert(p, '처리 약속을 찾을 수 없습니다.', 404);
      assert(typeof input.confirmed === 'boolean', '확인 여부를 선택해 주세요.');
      p.confirmedAt = input.confirmed ? new Date().toISOString() : null;
      c.drafts = {};
      history(c, 'confirmation', input.confirmed ? '실제 처리 결과를 직접 확인했어요' : '처리 결과 확인을 취소했어요', p.title);
      return this.store.save(c, input.version);
    });
  }
  async draft(id, input, context = {}) {
    checkpoint(context);
    const c = await this.getVersion(id, input.version);
    assert(c.analyzedMessageCount === c.messages.length && c.questions.length, '새 답변을 먼저 분석해 주세요.');
    assert(input.kind === 'followup', '현재는 남은 질문의 재문의 초안만 작성할 수 있어요.');
    const language = input.language ?? (c.channel === 'email' && input.kind === 'followup' ? 'en' : 'ko');
    assert(['ko', 'en'].includes(language) && (language !== 'en' || ((c.mode !== 'demo' || c.demoScenario === 'email') && input.kind === 'followup')), '영어는 실제 상담이나 이메일 예제의 재문의 초안에서 선택해 주세요.');
    const ids = Array.isArray(input.questionIds) ? input.questionIds : [];
    const selected = c.questions.filter(q => ids.includes(q.id) && q.status !== 'answered');
    assert(selected.length, '재문의할 미해결 질문을 선택해 주세요.');
    let draft, model, review = null;
    if (c.mode === 'demo') {
      draft = validateDraft(demoDraft(c, input.kind, ids), c); model = '준비된 예제';
    } else {
      const source = { kind: input.kind, ...draftSourceContext(c, input.kind), questions: draftQuestionContext(selected) };
      let revisionFeedback = '', previousDraft = null;
      // Bound paid calls: one generation + review, with at most one repair attempt.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.ask({ name: 'replytrack_draft', schema: draftSchemaFor(c.messages), instructions: DRAFT_PROMPT + draftLanguagePrompt(language), reasoningEffort: attempt === 0 ? 'low' : 'medium',
          data: { ...source, ...(revisionFeedback ? { revisionFeedback, previousDraft } : {}) } }, context, attempt ? 'draft_repair' : 'draft');
        checkpoint(context, 'validation');
        model = result.model; previousDraft = result.data;
        let candidate;
        try {
          candidate = validateDraft(result.data, c);
          if (language === 'en' && (candidate.body.match(/[A-Za-z]/g)?.length || 0) <= (candidate.body.replace(/\[[^\]]+\]/g, '').match(/[가-힣]/g)?.length || 0)) throw new AppError(502, '영어 답장 본문을 영어로 작성해 주세요.', 'DRAFT_LANGUAGE');
        }
        catch (error) {
          if (attempt === 1) throw error;
          revisionFeedback = error.message; continue;
        }
        const checked = await this.ask({ name: 'replytrack_draft_review', schema: draftReviewSchema, instructions: DRAFT_REVIEW_PROMPT + draftLanguagePrompt(language), reasoningEffort: 'medium',
          data: { ...source, draft: candidate } }, context, 'draft_review');
        if (reviewPassed(checked.data, draftChecks)) {
          draft = candidate; review = { model: checked.model, attempts: attempt + 1 }; break;
        }
        // A reviewer can itself invent a requirement. Retry from authoritative source
        // data instead of promoting its suggested facts or the rejected draft to input.
        previousDraft = null;
        revisionFeedback = '이전 초안이 독립 검토를 통과하지 못했습니다. 원문 messages와 사용자가 선택한 questions를 다시 대조해 소비자 입장의 새 재문의를 작성하세요. 부분 답변의 이미 받은 정보는 제외하고 실제 남은 정보만 빠짐없이 묻되 새 질문이나 미확인 배경 사실을 추가하지 마세요.';
      }
      if (!draft) throw new AppError(502, '초안을 검토했지만 선택한 질문이나 원문과 맞지 않는 부분이 남아 저장하지 않았습니다. 다시 작성해 주세요.', 'DRAFT_REVIEW');
    }
    checkpoint(context, 'saving');
    c.drafts.followup = { ...draft, questionIds: selected.map(q => q.id), language, at: new Date().toISOString(), model, ...(review ? { review } : {}) };
    history(c, 'draft', '남은 질문으로 재문의 초안을 만들었어요');
    return await this.commit(c, input.version, context);
  }
  async prepare(input, context = {}) {
    checkpoint(context, 'masking');
    assert(input.ocrLanguage === undefined || ['eng', 'kor+eng'].includes(input.ocrLanguage), '캡처 언어를 확인해 주세요.');
    assert((typeof input.text === 'string' && input.text.trim()) || (typeof input.image === 'string' && input.image.length), '상담 텍스트나 캡처를 등록해 주세요.');
    if (input.text) cleanText(input.text, 30000, '상담 텍스트');
    if (input.image) {
      assert(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input.image) && input.image.length < 5600000, 'PNG, JPEG, WebP 형식의 4MB 이하 캡처를 선택해 주세요.');
      const bytes = Buffer.from(input.image.split(',')[1], 'base64');
      const kind = input.image.match(/^data:image\/(\w+)/)[1];
      const valid = kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : kind === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      assert(valid, '이미지 파일 형식과 내용이 일치하지 않습니다.');
    }
    const text = [input.text || '', input.image ? await this.ocr(input.image, { ...context, ocrLanguage: input.ocrLanguage }) : ''].filter(Boolean).join('\n\n');
    checkpoint(context, 'masking');
    cleanText(text, 30000, '읽은 상담 텍스트');
    const masked = privacyEnvelope(text);
    return { text: masked.data, counts: masked.counts };
  }
  async extract(input, context = {}) {
    const prepared = await this.prepare(input, context);
    const email = input.channel === 'email';
    const existing = input.caseId ? (await this.getVersion(input.caseId, input.version)).messages : [];
    const myAddress = email && typeof input.myAddress === 'string' ? cleanText(input.myAddress, 254, '내 발신 이메일 주소') : '';
    const r = await this.ask({ name: 'replytrack_transcript', schema: transcriptSchema, instructions: TRANSCRIPT_PROMPT + (email ? `\n${EMAIL_TRANSCRIPT_PROMPT}` : ''), data: { text: prepared.text, ...(email ? { myAddress, existingMessages: existing } : {}) } }, context, 'reading');
    const data = r.data;
    if (!data || !Array.isArray(data.messages) || !data.messages.length || data.messages.length > 60 || data.messages.some(m => !['customer','agent','unknown'].includes(m.role) || typeof m.text !== 'string' || !m.text.trim() || m.text.length > 6000)) throw new AppError(422, '읽을 수 있는 대화를 찾지 못했습니다. 직접 입력하거나 다른 캡처로 시도해 주세요.');
    checkpoint(context, 'validation');
    if (email) {
      data.messages = validateEmailTranscript(data.messages, prepared.text, existing);
      assert(data.messages.length, '이미 등록된 이메일만 있어요. 새 본문을 확인해 주세요.');
    }
    return { messages: data.messages.map(m => ({ role: m.role, text: maskPrivate(m.text), sentAt: m.sentAt && Number.isFinite(Date.parse(m.sentAt)) ? new Date(m.sentAt).toISOString() : null })), notes: Array.isArray(data.notes) ? data.notes.filter(x => typeof x === 'string').map(maskPrivate) : [], model: r.model };
  }
}
