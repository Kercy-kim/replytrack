import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performanceSummary } from '../evals/performance.mjs';

const args = process.argv.slice(2), outIndex = args.indexOf('--out');
const output = outIndex < 0 ? null : args[outIndex + 1];
const files = outIndex < 0 ? args : args.slice(0, outIndex);
if (!files.length || (outIndex >= 0 && !output)) throw Error('Usage: compare-handoff.mjs report.json [report2.json] [--out comparison.json]');
const reports = files.map(f => JSON.parse(readFileSync(f, 'utf8'))), first = reports[0];
for (const r of reports) {
  if (!r.complete || r.results.length !== r.expectedResults) throw Error('Incomplete run');
  for (const key of ['requestedModel', 'baseCommit', 'fixtureHash', 'evaluatorHash', 'performanceHash']) if (r[key] !== first[key]) throw Error('Comparison configuration changed: ' + key);
  if (JSON.stringify(r.sources) !== JSON.stringify(first.sources) || JSON.stringify(r.variants) !== JSON.stringify(['before','after'])) throw Error('Source or variant mismatch');
}
const results = reports.flatMap(r => r.results), seen = new Set();
for (const r of results) { const key = `${r.id}/${r.variant}`; if (seen.has(key)) throw Error('Duplicate result: ' + key); seen.add(key); }
const before = results.filter(r => r.variant === 'before'), after = results.filter(r => r.variant === 'after');
if (JSON.stringify(before.map(r => r.id).sort()) !== JSON.stringify(after.map(r => r.id).sort())) throw Error('Unpaired selections');
const b = performanceSummary(before), a = performanceSummary(after);
const reduction = (x, y) => x > 0 ? Math.round((x-y)/x*10000)/100 : null;
// Token sensitivity analysis: exclude the entire pair if either side failed or has unknown usage.
// Keep all attempts, including failures, in the primary results above.
const measurable = r => r.draft && !r.error && r.operations.every(o => o.success) && r.calls.length && r.calls.every(c => c.usage);
const matchedBefore = before.filter(old => measurable(old) && measurable(after.find(r => r.id === old.id)));
const matchedAfter = matchedBefore.map(old => after.find(r => r.id === old.id));
const mb = performanceSummary(matchedBefore), ma = performanceSummary(matchedAfter);
const comparison = {
  sourceReports: files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') })),
  requestedModel: first.requestedModel, fixtureHash: first.fixtureHash, pairCount: before.length,
  before: b, after: a, beforeSaved: before.filter(r => r.draft).length, afterSaved: after.filter(r => r.draft).length,
  beforeRepairs: before.filter(r => r.draft?.review.attempts > 1).length, afterRepairs: after.filter(r => r.draft?.review.attempts > 1).length,
  reductionPercent: { median: reduction(b.draftMs.median,a.draftMs.median), p95: reduction(b.draftMs.p95,a.draftMs.p95), totalTokens: a.callsWithoutUsage || b.callsWithoutUsage ? null : reduction(b.totalTokens,a.totalTokens) },
  completeUsagePairs: { note: 'Successful paired subset only; not the full-run success rate or overall token saving.', count: matchedBefore.length, ids: matchedBefore.map(r => r.id), before: mb, after: ma, tokenReductionPercent: reduction(mb.totalTokens,ma.totalTokens) },
  paired: before.map(old => { const current = after.find(r => r.id === old.id); return { id: old.id, beforeMs: old.operations[0].ms, afterMs: current.operations[0].ms, beforeError: old.error || null, afterError: current.error || null }; }),
  semanticReview: 'Saved output is not an independent quality score. Review every before/after draft against frozen source and rubric.',
};
if (output) { if (existsSync(output)) throw Error('Refusing overwrite'); writeFileSync(output, JSON.stringify(comparison,null,2)+'\n'); }
console.log(JSON.stringify(comparison,null,2));
if (after.some(r => r.error)) process.exitCode = 1;
