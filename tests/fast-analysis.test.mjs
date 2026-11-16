import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyTrack, fastInitialAnalysis, futureAnswerNeedsReview, partialScopeNeedsReview, durationPromiseNeedsReview } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { timingCases } from '../evals/timing-cases.mjs';
import { FOCUSED_ANALYSIS_PROMPT } from '../src/analysis-focus.mjs';

test('fast initial routing excludes email, corrections, conditional and long histories', () => {
  const base = { messages: timingCases[0].messages, questions: [], analysis: null };
  assert.equal(fastInitialAnalysis(base), true);
  assert.equal(fastInitialAnalysis({ ...base, messages: timingCases[3].messages }), false);
  assert.equal(fastInitialAnalysis({ ...base, messages: [...base.messages, { role: 'agent', text: 'The delivery date has changed. We will inform you tomorrow.' }] }), false);
  for (const extra of [{ channel: 'email' }, { analysis: {} }, { questions: [{}] }, { messages: [...base.messages, ...base.messages, ...base.messages] }, { messages: [...base.messages, { role: 'agent', text: '정정합니다.' }] }, { messages: [...base.messages, { role: 'agent', text: '승인되면 가능합니다.' }] }, { messages: [...base.messages, { role: 'agent', text: '긴 설명'.repeat(700) }] }]) assert.equal(fastInitialAnalysis({ ...base, ...extra }), false);
});

test('suspect duration-only promises trigger semantic repair without dropping real receipt evidence', async () => {
  const store = new CaseStore(':memory:'); const calls = [];
  try {
    const service = new ReplyTrack(store, { async structured(args) {
      calls.push(args);
      const ref = { messageId: args.data.messages[1].id, quote: args.data.messages[1].text };
      return { model: 'fixture', data: { summary: '자료 수신 및 심사 기간', questions: calls.length === 1 ? [{ id: 'q', title: '심사 소요 기간', source: { messageId: args.data.messages[0].id, quote: args.data.messages[0].text }, status: 'answered', reason: '심사는 3영업일 걸린다고 안내받았습니다.', evidence: [ref], followUp: '' }] : [], promises: [{ id: 'receipt', title: '자료 수신', state: 'reported', questionIds: [], dueText: '', evidence: { ...ref, quote: 'We received your transaction ID.' } }, ...(calls.length === 1 ? [{ id: 'duration', title: '심사 기간 안내', state: 'promised', questionIds: ['q'], dueText: '3 business days', evidence: ref }] : [])] } };
    } });
    const c = service.create({ title: '심사', channel: 'email', messages: [{ role: 'customer', text: 'How long will the review take?' }, { role: 'agent', text: 'We received your transaction ID. The review will take 3 business days.' }] });
    const saved = await service.analyze(c.id, c.version);
    assert.equal(calls.length, 2); assert.match(calls[1].data.revisionFeedback, /소요 기간/);
    assert.equal(saved.promises.length, 1); assert.equal(saved.promises[0].state, 'reported'); assert.equal(saved.questions[0].status, 'answered');
    assert.equal(durationPromiseNeedsReview({ promises: [{ state: 'promised', evidence: { quote: 'We will review your case and send the result within 3 business days.' } }] }, { channel: 'email' }), false);
  } finally { store.close(); }
});

for (const [name, first, final, question] of [
  ['correct waiting needs only one request', 'waiting', 'waiting', 0],
  ['future information misread as answered gets medium reanalysis', 'answered', 'waiting', 0],
  ['question about notification date can remain answered after review', 'answered', 'answered', 1],
  ['notification timing misread as waiting gets medium review without automatic status changes', 'waiting', 'answered', 1],
]) test(name, async () => {
  const store = new CaseStore(':memory:');
  try {
    const calls = [];
    const service = new ReplyTrack(store, { async structured(args) {
      calls.push(args);
      const [customer, agent] = args.data.messages;
      return { model: 'fixture', data: { summary: '환불 안내 일정 확인', warnings: [], questions: [{ id: 'q', title: '환불 예정일 문의', source: { messageId: customer.id, quote: customer.text }, status: calls.length === 1 ? first : final, reason: '11월 18일까지 예정일을 안내한다고 합니다.', evidence: [{ messageId: agent.id, quote: agent.text }] }], promises: [{ id: 'p', title: '예정일 안내', questionIds: ['q'], state: 'promised', dueText: '11월 18일', evidence: { messageId: agent.id, quote: agent.text } }] } };
    } });
    const c = service.create({ title: name, messages: timingCases[question].messages });
    const result = await service.analyze(c.id, c.version);
    assert.equal(result.questions[0].status, final);
    assert.equal(calls[0].reasoningEffort, 'low');
    assert.equal(calls.length, first === 'waiting' && question === 0 ? 1 : 2);
    assert(!calls[0].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));
    if (calls.length === 2) {
      assert.equal(calls[1].reasoningEffort, 'medium'); assert.match(calls[1].data.revisionFeedback, /자동/);
      assert(calls[1].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));
      assert.deepEqual(calls[1].data.messages, calls[0].data.messages);
      assert(!calls[1].schema.properties.questions.items.properties.followUp);
      assert(!calls[1].schema.properties.questions.items.properties.source);
      assert.deepEqual(calls[1].data.review.questionIds, ['q']);
      assert.deepEqual(result.questions[0].source, { messageId: c.messages[0].id, quote: c.messages[0].text });
    }
  } finally { store.close(); }
});

test('completed old information promises do not force another review; pending promises do', () => {
  const old = { messageId: 'old', quote: '장소를 확인해 안내하겠습니다.' };
  const latest = { messageId: 'latest', quote: '보관 장소는 경비실입니다.' };
  const record = { messages: [{ id: 'old', role: 'agent' }, { id: 'latest', role: 'agent' }] };
  const data = { questions: [{ id: 'q', status: 'answered', evidence: [old, latest] }], promises: [{ questionIds: ['q'], state: 'reported', evidence: old }] };
  assert.equal(futureAnswerNeedsReview(data, record), false);
  data.promises[0].state = 'promised';
  data.questions[0].evidence = [latest]; // A shortened question citation cannot hide a pending information promise.
  assert.equal(futureAnswerNeedsReview(data, record), true);
});

for (const final of ['answered', 'partial']) test(`suspected extra email requirements are reviewed, not automatically marked ${final}`, async () => {
  const store = new CaseStore(':memory:'); const calls = [];
  try {
    const service = new ReplyTrack(store, { async structured(args) {
      calls.push(args);
      return { model: 'fixture', data: { summary: '자료 문의', questions: [{ id: 'q', title: '필요한 자료', status: calls.length === 1 ? 'partial' : final, reason: '거래 ID는 안내받았지만 다른 필요한 자료는 확인되지 않았습니다.', source: { messageId: args.data.messages[0].id, quote: args.data.messages[0].text }, evidence: [{ messageId: args.data.messages[1].id, quote: args.data.messages[1].text }], followUp: '' }], promises: [] } };
    } });
    const c = service.create({ title: '자료', channel: 'email', messages: [{ role: 'customer', text: 'What documents do I need?' }, { role: 'agent', text: 'Please provide your transaction ID.' }] });
    const saved = await service.analyze(c.id, c.version);
    assert.equal(calls.length, 2); assert(calls.every(c => c.reasoningEffort === 'medium'));
    assert.match(calls[1].data.revisionFeedback, /누락 사유/);
    assert.equal(saved.questions[0].status, final);
    assert.equal(partialScopeNeedsReview({ questions: [{ status: 'partial', reason: '다른 자료는 미정입니다.' }] }, { channel: 'chat' }), false);
  } finally { store.close(); }
});
