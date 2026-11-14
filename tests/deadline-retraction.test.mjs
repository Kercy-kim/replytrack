import test from 'node:test';
import assert from 'node:assert/strict';
import { newCase, message, applyAnalysis } from '../src/domain.mjs';

function fixture() {
  const c = newCase({ title: '기한 철회 회귀', messages: [
    { role: 'customer', text: '환불 예정일이 언제인가요?' },
    { role: 'agent', text: '환불 예정일을 확인해 2026년 11월 16일까지 안내하겠습니다.' },
  ] });
  const raw = { summary: '환불 예정일 확인 대기', questions: [{ id: 'new-q-1', title: '환불 예정일', source: { messageId: c.messages[0].id, quote: c.messages[0].text }, status: 'waiting', reason: '확인 후 안내 약속', evidence: [{ messageId: c.messages[1].id, quote: c.messages[1].text }], followUp: '예정일을 알려 주세요.' }],
    promises: [{ id: 'new-p-1', title: '환불 예정일 안내', questionIds: ['new-q-1'], evidence: { messageId: c.messages[1].id, quote: c.messages[1].text }, dueText: '2026년 11월 16일까지', deadlineCleared: false, state: 'promised' }] };
  applyAnalysis(c, raw);
  return c;
}
function update(c, text, deadlineCleared, state = 'promised') {
  c.messages.push(message({ role: 'agent', text }));
  const latest = c.messages.at(-1), evidence = { messageId: latest.id, quote: latest.text };
  applyAnalysis(c, { summary: '업데이트', questions: c.questions.map(q => ({ ...q, evidence: [evidence] })),
    promises: c.promises.map(p => ({ ...p, evidence, dueText: '', deadlineCleared, state })) });
}
test('explicit deadline retraction clears old date and appears in the before/after comparison', () => {
  const c = fixture(), id = c.promises[0].id;
  update(c, '앞서 약속한 안내 기한은 취소합니다. 안내는 드리겠지만 시점은 미정입니다.', true);
  assert.equal(c.promises[0].id, id);
  assert.equal(c.promises[0].dueAt, null); assert.equal(c.promises[0].dueText, '');
  assert.equal(c.promises[0].state, 'promised'); assert.equal(c.promises[0].confirmedAt, null);
  const change = c.analysis.comparison.promises[0];
  assert(change.fields.includes('deadline'));
  assert.equal(change.before.dueAt, '2026-11-16'); assert.equal(change.after.dueAt, null);
  assert.equal(c.history[1].comparison.kind, 'initial');
  // Reanalysis of the same retraction must not resurrect the old deadline or add a warning.
  applyAnalysis(c, { summary: c.summary, questions: c.questions, promises: c.promises.map(p => ({ ...p, deadlineCleared: true })) });
  assert.equal(c.promises[0].dueAt, null); assert.deepEqual(c.warnings, []);
});
test('a completion notice without deadline retraction preserves the commitment date', () => {
  const c = fixture();
  update(c, '확인을 마쳤으며 환불 예정일을 안내했습니다.', false, 'reported');
  assert.equal(c.promises[0].dueAt, '2026-11-16');
  assert.equal(c.promises[0].state, 'reported'); assert.equal(c.promises[0].confirmedAt, null);
  assert(!c.analysis.comparison.promises[0].fields.includes('deadline'));
});
test('a deadline cannot be cleared using missing, fabricated, or older evidence', () => {
  for (const badEvidence of ['same', 'fabricated', 'customer']) {
    const c = fixture();
    const evidence = badEvidence === 'same' ? c.promises[0].evidence : badEvidence === 'fabricated' ? { messageId: c.messages[1].id, quote: '기한을 취소합니다.' } : { messageId: c.messages[0].id, quote: c.messages[0].text };
    applyAnalysis(c, { summary: '잘못된 철회', questions: c.questions, promises: c.promises.map(p => ({ ...p, evidence, dueText: '', deadlineCleared: true })) });
    assert.equal(c.promises[0].dueAt, '2026-11-16');
    assert(c.warnings.length);
  }
});
test('legacy output without retraction flag and manual confirmation remain compatible', () => {
  const c = fixture(), confirmedAt = '2026-11-14T00:00:00.000Z';
  c.promises[0].confirmedAt = confirmedAt;
  update(c, '환불 예정일을 계속 확인 중입니다.', undefined);
  assert.equal(c.promises[0].dueAt, '2026-11-16'); assert.equal(c.promises[0].confirmedAt, confirmedAt);
  update(c, '안내 기한을 취소합니다. 다시 확인 후 안내하겠습니다.', true);
  assert.equal(c.promises[0].dueAt, null); assert.equal(c.promises[0].confirmedAt, confirmedAt);
});
