import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDemo, advanceDemo, demoAnalysis, demoReplies } from '../src/demo.mjs';
import { applyAnalysis, message } from '../src/domain.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { createApp } from '../server.mjs';

test('reply comparison records only effective question, deadline and reported-state changes', () => {
  const c = createDemo();
  assert.equal(c.analysis.comparison.kind, 'initial');
  assert.deepEqual(c.analysis.comparison.questions, []);
  advanceDemo(c);
  const first = structuredClone(c.analysis.comparison);
  assert.equal(first.kind, 'reply');
  assert.equal(first.fromMessageCount, 2); assert.equal(first.toMessageCount, 3);
  assert.deepEqual(first.messageIds, [c.messages[2].id]);
  assert.equal(first.questions.length, 1);
  assert.equal(first.questions[0].id, c.questions[2].id);
  assert.equal(first.questions[0].before.status, 'unanswered');
  assert.equal(first.questions[0].after.status, 'answered');
  assert.deepEqual(first.questions[0].evidenceMessageIds, [c.messages[2].id]);
  assert.deepEqual(first.promises[0].fields, ['deadline']);
  assert.equal(first.promises[0].before.dueAt, null);
  assert.match(first.promises[0].after.dueAt, /^\d{4}-\d{2}-\d{2}$/);
  advanceDemo(c);
  const second = c.analysis.comparison;
  assert.equal(second.questions.length, 1);
  assert.equal(second.questions[0].before.status, 'waiting');
  assert.equal(second.questions[0].after.status, 'answered');
  assert.deepEqual(second.promises[0].fields, ['state']);
  assert.equal(second.promises[0].after.state, 'reported');
  assert.equal(second.promises[0].after.confirmedAt, null);
  assert.deepEqual(c.history.filter(h => h.type === 'analysis')[1].comparison, first);
});

test('same-source reanalysis has no fabricated reply or change; prior snapshots stay intact', () => {
  const c = advanceDemo(createDemo());
  const previous = structuredClone(c.analysis.comparison);
  applyAnalysis(c, demoAnalysis(c));
  assert.equal(c.analysis.comparison.kind, 'reanalysis');
  assert.deepEqual(c.analysis.comparison.messageIds, []);
  assert.deepEqual(c.analysis.comparison.questions, []);
  assert.deepEqual(c.analysis.comparison.promises, []);
  assert.deepEqual(c.history.filter(h => h.type === 'analysis')[1].comparison, previous);
});

test('manual question status and actual confirmation remain distinct from changed AI suggestions', () => {
  const c = createDemo();
  c.questions[0].status = c.questions[0].manualStatus = 'review';
  c.promises[0].confirmedAt = '2026-11-13T00:00:00Z';
  advanceDemo(c); advanceDemo(c);
  const q = c.analysis.comparison.questions.find(q => q.id === c.questions[0].id);
  assert.equal(q.before.status, 'review'); assert.equal(q.after.status, 'review');
  assert.equal(q.before.aiStatus, 'waiting'); assert.equal(q.after.aiStatus, 'answered');
  assert.equal(q.after.manualStatus, 'review');
  assert.equal(c.analysis.comparison.promises[0].before.confirmedAt, '2026-11-13T00:00:00Z');
  assert.equal(c.analysis.comparison.promises[0].after.confirmedAt, '2026-11-13T00:00:00Z');
});

test('new questions and promises are additions, while omitted commitments are preserved', () => {
  const c = createDemo();
  const customer = message({role:'customer', text:'수거도 해 주시나요?'});
  const agent = message({role:'agent', text:'수거 접수를 진행하겠습니다.'});
  c.messages.push(customer, agent);
  const raw = demoAnalysis(c);
  // Keep the original analysis, then add the new exchange without demo-specific positional replies.
  raw.questions = structuredClone(c.questions);
  raw.questions.push({id:'pickup',title:'수거 가능 여부',source:{messageId:customer.id,quote:customer.text},status:'waiting',reason:'접수 예정',evidence:[{messageId:agent.id,quote:agent.text}]});
  raw.promises = [{id:'pickup-promise',title:'수거 접수',questionIds:['pickup'],evidence:{messageId:agent.id,quote:agent.text},dueText:'',state:'promised'}];
  applyAnalysis(c, raw);
  const comparison = c.analysis.comparison;
  assert.equal(comparison.kind, 'messages');
  assert.deepEqual(comparison.messageIds, [customer.id, agent.id]);
  assert.equal(comparison.questions.length, 1); assert.equal(comparison.questions[0].before, null);
  assert.equal(comparison.promises.length, 1); assert.equal(comparison.promises[0].before, null);
  assert.deepEqual(comparison.promises[0].fields, ['added']);
  assert.equal(c.promises.length, 2);
});

test('invalid evidence cannot create a false resolved change or a fabricated promise', () => {
  const c = createDemo(), raw = demoAnalysis(c);
  raw.questions[2].status = 'answered';
  raw.questions[2].evidence = [{messageId:c.messages[1].id,quote:'왕복 배송비는 무료입니다.'}];
  raw.promises.push({id:'invented',title:'환불',questionIds:[],state:'reported',dueText:'',evidence:{messageId:c.messages[1].id,quote:'환불을 완료했습니다.'}});
  applyAnalysis(c, raw);
  assert.equal(c.analysis.comparison.questions[0].after.status, 'review');
  assert.deepEqual(c.analysis.comparison.promises, []);
});

test('promise content changes are shown, equivalent known dates are not; unknown date wording remains visible', () => {
  const c = advanceDemo(createDemo());
  const raw = demoAnalysis(c), dueAt = c.promises[0].dueAt;
  const agent = message({role:'agent',text:`${dueAt}까지 문자로 견적을 보내겠습니다.`,sentAt:null});
  c.messages.push(agent);
  raw.promises[0] = {...raw.promises[0],title:'문자로 견적 안내',dueText:`${dueAt}까지`,evidence:{messageId:agent.id,quote:agent.text}};
  applyAnalysis(c, raw);
  assert.deepEqual(c.analysis.comparison.promises[0].fields, ['title']);
  const unknown = createDemo();
  unknown.messages.push(message({role:'agent',text:demoReplies[0]}));
  applyAnalysis(unknown, demoAnalysis(unknown));
  const change = unknown.analysis.comparison.promises[0];
  assert.equal(change.before.dueAt, null); assert.equal(change.after.dueAt, null);
  assert.equal(change.after.dueText, '내일까지');
  assert.deepEqual(change.fields, ['deadline']);
});

test('failed and conflicted analyses keep the last successful comparison and its history', async () => {
  const store = new CaseStore(':memory:');
  let resolveAI;
  const service = new ReplyTrack(store, {structured:async () => { throw new Error('offline'); }});
  try {
    let seed = advanceDemo(createDemo()); seed.mode = 'live';
    let c = store.create(seed);
    const previous = structuredClone(c.analysis.comparison);
    c = service.append(c.id,{version:c.version,role:'agent',text:demoReplies[1]});
    await assert.rejects(service.analyze(c.id,c.version), /offline/);
    assert.deepEqual(store.get(c.id).analysis.comparison, previous);
    service.ai = {structured:() => new Promise(resolve => { resolveAI = resolve; })};
    const pending = service.analyze(c.id,c.version);
    await new Promise(resolve => setImmediate(resolve)); // Wait for the asynchronous repository read before the provider response.
    service.question(c.id,c.questions[0].id,{version:c.version,status:'review'});
    resolveAI({data:demoAnalysis(c),model:'test'});
    await assert.rejects(pending, {code:'VERSION_CONFLICT'});
    const saved = store.get(c.id);
    assert.deepEqual(saved.analysis.comparison, previous);
    assert.deepEqual(saved.history.find(h => h.type === 'analysis').comparison, previous);
    assert.equal(saved.analyzedMessageCount, 3);
  } finally { store.close(); }
});

test('legacy records gain a comparison on next analysis; latest and historical snapshots survive DB reopen', () => {
  const directory = mkdtempSync(join(tmpdir(),'replytrack-comparison-'));
  const file = join(directory,'cases.sqlite');
  let store = new CaseStore(file);
  try {
    const legacy = createDemo();
    delete legacy.analysis.comparison;
    legacy.history.forEach(h => { delete h.comparison; });
    let c = store.create(legacy), service = new ReplyTrack(store, {});
    c = service.advance(c.id,c.version);
    const first = structuredClone(c.analysis.comparison);
    c = service.advance(c.id,c.version);
    const latest = structuredClone(c.analysis.comparison), id = c.id;
    store.close(); store = new CaseStore(file);
    c = store.get(id);
    assert.deepEqual(c.analysis.comparison, latest);
    assert.deepEqual(c.history.filter(h => h.type === 'analysis')[1].comparison, first);
    assert.equal(c.history.filter(h => h.type === 'analysis')[2].comparison, undefined);
  } finally { store.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('HTTP replies expose persisted comparisons; manual confirmations do not rewrite analysis snapshots', async () => {
  const app = createApp({store:new CaseStore(':memory:')});
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path,method='GET',body) => {
    const response = await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
    assert(response.ok); return response.json();
  };
  try {
    let c = await call('/api/demo','POST',{}), path = `/api/cases/${c.id}`;
    c = await call(path+'/demo-next','POST',{version:c.version});
    const expected = structuredClone(c.analysis.comparison);
    c = await call(path+'/promises/'+c.promises[0].id,'PATCH',{version:c.version,confirmed:true});
    c = await call(path);
    assert.deepEqual(c.analysis.comparison, expected);
    assert.equal(c.history[0].type, 'confirmation');
    assert.equal(c.analysis.comparison.promises[0].after.confirmedAt, null);
    assert(c.promises[0].confirmedAt);
  } finally { await new Promise(resolve => app.server.close(resolve)); app.store.close(); }
});
