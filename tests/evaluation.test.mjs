import test from 'node:test';
import assert from 'node:assert/strict';
import { cases } from '../evals/support-cases.mjs';
import { boundaryCases } from '../evals/status-boundary-cases.mjs';
import { unseenCases } from '../evals/unseen-cases.mjs';
import { grade, summarize } from '../evals/grade.mjs';

const record = () => ({
  messages: [{ id: 'm1', role: 'customer', text: '환불액은 얼마인가요?' }, { id: 'm2', role: 'agent', text: '확인 후 안내하겠습니다.' }],
  questions: [{ id: 'q1', title: '환불액', source: { messageId: 'm1', quote: '환불액은 얼마인가요?' }, status: 'waiting', evidence: [{ messageId: 'm2', quote: '확인 후 안내하겠습니다.' }], followUp: '언제 안내할 수 있나요?' }],
  promises: [], warnings: [],
});
const expected = { questions: [{ message: 0, topic: '환불', status: 'waiting', evidence: [1] }], promises: [] };

test('evaluation flags falsely answered questions and missing required evidence', () => {
  const c = record();
  assert.equal(grade(c, expected).pass, true);
  c.questions[0].status = 'answered'; c.questions[0].evidence = [];
  const result = grade(c, expected);
  assert.equal(result.pass, false);
  assert.equal(result.metrics.falseAnswered, 1);
  assert.equal(result.metrics.correct, 0);
  assert.equal(result.metrics.evidenceCorrect, 0);
});
test('evaluation cannot count ambiguous duplicates or omissions as correct', () => {
  const c = record(); c.questions.push({ ...c.questions[0], id: 'q2' });
  const duplicate = grade(c, expected);
  assert.equal(duplicate.metrics.found, 0);
  assert(duplicate.issues.some(x => x.includes('ambiguous')));
  c.questions = [];
  const missing = grade(c, expected);
  assert.equal(missing.metrics.expectedQuestions, 1);
  assert.equal(missing.metrics.correct, 0);
  assert.equal(missing.pass, false);
});
test('evaluation rejects stale deadline and invented user confirmation', () => {
  const c = record();
  c.promises = [{ id: 'p1', title: '안내', evidence: { messageId: 'm2', quote: '안내하겠습니다.' }, state: 'promised', dueAt: '2026-11-16', dueText: '내일', confirmedAt: '2026-11-15' }];
  const result = grade(c, { ...expected, promises: [{ message: 1, topic: '안내', state: 'promised', dueAt: null, deadline: '' }] });
  assert.equal(result.metrics.correctPromises, 0);
  assert.equal(result.pass, false);
});
test('evaluation preserves failed-call counts separately from graded output', () => {
  const summary = summarize([{ stages: [], calls: [{ error: { code: 'AI_TIMEOUT' }, ms: 90000 }], error: { code: 'AI_TIMEOUT' } }]);
  assert.equal(summary.cases, 1); assert.equal(summary.completedCases, 0);
  assert.equal(summary.passedCases, 0); assert.equal(summary.apiErrors, 1); assert.equal(summary.stages, 0);
});
test('frozen synthetic set covers 20 cases and every expected message exists', () => {
  assert.equal(cases.length, 20);
  assert.equal(new Set(cases.map(c => c.id)).size, 20);
  assert.deepEqual(['배송', '환불', '구독'].map(category => cases.filter(c => c.category === category).length), [7, 7, 6]);
  assert.equal(boundaryCases.length, 8);
  assert.equal(new Set([...cases, ...boundaryCases].map(c => c.id)).size, 28);
  for (const c of [...cases, ...boundaryCases, ...unseenCases]) {
    for (const [messages, gold] of [[c.messages, c.expected], ...(c.next ? [[c.messages.concat(c.next), c.after]] : [])]) {
      for (const q of gold.questions) { assert.equal(messages[q.message].role, 'customer'); for (const i of q.evidence) assert.equal(messages[i].role, 'agent'); }
      for (const p of gold.promises) assert.equal(messages[p.message].role, 'agent');
    }
  }
});
test('new evaluation set has 20 distinct conversations without reusing prior messages', () => {
  assert.equal(unseenCases.length, 20);
  assert.deepEqual(['배송', '환불', '구독'].map(category => unseenCases.filter(c => c.category === category).length), [7, 7, 6]);
  const allCases = [...cases, ...boundaryCases, ...unseenCases];
  assert.equal(new Set(allCases.map(c => c.id)).size, 48);
  const oldText = new Set([...cases, ...boundaryCases].flatMap(c => [...c.messages, ...(c.next || [])].map(m => m.text)));
  for (const c of unseenCases) for (const m of [...c.messages, ...(c.next || [])]) assert(!oldText.has(m.text));
  assert.equal(unseenCases.filter(c => c.next).length, 4);
  assert.equal(unseenCases.filter(c => c.draft).length, 6);
});
