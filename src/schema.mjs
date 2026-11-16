import { draftChecks, featureReviewSchema } from './feature-review.mjs';
const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
// One explanation contract for initial analysis and the partial/review check.
// Do not require a missing-information clause when the requested answer is complete.
const questionReason = { type: 'string', description: '화면에 표시할 짧은 한국어 한 문장. 핵심 사실을 보존하면서 보통 30~70자 정도로 쓴다(길이 때문에 사실을 삭제하지 않는다). answered: 받은 답만 설명하고 누락·단서 후문을 붙이지 않는다. partial: 받은 부분 정보와 이 질문에서 아직 모르는 부분만 쓴다. waiting: 이 질문의 답을 확인해 안내하겠다는 약속만 쓴다. review: 이 질문의 미정·식별 불가·상충 사유만 쓴다. unanswered: 관련 안내가 없다고만 쓴다. 질문 반복, 원문 문장 재인용, 괄호로 같은 뜻 풀이, 분류 절차, 묻지 않은 추가 항목은 생략한다. 업체의 안내임을 밝혀 직접 처리하거나 확인한 것처럼 말하지 않는다.' };
export const evidenceSchema = object({ messageId: text, quote: text });
export const analysisSchema = object({
  summary: text,
  questions: array(object({
    id: text, title: text, source: evidenceSchema,
    status: { type: 'string', enum: ['unanswered', 'partial', 'waiting', 'answered', 'review'], description: '요구한 정보 전부=answered, 명시적인 향후 안내 약속=waiting. 약속 없이 방법·진행 단계·조건·같은 청구 항목의 일부/다른 기간 정보가 있으면 결과가 미정이어도 partial. 유용한 부분 정보 없이 미정이라고만 하거나 해소되지 않은 충돌이면 review. 관련 안내 자체가 없을 때만 unanswered.' },
    reason: questionReason,
    evidence: array(evidenceSchema), followUp: text,
  })),
  promises: array(object({
    id: text, title: text, questionIds: array(text), evidence: evidenceSchema,
    dueText: text, deadlineCleared: { type: 'boolean' }, state: { type: 'string', enum: ['promised', 'reported'] },
  })),
});
// Bind references to this conversation and role before constrained generation.
// Keep server-side quote/role validation: an allowed ID alone is not evidence.
export function analysisSchemaFor(messages, channel) {
  const schema = structuredClone(analysisSchema);
  const ids = role => messages.filter(m => m.role === role).map(m => m.id);
  const reference = role => object({ messageId: { type: 'string', ...(ids(role).length ? { enum: ids(role) } : {}) }, quote: text });
  const question = schema.properties.questions.items.properties;
  // Follow-up drafts are generated and reviewed separately from selected questions.
  // Email plans can also omit it when a separate draft flow is available.
  if (channel !== 'email') {
    delete question.followUp;
    schema.properties.questions.items.required = schema.properties.questions.items.required.filter(k => k !== 'followUp');
  }
  if (channel === 'email') question.title = { type: 'string', pattern: '[가-힣]', description: '한국어 사용자가 읽을 질문 제목. 영문 질문도 의미를 보존해 한국어로 쓴다. 원문 인용은 번역하지 않는다.' };
  question.source = reference('customer');
  question.evidence.items = reference('agent');
  schema.properties.promises.items.properties.evidence = reference('agent');
  if (!ids('customer').length) schema.properties.questions.maxItems = 0;
  if (!ids('agent').length) {
    question.evidence.maxItems = 0;
    schema.properties.promises.maxItems = 0;
  }
  return schema;
}
export function completionReviewSchemaFor(messages, questions) {
  const promises = analysisSchemaFor(messages).properties.promises;
  promises.items.properties.state.enum = ['reported'];
  // Shared scalar schema objects must not be mutated: title/dueText also use text.
  if (questions.length) promises.items.properties.questionIds.items = { type: 'string', enum: questions.map(q => q.id) };
  else promises.items.properties.questionIds.maxItems = 0;
  return object({ promises });
}
export const transcriptSchema = object({
  messages: array(object({
    role: { type: 'string', enum: ['customer', 'agent', 'unknown'] },
    text, sentAt: nullableText,
  })),
  notes: array(text),
});
export const draftSchema = object({ body: text, sourceMessageIds: array(text) });
export function draftSchemaFor(messages) {
  return object({ body: text, sourceMessageIds: { type: 'array', minItems: 1, maxItems: messages.length, items: { type: 'string', enum: messages.map(m => m.id) } } });
}
export const draftReviewSchema = featureReviewSchema(draftChecks);
export function boundaryReviewSchemaFor(ids, messages) {
  const evidence = analysisSchemaFor(messages).properties.questions.items.properties.evidence;
  return object({ questions: { ...array(object({ id: { type: 'string', enum: ids }, status: { type: 'string', enum: ['partial', 'review'] }, reason: questionReason, evidence: { ...evidence, minItems: 1 } })), minItems: ids.length, maxItems: ids.length } });
}
