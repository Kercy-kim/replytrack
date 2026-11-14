const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const evidenceSchema = object({ messageId: text, quote: text });
export const analysisSchema = object({
  summary: text,
  questions: array(object({
    id: text, title: text, source: evidenceSchema,
    reason: { type: 'string', description: '해당 질문에 제공된 실질 정보와 아직 빠진 정보를 각각 설명한다. 미정이라는 문장 외에 방법·진행 단계·같은 항목의 다른 기간 정보가 있는지도 확인한다.' },
    status: { type: 'string', enum: ['unanswered', 'partial', 'waiting', 'answered', 'review'], description: '요구한 정보 전부=answered, 명시적인 향후 안내 약속=waiting. 약속 없이 방법·진행 단계·조건·같은 청구 항목의 일부/다른 기간 정보가 있으면 결과가 미정이어도 partial. 유용한 부분 정보 없이 미정이라고만 하거나 해소되지 않은 충돌이면 review. 관련 안내 자체가 없을 때만 unanswered.' },
    evidence: array(evidenceSchema), followUp: text,
  })),
  promises: array(object({
    id: text, title: text, questionIds: array(text), evidence: evidenceSchema,
    dueText: text, deadlineCleared: { type: 'boolean' }, state: { type: 'string', enum: ['promised', 'reported'] },
  })),
});
// Bind references to this conversation and role before constrained generation.
// Keep server-side quote/role validation: an allowed ID alone is not evidence.
export function analysisSchemaFor(messages) {
  const schema = structuredClone(analysisSchema);
  const ids = role => messages.filter(m => m.role === role).map(m => m.id);
  const reference = role => object({ messageId: { type: 'string', ...(ids(role).length ? { enum: ids(role) } : {}) }, quote: text });
  const question = schema.properties.questions.items.properties;
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
export const draftReviewSchema = object({ valid: { type: 'boolean' }, feedback: text });
export function boundaryReviewSchemaFor(ids) {
  return object({ questions: { ...array(object({ id: { type: 'string', enum: ids }, status: { type: 'string', enum: ['partial', 'review'] }, reason: text })), minItems: ids.length, maxItems: ids.length } });
}
