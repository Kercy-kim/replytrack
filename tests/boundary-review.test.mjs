import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';

const input = { title: '기간별 요금', messages: [{ role: 'customer', text: '이번 이용 기간 요금이 얼마인가요?' }, { role: 'agent', text: '다음 이용 기간은 8,000원입니다. 이번 기간은 아직 모릅니다.' }] };
const analysis = data => ({ summary: '부분 정보', questions: [{ id: data.existingQuestions[0]?.id || 'new-q-1', title: '이번 기간 요금', source: { messageId: data.messages[0].id, quote: data.messages[0].text },
  status: 'review', reason: '검토할 AI 설명', evidence: [{ messageId: data.messages[1].id, quote: data.messages[1].text }], followUp: '이번 요금을 알려 주세요.' }], promises: [] });

test('boundary review preserves evidence, raw output, manual state and existing IDs', async () => {
  const store = new CaseStore(':memory:'), calls = [], originals = [];
  try {
    const service = new ReplyTrack(store, { async structured(request) {
      calls.push(request);
      if (request.name === 'replytrack_analysis') { const data = analysis(request.data); data.questions[0].evidence[0].quote = '이번 기간은 아직 모릅니다.'; originals.push(data); return { data, model: 'analysis-model' }; }
      assert.equal(request.name, 'replytrack_boundary_review');
      assert.equal(request.reasoningEffort, 'medium');
      assert.deepEqual(request.schema.properties.questions.items.properties.evidence.items.properties.messageId.enum, [request.data.messages[1].id]);
      assert.equal('reason' in request.data.questions[0], false); assert.equal('followUp' in request.data.questions[0], false);
      return { model: 'review-model', data: { questions: request.data.questions.map(q => ({ id: q.id, status: 'partial', reason: '다음 기간 요금은 받았지만 이번 기간은 미정', evidence: [{ messageId: request.data.messages[1].id, quote: request.data.messages[1].text }] })) } };
    } });
    let c = service.create(input); c = await service.analyze(c.id, c.version);
    assert.equal(c.questions[0].status, 'partial'); assert.equal(originals[0].questions[0].status, 'review');
    assert.equal(originals[0].questions[0].evidence[0].quote, '이번 기간은 아직 모릅니다.');
    assert.equal(c.questions[0].evidence[0].quote, input.messages[1].text);
    assert.equal(c.analysis.boundaryReview.questions, 1);
    const id = c.questions[0].id;
    c = service.question(c.id, id, { version: c.version, status: 'answered' });
    c = await service.analyze(c.id, c.version);
    assert.equal(c.questions[0].id, id); assert.equal(c.questions[0].status, 'answered'); assert.equal(c.questions[0].aiStatus, 'partial');
    assert.equal(calls.filter(c => c.name === 'replytrack_boundary_review').length, 2);
  } finally { store.close(); }
});

test('boundary review cannot introduce IDs, duplicates, answered status or overwrite state on error', async () => {
  for (const mode of ['unknown', 'duplicate', 'answered', 'provider', 'missing-evidence', 'empty-evidence', 'wrong-role', 'wrong-quote']) {
    const store = new CaseStore(':memory:');
    try {
      const service = new ReplyTrack(store, { async structured(request) {
        if (request.name === 'replytrack_analysis') return { model: 'test', data: analysis(request.data) };
        if (mode === 'provider') throw new Error('review unavailable');
        const q = { id: mode === 'unknown' ? 'invented' : request.data.questions[0].id, status: mode === 'answered' ? 'answered' : 'partial', reason: '부분 정보', evidence: [{ messageId: request.data.messages[mode === 'wrong-role' ? 0 : 1].id, quote: mode === 'wrong-quote' ? '새로 만든 안내' : request.data.messages[1].text }] };
        if (mode === 'missing-evidence') delete q.evidence;
        if (mode === 'empty-evidence') q.evidence = [];
        return { model: 'test', data: { questions: mode === 'duplicate' ? [q, q] : [q] } };
      } });
      const c = service.create(input);
      await assert.rejects(service.analyze(c.id, c.version), error => mode === 'provider' ? error.message === 'review unavailable' : error.code === 'AI_BOUNDARY');
      assert.deepEqual(store.get(c.id), c); assert.equal(service.busy.size, 0); assert.equal(service.activeAI, 0);
    } finally { store.close(); }
  }
});

test('boundary review sees separately asked topics but can only decide the uncertain question', async () => {
  const store = new CaseStore(':memory:');
  try {
    const service = new ReplyTrack(store, { async structured(request) {
      if (request.name === 'replytrack_analysis') {
        const raw = analysis(request.data);
        raw.questions.unshift({ ...structuredClone(raw.questions[0]), id: 'other-q', title: '별도 처리 상태', status: 'answered', followUp: '' });
        return { model: 'test', data: raw };
      }
      assert.equal(request.data.questions.length, 1);
      assert.deepEqual(Object.keys(request.data.questions[0]).sort(), ['id', 'source', 'title']);
      assert.deepEqual(request.data.otherQuestions.map(q => q.id), ['other-q']);
      assert.deepEqual(Object.keys(request.data.otherQuestions[0]).sort(), ['id', 'source', 'title']);
      return { model: 'test', data: { questions: [{ id: request.data.questions[0].id, status: 'review', reason: '이 질문에는 미정 설명만 있음', evidence: [{ messageId: request.data.messages[1].id, quote: '이번 기간은 아직 모릅니다.' }] }] } };
    } });
    const c = service.create(input), saved = await service.analyze(c.id, c.version);
    assert.equal(saved.questions.find(q => q.title === '별도 처리 상태').status, 'answered');
    assert.equal(saved.questions.find(q => q.title === '이번 기간 요금').status, 'review');
  } finally { store.close(); }
});
