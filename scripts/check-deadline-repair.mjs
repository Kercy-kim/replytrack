// Replay an observed unsupported deadline deletion, then use the live repair.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run'));
const out = 'evals/results/review-latency/deadline-repair.json';
assert(!existsSync(out));
const source = JSON.parse(readFileSync('evals/results/review-latency/full48-verified.json'));
const failed = source.results.find(r => r.id === 'NS03');
const before = failed.stages[0].record, first = failed.calls.at(-1).data;
assert(first.promises.some(p => p.deadlineCleared));
const report = { at: new Date().toISOString(), scope: 'Observed bad output replayed; only repair is live. Two repeats.', hashes: Object.fromEntries(['src/service.mjs','src/analysis-focus.mjs'].map(p => [p,createHash('sha256').update(readFileSync(p)).digest('hex')])), results: [] };
for (let repeat = 1; repeat <= 2; repeat++) {
  const store = new CaseStore(':memory:'), calls = [];
  try {
    const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
    const service = new ReplyTrack(store, { async structured(args) {
      if (!calls.length) { calls.push({ simulated: true }); return { data: structuredClone(first), model: 'observed-output' }; }
      const result = await client.structured(args); calls.push({ effort: args.reasoningEffort, ...result }); return result;
    } });
    const seed = store.create({ ...structuredClone(before), messages: structuredClone(failed.stages[1].record.messages) });
    const result = await service.analyze(seed.id, seed.version);
    assert.equal(calls.length, 2); assert.equal(calls[1].effort, 'medium');
    assert.equal(result.promises.length, 1);
    assert.equal(result.promises[0].id, before.promises[0].id);
    assert.equal(result.promises[0].state, 'reported');
    assert.equal(result.promises[0].dueText, before.promises[0].dueText);
    assert.equal(result.promises[0].dueAt, before.promises[0].dueAt);
    assert.equal(result.questions[0].status, 'answered');
    report.results.push({ repeat, passed: true, calls, result });
    console.log(`deadline repair ${repeat}: PASS`);
  } catch (e) { report.results.push({ repeat, passed: false, error: e.message, calls }); process.exitCode = 1; }
  finally { store.close(); writeFileSync(out, JSON.stringify(report,null,2)); }
}
report.passed = report.results.length === 2 && report.results.every(r => r.passed);
writeFileSync(out, JSON.stringify(report,null,2));
