import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [input, output] = process.argv.slice(2); assert(input && output && !existsSync(output));
const bytes = readFileSync(input), report = JSON.parse(bytes); assert(report.complete);
const stats = values => {
  const xs = values.toSorted((a,b) => a-b), n = xs.length;
  return { count: n, medianMs: n ? (xs[Math.floor((n-1)/2)] + xs[Math.floor(n/2)])/2 : null, meanMs: n ? Math.round(xs.reduce((a,b) => a+b,0)/n) : null, maxMs: xs.at(-1) ?? null };
};
const totals = rows => {
  const calls = rows.flatMap(r => r.calls.filter(c => !c.simulated));
  return { ...stats(rows.filter(r => Number.isFinite(r.ms)).map(r => r.ms)), passed: rows.filter(r => r.passed).length, cases: rows.length, calls: calls.length,
    inputTokens: calls.reduce((n,c) => n + (c.usage?.input_tokens || 0),0), outputTokens: calls.reduce((n,c) => n + (c.usage?.output_tokens || 0),0),
    reasoningTokens: calls.reduce((n,c) => n + (c.usage?.output_tokens_details?.reasoning_tokens || 0),0),
    unobservedRequests: calls.reduce((n,c) => n + (c.transport?.unobservedRequests ?? (c.usage ? 0 : 1)),0),
    failures: rows.filter(r => !r.passed).map(r => ({id:r.id,repeat:r.repeat,error:r.error,issues:r.grade?.issues,reason:r.reasonGrade})) };
};
const groups = Object.fromEntries(['live-update','replayed-first/live-repair'].map(kind => [kind,Object.fromEntries(['before','after'].map(variant => [variant,totals(report.results.filter(r => r.kind===kind && r.variant===variant))]))]));
const perCase = report.fixtures.map(f => ({ id:f.id,kind:f.kind,...Object.fromEntries(['before','after'].map(v => [v,totals(report.results.filter(r => r.id===f.id && r.variant===v))])) }));
const summary = { source:input,sourceSha256:createHash('sha256').update(bytes).digest('hex'),baselineCommit:report.baselineCommit,model:report.model,repeats:report.repeats,note:'Repair measurements exclude the replayed first output. Token totals include only live calls. Unknown canceled request usage prevents total cost-savings claims.',groups,perCase };
writeFileSync(output,JSON.stringify(summary,null,2));console.log(JSON.stringify(groups,null,2));
