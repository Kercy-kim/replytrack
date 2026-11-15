import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';

assert(process.argv.includes('--run'), 'Pass --run for paid synthetic review controls.');
const output = process.argv[process.argv.indexOf('--out') + 1];
assert(process.argv.includes('--out') && output && !existsSync(output), 'Choose a new --out report.');
const sources = [
  ['NR06', 'evals/results/email-regression/baseline.json', 1],
  ['U01', 'evals/results/email-regression/final-v2.json', 1],
  ['R05', 'evals/results/email-regression/baseline.json', 0],
];
const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
const report = { at: new Date().toISOString(), mode: 'Saved initial analyses replayed; completion reviews use live OpenAI', results: [] };
for (const [id, path, count] of sources) {
  const saved = JSON.parse(readFileSync(path)).results.find(c => c.id === id);
  const original = saved.stages[0].record;
  const raw = saved.calls.find(c => c.name === 'replytrack_analysis').data;
  assert.equal(raw.promises.length, 0);
  const store = new CaseStore(':memory:');
  const entry = { id, source: path, calls: [] }; report.results.push(entry);
  let record;
  const svc = new ReplyTrack(store, { async structured(request) {
    if (request.name === 'replytrack_analysis') {
      let serialized = JSON.stringify(raw);
      original.messages.forEach((m, i) => { serialized = serialized.replaceAll(m.id, record.messages[i].id); });
      return { model: 'saved-analysis-replay', data: JSON.parse(serialized) };
    }
    const started = Date.now(); const response = await client.structured(request);
    entry.calls.push({ name: request.name, ms: Date.now() - started, ...response }); return response;
  } });
  try {
    record = svc.create({ title: original.title, messages: original.messages });
    const result = await svc.analyze(record.id, record.version);
    assert.equal(result.analysis.completionReview.promises, count);
    assert.equal(result.promises.length, count);
    assert(result.promises.every(p => p.state === 'reported' && !p.confirmedAt));
    if (count) {
      assert.match(result.promises[0].title, id === 'U01' ? /갱신|해제/ : /승인/);
      assert.equal(result.promises[0].dueText, '');
    }
    entry.record = result; entry.passed = true;
  } catch (e) { entry.passed = false; entry.error = { message: e.message, code: e.code }; }
  finally { store.close(); writeFileSync(output, JSON.stringify(report, null, 2)); }
  console.log(`${id}: ${entry.passed ? 'PASS' : 'FAIL'}`);
}
if (report.results.some(r => !r.passed)) process.exitCode = 1;
