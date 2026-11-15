import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Operations, checkpoint } from '../src/operation.mjs';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { createDemo, demoAnalysis, demoDraft } from '../src/demo.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = data => Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(data) }] }] });
const key = 'sk-test-not-a-real-credential';

test('cancellation acknowledges immediately and ignores a late provider completion; finished work cannot be falsely cancelled', async () => {
  const operations = new Operations(); const gate = deferred(); let saved = false;
  const id = randomUUID();
  operations.start(id, async context => { checkpoint(context, 'analysis'); await gate.promise; checkpoint(context, 'saving'); saved = true; });
  await Promise.resolve();
  assert.equal(operations.get(id).stage, 'analysis');
  assert.equal(operations.cancel(id).state, 'cancelled');
  gate.resolve(); await operations.jobs.get(id).done;
  assert.equal(saved, false); assert.equal(operations.get(id).state, 'cancelled');
  const completed = randomUUID(); operations.start(completed, () => 'saved'); await operations.jobs.get(completed).done;
  assert.equal(operations.cancel(completed).state, 'completed');
  assert.equal(operations.get(completed).result, 'saved');
  operations.close();
});

test('overall timeout blocks late writes, finished jobs expire without new requests, and last checkpoint honors abort', async () => {
  const operations = new Operations({ timeoutMs: 5, retentionMs: 15 }); const gate = deferred(); let saved = false;
  const id = randomUUID(); let signal;
  operations.start(id, async context => { signal = context.signal; await gate.promise; checkpoint(context, 'saving'); saved = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(operations.get(id).error.code, 'OPERATION_TIMEOUT'); assert(signal.aborted);
  const done = operations.jobs.get(id).done; gate.resolve(); await done; assert.equal(saved, false);
  await new Promise(resolve => setTimeout(resolve, 20)); assert.throws(() => operations.get(id), { status: 404 });
  const controller = new AbortController();
  assert.throws(() => checkpoint({ signal: controller.signal, onStage: () => controller.abort() }, 'saving'), { code: 'OPERATION_CANCELLED' });
  operations.close();
});

test('Responses aborts both fetch and body reading; timeouts remain distinct from user cancellation', async () => {
  const controller = new AbortController(); let requestSignal;
  const client = new OpenAIClient({ apiKey: key, fetchImpl: async (_, options) => {
    requestSignal = options.signal;
    return { ok: true, json: () => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })) };
  } });
  const promise = client.structured({ data: {}, signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await assert.rejects(promise, { code: 'OPERATION_CANCELLED' }); assert(requestSignal.aborted);
  client.timeoutMs = 5;
  const keepAlive = setTimeout(() => {}, 100);
  await assert.rejects(client.structured({ data: {} }), { code: 'AI_TIMEOUT' }); clearTimeout(keepAlive);
  const fetchController = new AbortController();
  client.fetch = async (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  const fetching = client.structured({ signal: fetchController.signal }); fetchController.abort();
  await assert.rejects(fetching, { code: 'OPERATION_CANCELLED' });
});

test('preflight calls the provider without conversations; config changes invalidate success and errors never expose credentials', async () => {
  const payloads = []; const client = new OpenAIClient({ apiKey: key, fetchImpl: async (_, options) => { payloads.push(JSON.parse(options.body)); return response({ ok: true }); } });
  const app = createApp({ store: new CaseStore(':memory:'), ai: client });
  try {
    assert.equal(app.service.config().connection.state, 'unchecked');
    await app.service.preflight();
    assert.equal(app.service.config().connection.state, 'ready');
    assert.deepEqual(JSON.parse(payloads[0].input[0].content[0].text), { check: true });
    assert.equal(payloads[0].max_output_tokens, 512);
    assert(!JSON.stringify(app.service.config()).includes(key));
    await app.service.ensureConnection(); assert.equal(payloads.length, 1);
    app.service.configure({ model: 'gpt-5-mini' }); assert.equal(app.service.config().connection.state, 'unchecked');
    client.fetch = async () => new Response(key, { status: 401 });
    await assert.rejects(app.service.preflight(), { code: 'AI_AUTH' });
    assert.equal(app.service.config().connection.state, 'failed'); assert(!JSON.stringify(app.service.config()).includes(key));
    const gate = deferred(); client.fetch = async () => { await gate.promise; return response({ ok: true }); };
    const pending = app.service.preflight(); app.service.configure({ model: 'new-model' }); gate.resolve();
    await assert.rejects(pending, { status: 409 }); assert.equal(app.service.config().connection.state, 'unchecked');
    assert.throws(() => client.configure({ apiKey: 'sk-another-test-credential-long', model: '<invalid>' })); assert.equal(client.apiKey, key);
  } finally { app.operations.close(); app.store.close(); }
});

test('preflight distinguishes missing key, authentication, provider limit, model and network failures', async () => {
  const ai = new OpenAIClient(); const app = createApp({ store: new CaseStore(':memory:'), ai });
  try {
    await assert.rejects(app.service.preflight(), { code: 'API_KEY_REQUIRED' });
    ai.configure({ apiKey: key });
    for (const [status, code] of [[401, 'AI_AUTH'], [429, 'AI_LIMIT'], [400, 'AI_PROVIDER']]) {
      ai.fetch = async () => new Response('private provider diagnostics', { status });
      await assert.rejects(app.service.preflight(), { code });
      assert.equal(app.service.config().connection.state, 'failed'); assert(!JSON.stringify(app.service.config()).includes('private provider diagnostics'));
    }
    ai.fetch = async () => { throw new TypeError('network failed'); };
    await assert.rejects(app.service.preflight(), { code: 'AI_NETWORK' });
  } finally { app.operations.close(); app.store.close(); }
});

test('HTTP real stages, analysis/draft/reading cancellation preserve input, saved edits and previous analysis', async () => {
  let gate, entered; let blockedName = '';
  const ai = { configured: true, model: 'fixture', structured: async ({ name, data, signal }) => {
    if (name === blockedName) { entered.resolve(signal); await gate.promise; } // Deliberately ignores abort.
    let result;
    if (name === 'replytrack_connection') result = { ok: true };
    else if (name === 'replytrack_analysis') {
      result = demoAnalysis({ messages: data.messages, questions: data.existingQuestions, promises: data.existingPromises });
      if (blockedName === 'replytrack_boundary_review') result.questions[0].status = 'review';
    }
    else if (name === 'replytrack_boundary_review') result = { questions: [] };
    else if (name === 'replytrack_draft_review') result = { valid: true, feedback: '', checks: { consumerVoice: true, selectedQuestionsCovered: true, sourceFactsOnly: true, noExtraRequests: true, noAnsweredRequests: true } };
    else if (name === 'replytrack_transcript') result = { messages: [{ role: 'customer', text: data.text }], notes: [] };
    else result = demoDraft({ messages: data.messages, questions: data.questions.map(q => ({ ...q, title: q.topicHint ?? q.title })), promises: data.promises }, data.kind, data.questions.map(q => q.id));
    return { data: result, model: 'fixture' };
  } };
  const app = createApp({ store: new CaseStore(':memory:'), ai });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const call = async (path, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  try {
    const record = createDemo(); record.mode = 'live'; record.drafts.followup = { ...demoDraft(record, 'followup', record.questions.map(q => q.id)), editedBody: '내가 수정하고 저장한 초안' };
    const stored = app.store.create(record);
    for (const [kind, name, stage] of [['analyze', 'replytrack_analysis', 'analysis'], ['analyze', 'replytrack_boundary_review', 'boundary_review'], ['draft', 'replytrack_draft_review', 'draft_review'], ['extract', 'replytrack_transcript', 'reading']]) {
      blockedName = name; gate = deferred(); entered = deferred(); const id = randomUUID();
      const body = { id, kind, caseId: stored.id, input: { version: stored.version, kind: 'followup', questionIds: stored.questions.map(q => q.id), text: '내가 입력한 질문입니다.' } };
      assert.equal((await call('/api/operations', 'POST', body)).status, 202);
      const signal = await entered.promise;
      const running = (await call(`/api/operations/${id}`)).data;
      assert.equal(running.stage, stage); assert(running.elapsedMs >= 0);
      assert(!JSON.stringify(running).includes('내가 입력한'));
      assert.equal((await call(`/api/operations/${id}`, 'DELETE', {})).data.state, 'cancelled'); assert(signal.aborted);
      gate.resolve(); await app.operations.jobs.get(id).done;
      assert.deepEqual(app.store.get(stored.id), stored);
      assert.equal((await call(`/api/operations/${id}`)).data.state, 'cancelled');
    }
    blockedName = '';
    const id = randomUUID();
    await call('/api/operations', 'POST', { id, kind: 'analyze', caseId: stored.id, input: { version: stored.version } });
    await app.operations.jobs.get(id).done;
    const done = (await call(`/api/operations/${id}`)).data;
    assert.equal(done.state, 'completed'); assert(done.events.some(e => e.stage === 'validation')); assert(done.events.some(e => e.stage === 'saving'));
    assert.equal(done.result.version, stored.version + 1);
    assert.equal((await call('/api/operations', 'POST', { id: randomUUID(), kind: 'analyze', caseId: stored.id, input: { version: stored.version } })).status, 409);
    const cross = await fetch(`http://127.0.0.1:${app.server.address().port}/api/operations/${id}`, { headers: { Origin: 'https://evil.example' } }); assert.equal(cross.status, 403);
  } finally { gate?.resolve(); app.operations.close(); await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
