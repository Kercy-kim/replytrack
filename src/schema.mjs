const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const evidenceSchema = object({ messageId: text, quote: text });
export const analysisSchema = object({
  summary: text,
  questions: array(object({
    id: text, title: text, source: evidenceSchema,
    reason: text,
    status: { type: 'string', enum: ['unanswered', 'partial', 'waiting', 'answered', 'review'] },
    evidence: array(evidenceSchema), followUp: text,
  })),
  promises: array(object({
    id: text, title: text, questionIds: array(text), evidence: evidenceSchema,
    dueText: text, deadlineCleared: { type: 'boolean' }, state: { type: 'string', enum: ['promised', 'reported'] },
  })),
});
export const transcriptSchema = object({
  messages: array(object({
    role: { type: 'string', enum: ['customer', 'agent', 'unknown'] },
    text, sentAt: nullableText,
  })),
  notes: array(text),
});
export const draftSchema = object({ body: text, sourceMessageIds: array(text) });
export const draftReviewSchema = object({ valid: { type: 'boolean' }, feedback: text });
