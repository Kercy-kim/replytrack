// Opt-in paid integration check against an isolated local server with a real API key.
// Start with REPLYTRACK_DATA_DIR pointing to a test-only directory. No keys are read or logged here.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert(process.argv.includes('--run'), 'Pass --run to authorize paid API calls and synthetic test records.');
const base = new URL(process.env.REPLYTRACK_URL || 'http://127.0.0.1:3100');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use an isolated local test server.');
const output = process.env.REPLYTRACK_FLOW_REPORT || '.artifacts/live-flow-result.json';
assert(!existsSync(output), 'Choose a new report path to preserve prior results.');
const report = { at: new Date().toISOString(), cases: [] };
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
async function request(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  assert(response.ok, `${path}: ${data.code} ${data.error}`);
  return data;
}
async function operation(result, label, kind, input, caseId) {
  const id = randomUUID();
  let job = await request('/api/operations', { id, kind, input, caseId });
  const deadline = Date.now() + 330000;
  while (job.state === 'running') {
    assert(Date.now() < deadline, `${label}: polling timeout`);
    await delay(500);
    job = await request(`/api/operations/${id}`);
  }
  result.steps.push({ label, state: job.state, elapsedMs: job.elapsedMs, events: job.events, ...(job.error ? { error: job.error } : {}) });
  save();
  assert.equal(job.state, 'completed', `${label}: ${job.error?.code} ${job.error?.message}`);
  console.log(`${result.name} ${label}: ${(job.elapsedMs / 1000).toFixed(1)}s`);
  return job.result;
}
const fixtures = [
  {
    name: 'refund', title: '실제 API 흐름 검증 — 반품 환불',
    customer: '반품한 이어폰의 환불 금액은 얼마인가요? 어느 결제수단으로 돌려받나요? 환불 예정일은 언제인가요?',
    agent: '환불 금액은 79,000원입니다. 환불 예정일은 담당 부서에 확인해서 11월 16일까지 안내하겠습니다.',
    reply: '환불은 원래 결제하신 카드로 진행됩니다. 환불 예정일은 아직 확인 중이며 11월 16일까지 안내하겠습니다.',
    initial: ['answered', 'unanswered', 'waiting'], updated: ['answered', 'answered', 'waiting'],
    remaining: /환불.*(예정일|날짜|언제|일정|시점)/, handoff: [/79,?000/, /카드/, /환불/],
  },
  {
    name: 'subscription', title: '실제 API 흐름 검증 — 구독 해지',
    customer: '구독 해지가 완료됐나요? 다음 달 자동 결제는 중단됐나요? 이번 달 이용료 환불이 가능한가요?',
    agent: '구독 해지는 접수됐지만 아직 처리 중입니다. 11월 16일까지 해지 처리하고 결과를 안내하겠습니다. 이번 달 이용료는 환불이 불가능합니다.',
    reply: '자동 결제 중단 처리는 완료했습니다. 구독 해지는 아직 처리 중이고 11월 16일까지 처리한 뒤 안내하겠습니다.',
    initial: ['answered', 'unanswered', 'waiting'], updated: ['answered', 'answered', 'waiting'],
    remaining: /해지/, handoff: [/자동\s*결제/, /환불/, /해지/],
  },
];
function grounded(c) {
  assert.equal(c.mode, 'live');
  assert(c.analysis.usage?.total_tokens > 0, 'Expected actual provider token usage.');
  assert(!/예제|fixture|demo/i.test(c.analysis.model));
  assert.deepEqual(c.warnings, []);
  for (const q of c.questions) {
    assert(c.messages.some(m => m.role === 'customer' && m.id === q.source.messageId && m.text.includes(q.source.quote)));
    for (const e of q.evidence) assert(c.messages.some(m => m.role === 'agent' && m.id === e.messageId && m.text.includes(e.quote)));
  }
  for (const p of c.promises) {
    assert(c.messages.some(m => m.role === 'agent' && m.id === p.evidence.messageId && m.text.includes(p.evidence.quote)));
    assert.equal(p.confirmedAt, null, 'AI must not confirm actual fulfillment.');
  }
  assert(c.promises.some(p => p.dueAt === '2026-11-16'));
}
try {
  const config = await request('/api/config');
  assert(config.configured, 'Configure the real API key in the running server first.');
  report.model = config.model;
  for (const fixture of fixtures) {
    const result = { name: fixture.name, steps: [], passed: false };
    report.cases.push(result);
    try {
      const prepared = await operation(result, 'prepare', 'prepare', { text: `고객: ${fixture.customer}\n상담원: ${fixture.agent}` });
      const extracted = await operation(result, 'extract', 'extract', { text: prepared.text });
      assert.deepEqual(extracted.messages.map(m => m.role), ['customer', 'agent']);
      assert.deepEqual(extracted.messages.map(m => m.text), [fixture.customer, fixture.agent]);
      const messages = extracted.messages.map(m => ({ ...m, sentAt: '2026-11-14T10:00:00+09:00' }));
      let c = await request('/api/cases', { title: fixture.title, company: '가상 API 테스트 업체', messages });
      result.caseId = c.id;
      c = await operation(result, 'initial', 'analyze', { version: c.version }, c.id);
      result.initial = c; grounded(c);
      assert.deepEqual(c.questions.map(q => q.status).sort(), fixture.initial);
      const ids = c.questions.map(q => q.id).sort();
      c = await request(`/api/cases/${c.id}/messages`, { version: c.version, role: 'agent', text: fixture.reply, sentAt: '2026-11-14T11:00:00+09:00' });
      c = await operation(result, 'updated', 'analyze', { version: c.version }, c.id);
      result.updated = c; grounded(c);
      assert.deepEqual(c.questions.map(q => q.id).sort(), ids);
      assert.deepEqual(c.questions.map(q => q.status).sort(), fixture.updated);
      const comparison = c.history.find(h => h.type === 'analysis').comparison;
      assert.equal(comparison.messageIds.length, 1);
      assert.equal(comparison.questions.filter(q => q.before?.status !== q.after?.status).length, 1);
      const remaining = c.questions.filter(q => q.status !== 'answered');
      assert.equal(remaining.length, 1);
      assert.match(remaining[0].title, fixture.remaining);
      c = await operation(result, 'followup', 'draft', { version: c.version, kind: 'followup', questionIds: remaining.map(q => q.id) }, c.id);
      assert.match(c.drafts.followup.body, fixture.remaining);
      assert(c.drafts.followup.review);
      c = await operation(result, 'handoff', 'draft', { version: c.version, kind: 'handoff' }, c.id);
      for (const content of fixture.handoff) assert.match(c.drafts.handoff.body, content);
      assert(!/정정|번복|엇갈/.test(c.drafts.handoff.body), 'Additional guidance is not a correction.');
      assert(c.drafts.handoff.review);
      for (const draft of Object.values(c.drafts)) {
        assert(draft.sourceMessageIds.length > 0);
        assert(draft.sourceMessageIds.every(id => c.messages.some(m => m.id === id)));
        assert(!/\b[0-9a-f]{8}-[0-9a-f-]{27}\b|_r\d+/.test(draft.body));
      }
      result.final = c;
      assert.deepEqual(await request(`/api/cases/${c.id}`), c, 'Saved results must survive a fresh read.');
      result.passed = true;
    } catch (error) { result.failure = error.message; process.exitCode = 1; console.error(`${fixture.name}: ${error.message}`); }
    save();
  }
} catch (error) { report.failure = error.message; process.exitCode = 1; console.error(error.message); }
finally { save(); }
