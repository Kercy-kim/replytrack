import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { presentationData } from '../src/presentation.mjs';
import { renderPresentation } from '../public/presentation-view.js';

const source = 'evals/results/presentation/recording.json';
const raw = readFileSync(source), report = JSON.parse(raw);
const provenance = { source, sha256: createHash('sha256').update(raw).digest('hex') };

test('shipped replay exactly matches the validated actual API recording', () => {
  const data = presentationData(report, provenance);
  assert.deepEqual(JSON.parse(readFileSync('public/presentation-data.json')), data);
  assert.equal(data.before.drafts.followup.body, report.before.drafts.followup.body);
  assert.equal(data.after.emailExplanation.items.at(-1).korean, report.after.emailExplanation.items.at(-1).korean);
  assert(data.provenance.apiCalls > 0); assert(data.provenance.operationMs > 30000);
});

test('replay packaging refuses incomplete, non-synthetic, changed-source and invented comparison records', () => {
  for (const mutate of [r => r.passed = false, r => r.synthetic = false, r => r.before.messages[0].text = 'Actual private customer message', r => r.after.questions[0].id = 'different', r => r.after.analysis.comparison.questions[0].before.status = 'answered', r => r.before.questions[0].evidence[0].quote = 'invented quote']) {
    const r = structuredClone(report); mutate(r); assert.throws(() => presentationData(r, provenance));
  }
});

test('all four scenes disclose replay, escape model output and show real before/after states', () => {
  const data = presentationData(report, provenance);
  for (let step = 0; step < 4; step++) assert.match(renderPresentation(data, step), /실제 OpenAI 실행 결과 재생 · 가상 상담 · 지금 API를 호출하지 않음/);
  const last = renderPresentation(data, 3); assert.match(last, /부분 답변/); assert.match(last, /답변 받음/); assert.match(last, /업체 수신 안내/);
  const injected = structuredClone(data); injected.before.drafts.followup.body = '</textarea><script>bad()</script>';
  const html = renderPresentation(injected, 2); assert(!html.includes('<script>')); assert(html.includes('&lt;/textarea&gt;'));
});
