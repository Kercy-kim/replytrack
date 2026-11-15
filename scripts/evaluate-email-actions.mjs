// Opt-in real API contrasts; saved question/commitment state, no real user data.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run'));
const output = process.argv.find(a => a.startsWith('--out='))?.slice(6) || 'evals/results/email-tail/action-controls.json';
const selectedCase = process.argv.find(a => a.startsWith('--case='))?.slice(7);
assert(!existsSync(output));
const recorded = JSON.parse(readFileSync('evals/results/presentation/recording-2026-11-16-final.json'));
const cases = [
  { id: 'REWORDED-PERIOD', reply: 'The requested transaction ID has reached us. Our usual review time is 5 working days. The account remains locked. After the review, we will notify you by email.', oldState: 'promised', reported: 1, count: 3, due: '' },
  { id: 'REVIEW-COMPLETED', reply: 'We received your transaction ID. We have completed the review of your recovery request. The review took 3 business days. Your account has not been restored. We will email you our decision.', oldState: 'reported', reported: 2, count: 3, due: '' },
  { id: 'NOT-RECEIVED', reply: 'We have not received your transaction ID. Once you send it and we verify it, we will review your recovery request. Reviews usually take 4 business days. We will notify you by email after reviewing the request.', oldState: 'promised', reported: 0, count: 2, due: '' },
  { id: 'REFUND-REVIEW', reply: 'We received the purchase reference. We will complete the refund review within 2 business days. We have not issued your refund. We will email you after the review.', oldState: 'promised', reported: 1, count: 3, due: '2 business days', refund: true },
];
const report = { at: new Date().toISOString(), model: 'gpt-5-mini-2025-08-07', scope: 'Four new wording/action contrasts against a fixed saved state; developer-authored gold, not a general accuracy estimate.', hashes: Object.fromEntries(['src/service.mjs', 'src/email-reply.mjs', 'src/analysis-focus.mjs'].map(p => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])), results: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
assert(!selectedCase || cases.some(c => c.id === selectedCase));
for (const spec of cases.filter(c => !selectedCase || c.id === selectedCase)) {
  const store = new CaseStore(':memory:'), client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: report.model });
  const row = { ...spec, calls: [] }; report.results.push(row);
  const svc = new ReplyTrack(store, { async structured(args) { const at = performance.now(); const r = await client.structured(args); row.calls.push({ ms: Math.round(performance.now() - at), effort: args.reasoningEffort, data: r.data, usage: r.usage }); save(); return r; } });
  try {
    let seed = { ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) };
    if (spec.refund) seed = JSON.parse(JSON.stringify(seed).replaceAll('recover my account', 'request a refund').replaceAll('your recovery request', 'your refund request').replaceAll('transaction ID', 'purchase reference').replaceAll('계정 복구', '환불 요청').replaceAll('거래 ID', '구매 참조').replaceAll('복구 요청', '환불 요청'));
    seed.messages.at(-1).text = spec.reply; row.seed = seed;
    const c = store.create(seed), start = performance.now();
    const result = await svc.analyze(c.id, c.version); row.ms = Math.round(performance.now() - start); row.record = result;
    assert.deepEqual(result.questions.map(q => q.id), seed.questions.map(q => q.id));
    assert.deepEqual(result.questions.map(q => q.source), seed.questions.map(q => q.source));
    assert(result.questions.every(q => q.status === 'answered')); assert.deepEqual(result.warnings, []);
    const old = result.promises.find(p => p.id === seed.promises[0].id); assert(old); assert.equal(old.state, spec.oldState);
    if (spec.due) assert(old.dueText.includes(spec.due)); else assert.equal(old.dueText, '');
    assert.equal(result.promises.length, spec.count);
    assert.equal(result.promises.filter(p => p.state === 'reported').length, spec.reported);
    assert(result.promises.some(p => p.state === 'promised' && /(?:email you|notify you by email)/i.test(p.evidence.quote)));
    assert(result.promises.every(p => !p.confirmedAt)); row.passed = true;
  } catch (e) { row.passed = false; row.error = { code: e.code, message: e.message }; }
  finally { store.close(); save(); console.log(spec.id, row.passed ? 'PASS' : 'FAIL', row.ms, row.error || ''); }
}
report.complete = true; report.passed = report.results.every(r => r.passed); save(); if (!report.passed) process.exitCode = 1;
