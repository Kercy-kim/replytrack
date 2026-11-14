import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/compare-handoff.mjs', import.meta.url));
const report = () => ({ complete: true, expectedResults: 2, requestedModel: 'fixed', baseCommit: 'base', fixtureHash: 'data', evaluatorHash: 'runner', performanceHash: 'metrics', sources: { before: {}, after: {} }, variants: ['before','after'], results: ['before','after'].map(variant => ({ id: 'case#1', variant, draft: { body: '초안', review: { attempts: 1 } }, operations: [{ kind: 'draft', ms: variant === 'before' ? 200 : 100, success: true }], calls: [{ usage: { input_tokens: 10, output_tokens: 10 } }] })) });
function compare(reports) {
  const dir = mkdtempSync(join(tmpdir(), 'replytrack-handoff-'));
  try {
    const files = reports.map((r,i) => { const file = join(dir, `${i}.json`); writeFileSync(file, JSON.stringify(r)); return file; });
    return spawnSync(process.execPath, [script, ...files], { encoding: 'utf8' });
  } finally {
    const target = realpathSync(dir);
    if (dirname(target) !== realpathSync(tmpdir()) || !basename(target).startsWith('replytrack-handoff-')) throw Error('Refusing cleanup outside test directory');
    rmSync(target, { recursive: true, force: true });
  }
}
test('handoff comparison includes failure time and refuses to infer unknown token savings', () => {
  const r = report(); r.results[0].operations[0] = { kind: 'draft', ms: 90000, success: false }; r.results[0].error = { code: 'AI_TIMEOUT' }; delete r.results[0].draft; r.results[0].calls = [{ error: 'timeout' }];
  const run = compare([r]); assert.equal(run.status, 0);
  const data = JSON.parse(run.stdout); assert.equal(data.before.draftMs.median, 90000); assert.equal(data.beforeSaved, 0); assert.equal(data.afterSaved, 1); assert.equal(data.reductionPercent.totalTokens, null);
  assert.deepEqual(data.over50Seconds, { before: 1, after: 0 });
  assert.equal(data.completeUsagePairs.count, 0);
  assert.equal(data.completeUsagePairs.tokenReductionPercent, null);
  const good = report(); good.results.forEach(r => { r.id = 'case#2'; });
  const paired = JSON.parse(compare([r,good]).stdout);
  assert.equal(paired.pairCount, 2);
  assert.equal(paired.reductionPercent.totalTokens, null);
  assert.deepEqual(paired.completeUsagePairs.ids, ['case#2']);
  assert.equal(paired.completeUsagePairs.before.totalTokens, 20);
  assert.equal(paired.completeUsagePairs.after.totalTokens, 20);
  assert.equal(paired.completeUsagePairs.tokenReductionPercent, 0);
  const boundary = report(); boundary.results[0].operations[0].ms = 50000; boundary.results[1].operations[0].ms = 50001;
  assert.deepEqual(JSON.parse(compare([boundary]).stdout).over50Seconds, { before: 0, after: 1 });
});
test('handoff comparison rejects mixed fixtures, implementations, duplicate and unpaired results', () => {
  for (const change of [r => { r.fixtureHash = 'changed'; }, r => { r.sources.after = { file: 'changed' }; }, r => { r.evaluatorHash = 'changed'; }, r => { r.complete = false; }, r => { r.mode = 'repair replay'; }, r => { r.suite = 'tail'; }]) {
    const a = report(), b = report(); b.results.forEach(r => { r.id = 'case#2'; }); change(b); assert.notEqual(compare([a,b]).status, 0);
  }
  assert.notEqual(compare([report(), report()]).status, 0);
  const r = report(); r.results[1].id = 'other'; assert.notEqual(compare([r]).status, 0);
});
test('handoff failure cannot pass a speed comparison', () => {
  const r = report(); r.results[1].error = { code: 'DRAFT_REVIEW' }; delete r.results[1].draft;
  assert.equal(compare([r]).status, 1);
});
