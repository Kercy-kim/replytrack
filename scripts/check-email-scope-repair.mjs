// Inject the observed bad first result, then exercise the real API repair path.
// This is a recovery test, not an end-to-end accuracy or latency measurement.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run'));
const out = 'evals/results/registration-latency/email-scope-repair.json'; assert(!existsSync(out));
const source = JSON.parse(readFileSync('evals/results/registration-latency/paired-guarded.json'));
const bad = source.results.find(r => r.variant === 'after' && r.id === 'WEB-EMAIL' && r.stages[0]?.record.questions.some(q => q.status === 'partial'));
assert(bad);
const report = { mode: 'Observed bad first output replayed; only repair uses real API', source: 'paired-guarded.json', at: new Date().toISOString(), serviceHash: createHash('sha256').update(readFileSync('src/service.mjs')).digest('hex'), results: [] };
for (const genuineOmission of [false, true]) {
  const store = new CaseStore(':memory:');
  try {
    const record = structuredClone(bad.stages[0].record);
    const initial = structuredClone(bad.calls[0].data);
    if (genuineOmission) {
      record.messages[0].text = 'Do I need a transaction ID and a photo of my ID card?';
      initial.questions = [initial.questions.find(q => q.status === 'partial')];
      initial.questions[0].source.quote = record.messages[0].text;
      initial.questions[0].title = '거래 ID와 신분증 사진 필요 여부';
      initial.questions[0].reason = '거래 ID는 안내받았지만 다른 자료인 신분증 사진 필요 여부는 확인되지 않았습니다.';
    }
    Object.assign(record, { questions: [], promises: [], analysis: null, analyzedMessageCount: 0 });
    const c = store.create(record), calls = [];
    const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
    const service = new ReplyTrack(store, { async structured(args) {
      if (!calls.length) { calls.push({ simulated: true }); return { data: initial, model: 'replayed-bad-first-output' }; }
      const result = await client.structured(args); calls.push({ simulated: false, name: args.name, effort: args.reasoningEffort, ...result }); return result;
    } });
    const saved = await service.analyze(c.id, c.version);
    const expected = genuineOmission ? 'partial' : 'answered';
    // A fresh full analysis may correctly split the two requested requirements.
    const splitMissing = genuineOmission && saved.questions.length === 2 && saved.questions.some(q => q.status === 'answered' && /transaction ID/.test(q.source.quote)) && saved.questions.some(q => q.status === 'unanswered' && /photo/.test(q.source.quote));
    const passed = calls.length === 2 && (saved.questions[0].status === expected || splitMissing) && saved.warnings.length === 0;
    report.results.push({ genuineOmission, expected, passed, calls, record: saved });
    console.log(expected, passed ? 'PASS' : 'FAIL');
  } finally { store.close(); }
}
report.passed = report.results.every(r => r.passed);
writeFileSync(out, JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
