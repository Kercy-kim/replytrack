// Replay the observed bad browser output; only its repair uses the real API.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run'));
const out = 'evals/results/registration-latency/duration-repair.json'; assert(!existsSync(out));
const saved = JSON.parse(readFileSync('evals/results/registration-latency/browser-after.json')).cases.find(c => c.name === 'email');
const report = { at: new Date().toISOString(), mode: 'Replayed incorrect first output, live medium repair', source: 'browser-after.json', hash: createHash('sha256').update(readFileSync('src/service.mjs')).digest('hex'), results: [] };
for (const actualCommitment of [false, true]) {
  const store = new CaseStore(':memory:');
  try {
    const seed = { ...structuredClone(saved.initial), messages: structuredClone(saved.updated.messages) };
    const first = structuredClone(saved.updated);
    if (actualCommitment) seed.messages.at(-1).text += ' We will review your case and send you the result within 3 business days.';
    const c = store.create(seed), calls = [];
    const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
    const service = new ReplyTrack(store, { async structured(args) {
      if (!calls.length) { calls.push({ simulated: true }); return { model: 'replayed-bad-first-output', data: first }; }
      const result = await client.structured(args); calls.push({ simulated: false, effort: args.reasoningEffort, ...result }); return result;
    } });
    const result = await service.analyze(c.id, c.version);
    const passed = calls.length === 2 && result.promises.length === (actualCommitment ? 2 : 1) && result.promises.filter(p => p.state === 'reported').length === 1 && result.promises.filter(p => p.state === 'promised').length === Number(actualCommitment) && result.promises.filter(p => p.state === 'reported').every(p => !p.dueText) && !result.warnings.length && result.questions.map(q => q.status).sort().join() === 'answered,answered,unanswered';
    report.results.push({ actualCommitment, passed, calls, result }); console.log(actualCommitment ? 'explicit commitment' : 'duration only', passed ? 'PASS' : 'FAIL');
  } finally { store.close(); }
}
report.passed = report.results.every(r => r.passed); writeFileSync(out, JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1;
