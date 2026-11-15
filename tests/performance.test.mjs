import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceSummary, compareRuns } from '../evals/performance.mjs';
const result = () => ({ id: 'A', stages: [{ grade: { pass: true } }], draft: { body: '검증할 초안' }, calls: [
  { ms: 100, usage: { input_tokens: 200, input_tokens_details: { cached_tokens: 100 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 60 } } },
  { ms: 200, error: { code: 'AI_PROVIDER' } }], operations: [{ kind: 'analysis', ms: 310, success: false }, { kind: 'draft', ms: 250, success: true }] });
const report = () => ({ complete: true, suite: 'unseen', requestedModel: 'fixed', analysisOnly: false, hashes: Object.fromEntries(['evals/support-cases.mjs', 'evals/status-boundary-cases.mjs', 'evals/unseen-cases.mjs', 'evals/grade.mjs'].map(f => [f, 'hash'])), results: [result()] });
test('performance counts full operations including failed attempts and separates cached and reasoning tokens', () => {
  const summary = performanceSummary([result()]);
  assert.equal(summary.calls, 2); assert.equal(summary.totalTokens, 280); assert.equal(summary.cachedInputTokens, 100); assert.equal(summary.reasoningTokens, 60);
  assert.deepEqual(summary.analysisMs, { count: 1, median: 310, p95: 310 }); assert.equal(summary.failedOperations, 1);
});
test('comparison refuses changed datasets, model, selection, incomplete runs and skipped tasks', () => {
  for (const change of [r => { r.hashes['evals/unseen-cases.mjs'] = 'changed'; }, r => { r.requestedModel = 'other'; }, r => { r.results[0].id = 'B'; }, r => { r.complete = false; }, r => { r.analysisOnly = true; }]) {
    const before = report(), after = report(); change(after); assert.throws(() => compareRuns(before, after));
  }
});
test('speed gains cannot conceal analysis or draft regressions', () => {
  const before = report(), after = report(); before.results[0].calls.pop(); after.results[0].calls.pop(); after.results[0].stages[0].grade.pass = false; after.results[0].draft = { error: 'failed' }; after.results[0].calls[0].usage.input_tokens = 100;
  const comparison = compareRuns(before, after);
  assert.deepEqual(comparison.regressions, ['A: analysis 1', 'A: draft failed']);
  assert.equal(comparison.reductionPercent.inputTokens, 50);
});
test('a case that already failed cannot hide worse metrics and unknown usage is not a token saving', () => {
  const before = report(), after = report();
  before.results[0].stages[0].grade = { pass: false, metrics: { correct: 1, falseAnswered: 0 } };
  after.results[0].stages[0].grade = { pass: false, metrics: { correct: 0, falseAnswered: 1 } };
  const comparison = compareRuns(before, after);
  assert.equal(comparison.reductionPercent.totalTokens, null);
  assert.deepEqual(comparison.regressions, ['A: analysis 1 correct decreased', 'A: analysis 1 false answered increased']);
});

test('first analysis and reply latency are separated, including failed operations', () => {
  const r = result();
  r.operations.push({ kind: 'analysis', ms: 110, success: true }, { kind: 'analysis', ms: 510, success: false });
  const summary = performanceSummary([r]);
  assert.deepEqual(summary.initialAnalysisMs, { count: 1, median: 310, p95: 310 });
  assert.deepEqual(summary.replyAnalysisMs, { count: 2, median: 510, p95: 510 });
  const before = report(), after = report();
  before.results[0].stages[0].reasonGrade = { pass: true };
  after.results[0].stages[0].reasonGrade = { pass: false };
  assert(compareRuns(before, after).regressions.includes('A: analysis 1 reason quality'));
});

test('a successful hedge with an unobserved loser is not reported as a token saving', () => {
  const before = report(), after = report(); before.results[0].calls.pop(); after.results[0].calls.pop();
  after.results[0].calls[0].transport = { hedged: true, unobservedRequests: 1, attempts: [{ state: 'cancelled' }, { state: 'completed' }] };
  const comparison = compareRuns(before, after);
  assert.equal(comparison.after.requests, 2); assert.equal(comparison.after.hedgedCalls, 1); assert.equal(comparison.after.unobservedRequests, 1);
  assert.equal(comparison.reductionPercent.totalTokens, null); assert.equal(comparison.reductionPercent.inputTokens, null);
  assert.equal(comparison.reductionPercent.outputTokens, null);
});
