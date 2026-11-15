import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { semanticReviewPlan } from '../src/analysis-focus.mjs';
import { compactReferences } from '../src/ai-wire.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { newCase } from '../src/domain.mjs';

const fixture = () => {
  const customer = { id: randomUUID(), role: 'customer', text: 'What documents do I need? How long will it take?' };
  const agent = { id: randomUUID(), role: 'agent', text: 'Please provide your transaction ID.' };
  const questions = [
    { id: randomUUID(), title: '필요한 자료', status: 'partial', reason: '다른 자료는 확인되지 않았습니다.', source: { messageId: customer.id, quote: 'What documents do I need?' }, evidence: [{ messageId: agent.id, quote: agent.text }], followUp: '다른 자료도 알려 주세요.' },
    { id: randomUUID(), title: '소요 기간', status: 'unanswered', reason: '관련 안내가 없습니다.', source: { messageId: customer.id, quote: 'How long will it take?' }, evidence: [], followUp: '기간을 알려 주세요.' },
  ];
  return { record: { channel: 'email', messages: [customer, agent] }, first: { summary: '자료 확인', questions, promises: [] } };
};

test('semantic repair narrows output without treating old decisions as facts or changing unrelated questions', () => {
  const { record, first } = fixture(), original = structuredClone(first), q = first.questions[0];
  const plan = semanticReviewPlan(record, first, [q.id]);
  assert.deepEqual(plan.input.reviewQuestions.map(x => Object.keys(x).sort()), [['id', 'source', 'title'], ['id', 'source', 'title']]);
  assert.equal(plan.schema.properties.questions.maxItems, 1);
  const result = plan.restore({ summary: '자료 안내', questions: [{ id: q.id, title: '필요한 자료', status: 'answered', reason: '거래 ID를 보내라고 안내받았습니다.', evidence: q.evidence, source: { messageId: 'forged', quote: 'forged' } }], promises: [] });
  assert.deepEqual(result.questions[0].source, q.source); assert.equal(result.questions[0].followUp, '');
  assert.deepEqual(result.questions[1], first.questions[1]); assert.deepEqual(first, original);
  assert(!('source' in plan.schema.properties.questions.items.properties));
});

test('missing, duplicated and unrelated repair identities cannot modify the merged analysis', () => {
  const { record, first } = fixture(), q = first.questions[0], plan = semanticReviewPlan(record, first, [q.id]);
  for (const questions of [[], [q, q], [{ ...q, id: first.questions[1].id }], [{ ...q, id: 'invented' }]]) assert.throws(() => plan.restore({ questions, promises: [] }), { code: 'AI_EVIDENCE' });
  const promisesOnly = semanticReviewPlan(record, first, []);
  assert(!promisesOnly.schema.properties.questions);
  assert.deepEqual(promisesOnly.restore({ summary: '검토', promises: [] }).questions, first.questions);
  assert.deepEqual(promisesOnly.restore({ summary: '검토', questions: [], promises: [] }).questions, first.questions);
  assert.throws(() => promisesOnly.restore({ questions: [q], promises: [] }), { code: 'AI_EVIDENCE' });
});

test('repair reference aliases match the scoped schema and round-trip without changing source text', () => {
  const { record, first } = fixture(), id = first.questions[0].id, plan = semanticReviewPlan(record, first, [id]);
  const wire = compactReferences({ messages: record.messages, ...plan.input }, plan.schema);
  assert.notEqual(wire.data.review.questionIds[0], id);
  assert.equal(wire.data.review.questionIds[0], wire.schema.properties.questions.items.properties.id.enum[0]);
  assert.equal(wire.data.review.questionIds[0], wire.data.reviewQuestions[0].id);
  assert.equal(wire.decode({ questions: [{ id: wire.data.review.questionIds[0] }] }).questions[0].id, id);
  assert.equal(wire.data.messages[0].text, record.messages[0].text);
});

for (const mode of ['invalid', 'cancelled', 'conflict']) test(`${mode} scoped repair preserves stored records and draft edits`, async () => {
  const { record, first } = fixture(), store = new CaseStore(':memory:');
  try {
    let count = 0, c, expected;
    const controller = new AbortController();
    const service = new ReplyTrack(store, { async structured(args) {
      count++;
      if (count === 1) return { model: 'fixture', data: first };
      assert.equal(args.reasoningEffort, 'medium');
      if (mode === 'cancelled') controller.abort();
      if (mode === 'conflict') expected = store.save({ ...store.get(c.id), title: '사용자가 수정한 제목' }, c.version);
      return { model: 'fixture', data: { summary: '자료 안내', questions: mode === 'invalid' ? [] : [{ ...first.questions[0], status: 'answered', reason: '거래 ID를 보내라고 안내받았습니다.' }], promises: [] } };
    } });
    c = store.create({ ...newCase({ ...record, title: '자료' }), messages: record.messages, drafts: { followup: { body: '기존 편집 내용' } } }); expected = c;
    await assert.rejects(service.analyze(c.id, c.version, { signal: controller.signal }), error => mode === 'invalid' ? error.code === 'AI_EVIDENCE' : mode === 'cancelled' ? error.code === 'OPERATION_CANCELLED' : error.status === 409);
    assert.equal(count, 2); assert.deepEqual(store.get(c.id), expected); assert.equal(service.busy.size, 0);
  } finally { store.close(); }
});
