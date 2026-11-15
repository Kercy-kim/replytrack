import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { completionReviewSchemaFor, analysisSchema } from '../src/schema.mjs';

test('completion schema constrains links without constraining titles, IDs or dates to question IDs', () => {
  const p = completionReviewSchemaFor([], [{ id: 'q1' }]).properties.promises.items.properties;
  assert.deepEqual(p.questionIds.items.enum, ['q1']);
  for (const key of ['id', 'title', 'dueText']) assert.equal(p[key].enum, undefined);
  assert.equal(analysisSchema.properties.promises.items.properties.questionIds.items.enum, undefined);
});

const input = { title: '해제 통보', messages: [{ role: 'customer', text: '자동 갱신이 꺼졌나요?' }, { role: 'agent', text: '자동 갱신을 해제했습니다.' }] };
function initial(data) {
  return { summary: '해제 안내', questions: [{ id: 'q1', title: '자동 갱신 상태', source: { messageId: data.messages[0].id, quote: data.messages[0].text }, status: 'answered', reason: '해제했다고 안내받았습니다.', evidence: [{ messageId: data.messages[1].id, quote: data.messages[1].text }], followUp: '' }], promises: [] };
}
const completion = data => ({ id: data.existingPromises[0]?.id || 'p1', title: '자동 갱신 해제', questionIds: ['q1'], evidence: { messageId: data.messages[1].id, quote: data.messages[1].text }, dueText: '', deadlineCleared: false, state: 'reported' });

test('missing completion review preserves raw output and user confirmation, validates sources and counts usage', async t => {
  const store = new CaseStore(':memory:'); t.after(() => store.close()); const calls = [], raw = [];
  const svc = new ReplyTrack(store, { async structured(request) {
    calls.push(request.name);
    assert.equal(request.reasoningEffort, request.name === 'replytrack_analysis' ? 'low' : 'medium');
    const data = request.name === 'replytrack_analysis' ? initial(request.data) : { promises: [completion(request.data)] };
    raw.push(data); return { data, model: 'fixture', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  } });
  let c = svc.create(input); c = await svc.analyze(c.id, c.version);
  assert.deepEqual(calls, ['replytrack_analysis', 'replytrack_completion_review']);
  assert.deepEqual(raw[0].promises, []);
  assert.equal(c.questions[0].status, 'answered'); assert.equal(c.promises[0].state, 'reported');
  assert.equal(c.promises[0].confirmedAt, null); assert.equal(c.analysis.usage.total_tokens, 30);
  const id = c.promises[0].id; c = svc.promise(c.id, id, { version: c.version, confirmed: true });
  const confirmed = c.promises[0].confirmedAt; c = await svc.analyze(c.id, c.version);
  assert.equal(c.promises[0].id, id); assert.equal(c.promises[0].confirmedAt, confirmed);
});

test('completion cue does not turn a negated policy example into a completed action', async t => {
  const store = new CaseStore(':memory:'); t.after(() => store.close()); let reviewed = false;
  const svc = new ReplyTrack(store, { async structured(request) {
    if (request.name === 'replytrack_analysis') return { data: initial(request.data), model: 'fixture' };
    reviewed = true; return { data: { promises: [] }, model: 'fixture' };
  } });
  const c = svc.create({ ...input, messages: [input.messages[0], { role: 'agent', text: '일반 처리 기간 설명이며 고객님 건의 완료 통보가 아닙니다.' }] });
  const saved = await svc.analyze(c.id, c.version);
  assert(reviewed); assert.deepEqual(saved.promises, []);
});

test('ordinary answers and already extracted actions do not incur completion review calls', async t => {
  const store = new CaseStore(':memory:'); t.after(() => store.close());
  for (const extracted of [false, true]) {
    const svc = new ReplyTrack(store, { async structured(request) {
      assert.equal(request.name, 'replytrack_analysis'); const data = initial(request.data);
      if (extracted) data.promises = [completion(request.data)];
      return { data, model: 'fixture' };
    } });
    const c = svc.create({ ...input, messages: [input.messages[0], { role: 'agent', text: extracted ? input.messages[1].text : '이용 종료일은 11월 30일입니다.' }] });
    await svc.analyze(c.id, c.version);
  }
});

test('completion review fails atomically for invalid quotes, states, links, duplicate IDs and provider errors', async () => {
  for (const mode of ['quote', 'date', 'state', 'link', 'duplicate', 'provider', 'cancel']) {
    const store = new CaseStore(':memory:'); const controller = new AbortController();
    try {
      const svc = new ReplyTrack(store, { async structured(request) {
        if (request.name === 'replytrack_analysis') return { data: initial(request.data), model: 'fixture' };
        if (mode === 'provider') throw Error('provider failed');
        if (mode === 'cancel') controller.abort();
        const p = completion(request.data);
        if (mode === 'quote') p.evidence.quote = '원문에 없는 완료 통보';
        if (mode === 'date') p.dueText = '내일';
        if (mode === 'state') p.state = 'promised';
        if (mode === 'link') p.questionIds = ['missing'];
        return { data: { promises: mode === 'duplicate' ? [p, p] : [p] }, model: 'fixture' };
      } });
      const c = svc.create(input);
      await assert.rejects(svc.analyze(c.id, c.version, { signal: controller.signal }));
      assert.deepEqual(store.get(c.id), c); assert.equal(svc.busy.size, 0); assert.equal(svc.activeAI, 0);
    } finally { store.close(); }
  }
});
