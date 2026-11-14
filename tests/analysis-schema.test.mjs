import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema, analysisSchemaFor } from '../src/schema.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';

test('analysis reference constraints isolate conversations and speaker roles', () => {
  const schema = analysisSchemaFor([{ id: 'customer-a', role: 'customer' }, { id: 'agent-a', role: 'agent' }, { id: 'unknown-a', role: 'unknown' }]);
  const question = schema.properties.questions.items.properties;
  assert.deepEqual(question.source.properties.messageId.enum, ['customer-a']);
  assert.deepEqual(question.evidence.items.properties.messageId.enum, ['agent-a']);
  assert.deepEqual(schema.properties.promises.items.properties.evidence.properties.messageId.enum, ['agent-a']);
  const other = analysisSchemaFor([{ id: 'customer-b', role: 'customer' }, { id: 'agent-b', role: 'agent' }]);
  assert.deepEqual(other.properties.questions.items.properties.source.properties.messageId.enum, ['customer-b']);
  assert.deepEqual(question.source.properties.messageId.enum, ['customer-a']);
  assert.equal(analysisSchema.properties.questions.items.properties.source.properties.messageId.enum, undefined);
});

test('without an agent reply the schema cannot generate reply evidence or commitments', () => {
  const schema = analysisSchemaFor([{ id: 'customer', role: 'customer' }]);
  assert.equal(schema.properties.questions.items.properties.evidence.maxItems, 0);
  assert.equal(schema.properties.promises.maxItems, 0);
  assert.equal(analysisSchemaFor([]).properties.questions.maxItems, 0);
});

test('analysis service sends fresh reference constraints after a reply without changing stored IDs', async () => {
  const store = new CaseStore(':memory:'), requests = [];
  try {
    const service = new ReplyTrack(store, { async structured(input) {
      requests.push(input);
      const { messages, existingQuestions } = input.data;
      return { model: 'test', data: { summary: '답변 확인', questions: [{ id: existingQuestions[0]?.id || 'new-q-1', title: '이용 기간',
        source: { messageId: messages[0].id, quote: messages[0].text }, status: 'answered', reason: '기간 안내', followUp: '',
        evidence: [{ messageId: messages.at(-1).id, quote: messages.at(-1).text }] }], promises: [] } };
    } });
    let c = service.create({ title: '기간 문의', messages: [{ role: 'customer', text: '이용 기간이 며칠인가요?' }, { role: 'agent', text: '30일입니다.' }] });
    c = await service.analyze(c.id, c.version);
    const originalQuestionId = c.questions[0].id, originalSource = c.questions[0].source;
    c = service.append(c.id, { version: c.version, role: 'agent', text: '정정합니다. 이용 기간은 60일입니다.' });
    c = await service.analyze(c.id, c.version);
    const refs = request => request.schema.properties.questions.items.properties.evidence.items.properties.messageId.enum;
    assert.deepEqual(refs(requests[0]), [c.messages[1].id]);
    assert.deepEqual(refs(requests[1]), [c.messages[1].id, c.messages[2].id]);
    assert.equal(requests[1].reasoningEffort, 'medium');
    assert.equal(c.questions[0].id, originalQuestionId); assert.deepEqual(c.questions[0].source, originalSource);
    assert.equal(c.questions[0].evidence[0].messageId, c.messages[2].id);
    assert.deepEqual(c.warnings, []);
  } finally { store.close(); }
});
