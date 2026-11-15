import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisSchema, analysisSchemaFor } from '../src/schema.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack, analysisReasoningEffort } from '../src/service.mjs';

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

test('email titles have a Korean constraint without changing quotes or the chat schema', () => {
  const messages = [{ id: 'c', role: 'customer' }, { id: 'a', role: 'agent' }];
  const email = analysisSchemaFor(messages, 'email').properties.questions.items.properties;
  assert.equal(email.title.pattern, '[가-힣]');
  assert.equal(email.source.properties.quote.pattern, undefined);
  assert.equal(analysisSchemaFor(messages).properties.questions.items.properties.title.pattern, undefined);
  assert.equal(analysisSchema.properties.questions.items.properties.title.pattern, undefined);
});

test('an untranslated email title is repaired at medium before saving while source remains English', async () => {
  const store = new CaseStore(':memory:'), requests = [];
  try {
    const svc = new ReplyTrack(store, { async structured(request) {
      requests.push(request); const [c, a] = request.data.messages;
      return { model: 'test', data: { summary: '자료 안내', questions: [{ id: 'q', title: requests.length === 1 ? 'Which document?' : '필요한 자료', source: { messageId: c.id, quote: c.text }, status: 'answered', reason: '영수증이라고 안내받았습니다.', evidence: [{ messageId: a.id, quote: a.text }], followUp: '' }], promises: [] } };
    } });
    const c = svc.create({ channel: 'email', title: '이메일', messages: [{ role: 'customer', text: 'Which document?' }, { role: 'agent', text: 'Please send the receipt.' }] });
    const saved = await svc.analyze(c.id, c.version);
    assert.deepEqual(requests.map(r => r.reasoningEffort), ['medium', 'medium']);
    assert.match(requests[1].data.revisionFeedback, /한국어 제목/);
    assert.equal(saved.questions[0].title, '필요한 자료');
    assert.equal(saved.questions[0].source.quote, 'Which document?');
  } finally { store.close(); }
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
    assert.deepEqual(requests.map(request => request.reasoningEffort), ['low', 'medium']);
    assert.equal(c.questions[0].id, originalQuestionId); assert.deepEqual(c.questions[0].source, originalSource);
    assert.equal(c.questions[0].evidence[0].messageId, c.messages[2].id);
    assert.deepEqual(c.warnings, []);
  } finally { store.close(); }
});

test('routine replies use low effort while corrections, conditional policies and long context keep medium', () => {
  const record = text => ({ messages: [{ role: 'customer', text: 'When will it arrive?' }, { role: 'agent', text }] });
  for (const text of ['내일 도착 예정입니다.', 'It will arrive on November 20.']) assert.equal(analysisReasoningEffort(record(text)), 'low');
  const email = { ...record('Please send the receipt number.'), channel: 'email', questions: [] };
  assert.equal(analysisReasoningEffort(email), 'medium');
  assert.equal(analysisReasoningEffort({ ...email, questions: [{ id: 'existing-question' }] }), 'medium');
  for (const text of ['앞서 안내한 날짜를 정정합니다.', '이전 기한은 철회하며 다시 안내하겠습니다.', 'The previous date was incorrect. It will arrive on November 21 instead.', 'The delivery date has changed.', 'We retract the deadline.']) assert.equal(analysisReasoningEffort(record(text)), 'medium');
  for (const text of ['사용한 제품은 원칙적으로 환불 불가하지만 불량이면 가능합니다.', 'A refund is available only if a duplicate charge is confirmed.', 'You cannot change it unless it has not shipped.']) assert.equal(analysisReasoningEffort(record(text)), 'medium');
  assert.equal(analysisReasoningEffort(record('a'.repeat(8001))), 'medium');
  assert.equal(analysisReasoningEffort({ messages: Array.from({ length: 9 }, () => ({ role: 'agent', text: '내용' })) }), 'medium');
});
