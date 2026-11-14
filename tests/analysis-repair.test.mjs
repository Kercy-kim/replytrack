import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';

function output(data, broken = false) {
  if (!data.existingQuestions) return { model: 'test', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, data: { questions: data.questions.map(q => ({ id: q.id, status: 'review', reason: '실질 정보 없이 결과 미정' })) } };
  const [customer, agent] = data.messages;
  return { model: 'test', usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, data: {
    summary: '결과 미정', questions: [{ id: data.existingQuestions[0]?.id || 'new-q-1', title: '검수 결과',
      source: { messageId: customer.id, quote: broken ? '원문을 바꾼 질문' : customer.text },
      status: 'review', reason: '결과 미등록', evidence: [{ messageId: agent.id, quote: broken ? '바꿔 쓴 안내' : agent.text }], followUp: '결과를 알려 주세요.' }], promises: [],
  } };
}
const input = { title: '인용 검증', messages: [{ role: 'customer', text: '검수 결과가 나왔나요?' }, { role: 'agent', text: '결과가 등록되지 않았습니다.' }] };

test('contradictory unanswered-with-evidence output is repaired without deleting evidence by rule', async () => {
  const store = new CaseStore(':memory:'), requests = [];
  try {
    const service = new ReplyTrack(store, { async structured(request) {
      requests.push(request);
      const response = output(request.data);
      if (requests.length === 1) response.data.questions[0].status = 'unanswered';
      return response;
    } });
    const c = service.create(input), saved = await service.analyze(c.id, c.version);
    assert.match(requests[1].data.revisionFeedback, /status\/evidence/);
    assert.equal(saved.questions[0].status, 'review');
    assert.equal(saved.questions[0].evidence[0].quote, input.messages[1].text);
    assert.equal(saved.analysis.attempts, 2); assert.deepEqual(saved.warnings, []);
  } finally { store.close(); }
});

test('analysis repairs invalid quotes once, validates them, and counts repair plus boundary review usage', async () => {
  const store = new CaseStore(':memory:'), requests = [];
  try {
    const service = new ReplyTrack(store, { async structured(request) { requests.push(request); return output(request.data, requests.length === 1); } });
    const c = service.create(input), saved = await service.analyze(c.id, c.version);
    assert.equal(requests.length, 3); assert.match(requests[1].data.revisionFeedback, /questions\[0\].source/);
    assert.match(requests[1].data.revisionFeedback, /questions\[0\].evidence\[0\]/);
    assert.equal(requests[1].data.previousAnalysis.questions[0].source.quote, '원문을 바꾼 질문');
    assert.equal(saved.questions[0].source.quote, input.messages[0].text);
    assert.equal(saved.questions[0].evidence[0].quote, input.messages[1].text);
    assert.deepEqual(saved.warnings, []); assert.equal(saved.analysis.attempts, 2);
    assert.equal(saved.analysis.usage.input_tokens, 30); assert.equal(saved.analysis.usage.output_tokens, 15);
    assert.equal(saved.analysis.usage.total_tokens, 45);
  } finally { store.close(); }
});

test('a failed repair or provider failure cannot overwrite the previous analysis or appended source', async () => {
  for (const providerFailure of [false, true]) {
    const store = new CaseStore(':memory:');
    try {
      const service = new ReplyTrack(store, { structured: async request => output(request.data) });
      let c = service.create(input); c = await service.analyze(c.id, c.version);
      c = service.append(c.id, { version: c.version, role: 'agent', text: '아직 결과 미정입니다.' });
      const before = structuredClone(c); let calls = 0;
      service.ai = { async structured(request) { calls++; if (providerFailure && calls === 2) throw new Error('provider unavailable'); return output(request.data, true); } };
      await assert.rejects(service.analyze(c.id, c.version), error => providerFailure ? error.message === 'provider unavailable' : error.code === 'AI_EVIDENCE');
      assert.equal(calls, 2); assert.deepEqual(store.get(c.id), before); assert.equal(service.activeAI, 0); assert.equal(service.busy.size, 0);
    } finally { store.close(); }
  }
});

test('a concurrent user edit stops the paid repair before another request', async () => {
  const store = new CaseStore(':memory:');
  try {
    const service = new ReplyTrack(store, null); const c = service.create(input); let calls = 0;
    service.ai = { async structured(request) { calls++; service.metadata(c.id, { version: c.version, title: '사용자가 바꾼 제목' }); return output(request.data, true); } };
    await assert.rejects(service.analyze(c.id, c.version), error => error.status === 409);
    assert.equal(calls, 1); assert.equal(store.get(c.id).title, '사용자가 바꾼 제목');
    assert.equal(store.get(c.id).analysis, null);
  } finally { store.close(); }
});
