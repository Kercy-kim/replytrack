import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { OpenAIClient } from '../src/openai.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';

const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const response = (data = { ok: true }, extra = {}) => new Response(JSON.stringify({ status: 'completed', usage,
  output: [{ content: [{ type: 'output_text', text: JSON.stringify(data) }] }], ...extra }));
const input = { name: 'replytrack_analysis', schema: { type: 'object' }, instructions: '원문을 검증하세요.', data: { text: '전화번호 010-1234-5678' }, reasoningEffort: 'medium' };
const client = fetchImpl => new OpenAIClient({ apiKey: 'sk-test-not-a-real-credential', fetchImpl, hedgeAfterMs: 10, timeoutMs: 1000 });
const gate = () => Promise.withResolvers();
const stalled = signal => sleep(10000, null, { signal });

test('a fast call makes one request; a stalled call uses identical masked payload and cancels the loser', async () => {
  let count = 0;
  const fast = await client(async () => { count++; return response(); }).structured(input);
  assert.equal(count, 1); assert.equal(fast.transport.hedged, false); assert.equal(fast.usage.unobserved_requests, 0);
  const requests = [];
  const ai = client(async (_, options) => {
    requests.push(options);
    if (requests.length === 1) await stalled(options.signal);
    return response();
  });
  const result = await ai.structured(input);
  assert.equal(requests.length, 2); assert.equal(requests[0].body, requests[1].body);
  assert(!requests[0].body.includes('010-1234-5678')); assert.equal(JSON.parse(requests[1].body).reasoning.effort, 'medium');
  assert.equal(JSON.parse(requests[1].body).max_output_tokens, 6500);
  assert(requests[0].signal.aborted); assert.equal(result.data.ok, true);
  assert.equal(result.transport.attempts[0].state, 'cancelled'); assert.equal(result.transport.attempts[1].state, 'completed');
  assert.equal(result.transport.unobservedRequests, 1); assert.equal(result.usage.total_tokens, 15);
  assert.equal(result.usage.unobserved_requests, 1); assert.equal(ai.activeHedges, 0);
  assert(result.transport.attempts[1].headersMs >= 0); assert(result.transport.attempts[1].bodyMs >= 0);
});

test('original can win after duplicate starts, and failed duplicate cannot discard a good original', async () => {
  for (const backupFails of [false, true]) {
    const original = gate(), backup = gate(); let count = 0; const signals = [];
    const ai = client(async (_, options) => {
      signals.push(options.signal);
      if (++count === 1) { await original.promise; return response({ winner: 'original' }); }
      backup.resolve();
      if (backupFails) return response({}, { output: [] });
      await stalled(options.signal);
    });
    const pending = ai.structured(input); await backup.promise; await sleep(1); original.resolve();
    const result = await pending;
    assert.equal(result.data.winner, 'original'); assert.equal(count, 2); assert.equal(ai.activeHedges, 0);
    if (backupFails) { assert.equal(result.usage.total_tokens, 30); assert.equal(result.usage.unobserved_requests, 0); }
    else assert(signals[1].aborted);
  }
});

test('user cancellation and shared deadline abort both requests without extending the timeout', async () => {
  for (const cancel of [true, false]) {
    const backup = gate(), controller = new AbortController(), signals = [];
    const ai = client(async (_, options) => {
      signals.push(options.signal); if (signals.length === 2) backup.resolve();
      await stalled(options.signal);
    });
    ai.timeoutMs = 70;
    const pending = ai.structured({ ...input, signal: controller.signal });
    const check = assert.rejects(pending, e => {
      assert.equal(e.transport.attempts.length, 2);
      return e.code === (cancel ? 'OPERATION_CANCELLED' : 'AI_TIMEOUT');
    });
    await backup.promise; if (cancel) controller.abort(); await check;
    assert(signals.every(s => s.aborted)); assert.equal(ai.activeHedges, 0);
  }
});

test('auth, rate limits and refusals stop the pair; two malformed results fail without a retry loop', async () => {
  for (const code of ['AI_AUTH', 'AI_LIMIT', 'AI_REFUSAL', 'AI_FORMAT']) {
    let count = 0; const original = gate();
    const ai = client(async (_, options) => {
      if (++count === 1) { if (code === 'AI_FORMAT') { await original.promise; return response({}, { output: [] }); } await stalled(options.signal); }
      original.resolve();
      if (code === 'AI_AUTH' || code === 'AI_LIMIT') return new Response('private provider error', { status: code === 'AI_AUTH' ? 401 : 429 });
      return response({}, { output: code === 'AI_REFUSAL' ? [{ content: [{ type: 'refusal' }] }] : [] });
    });
    await assert.rejects(ai.structured(input), { code }); assert.equal(count, 2); assert.equal(ai.activeHedges, 0);
  }
});

test('only one duplicate is in flight across two analyses, and repairs/reviews/disabled clients never hedge', async () => {
  const controller = new AbortController(), signals = [];
  const ai = client(async (_, options) => { signals.push(options.signal); await stalled(options.signal); });
  const calls = [ai.structured({ ...input, signal: controller.signal }), ai.structured({ ...input, signal: controller.signal })];
  const settled = Promise.allSettled(calls);
  await sleep(40); assert.equal(signals.length, 3); assert.equal(ai.activeHedges, 1);
  controller.abort(); const results = await settled;
  assert(results.some(r => r.reason.transport.hedgeSkipped)); assert(signals.every(s => s.aborted)); assert.equal(ai.activeHedges, 0);
  for (const args of [{ ...input, data: { revisionFeedback: 'fix' } }, { ...input, name: 'replytrack_boundary_review' }, { ...input, name: 'replytrack_draft' }, input]) {
    let count = 0; const single = client(async () => { count++; await sleep(25); return response(); });
    if (args === input) single.hedgeAfterMs = 0;
    await single.structured(args); assert.equal(count, 1);
  }
});

test('body stalls are eligible, while ordinary immediate failures do not start duplicates', async () => {
  let count = 0;
  const ai = client(async (_, options) => {
    if (++count === 1) return { ok: true, status: 200, json: () => stalled(options.signal) };
    return response();
  });
  const result = await ai.structured(input);
  assert.equal(count, 2); assert(result.transport.attempts[0].headersMs >= 0);
  let failed = 0;
  await assert.rejects(client(async () => { failed++; throw new Error('private details'); }).structured(input), { code: 'AI_NETWORK' });
  await sleep(20); assert.equal(failed, 1);
});

test('a late response that ignores abort cannot replace the winner or leak its mutable diagnostics', async () => {
  const original = gate(); let count = 0;
  const ai = client(async () => {
    if (++count === 1) { await original.promise; return response({ winner: 'late original' }); }
    return response({ winner: 'backup' });
  });
  const result = await ai.structured(input), snapshot = structuredClone(result);
  original.resolve(); await sleep(5);
  assert.deepEqual(result, snapshot); assert.equal(result.data.winner, 'backup'); assert.equal(ai.activeHedges, 0);
});

test('a fast duplicate still needs evidence repair; failed repair preserves the complete previous case', async () => {
  for (const brokenRepair of [false, true]) {
    const store = new CaseStore(':memory:'); let calls = 0; const payloads = [];
    const ai = client(async (_, options) => {
      const payload = JSON.parse(options.body); payloads.push(payload);
      if (++calls === 1) await stalled(options.signal);
      const data = JSON.parse(payload.input[0].content[0].text), [customer, agent] = data.messages;
      return response({ summary: '금액 안내', questions: [{ id: 'new-q-1', title: '환불 금액',
        source: { messageId: customer.id, quote: customer.text }, status: 'answered', reason: '10,000원 안내',
        evidence: [{ messageId: agent.id, quote: calls === 2 || brokenRepair ? '원문에 없는 금액' : agent.text }], followUp: '' }], promises: [] });
    });
    try {
      const svc = new ReplyTrack(store, ai);
      const c = svc.create({ title: '근거 검사', messages: [{ role: 'customer', text: '환불 금액은 얼마인가요?' }, { role: 'agent', text: '환불 금액은 10,000원입니다.' }] });
      const previous = structuredClone(c);
      if (brokenRepair) { await assert.rejects(svc.analyze(c.id, c.version), { code: 'AI_EVIDENCE' }); assert.deepEqual(store.get(c.id), previous); }
      else { const saved = await svc.analyze(c.id, c.version); assert.equal(saved.analysis.attempts, 2); assert.equal(saved.analysis.usage.unobserved_requests, 1); assert.equal(saved.questions[0].evidence[0].quote, c.messages[1].text); }
      assert.equal(calls, 3); assert.equal(payloads[2].reasoning.effort, 'medium'); assert.equal(svc.busy.size, 0);
    } finally { store.close(); }
  }
});
