import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenAIClient } from '../src/openai.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { createApp } from '../server.mjs';
import { createRefundDemo, demoActions } from '../src/demo.mjs';
import { actionsSchemaFor, validateActions, applyActions } from '../src/next-actions.mjs';
import { actionPlan, actionsFresh, actionsMarkdown } from '../public/next-actions.js';
import { cancelled } from '../src/operation.mjs';

function fixture(structured) {
  const store = new CaseStore(':memory:');
  const ai = { configured: true, model: 'test-fixture', structured };
  const service = new ReplyTrack(store, ai);
  const record = createRefundDemo(); record.mode = 'live';
  const c = store.create(record);
  return { store, service, ai, c };
}
const result = c => ({ data: demoActions(c), model: 'test-fixture', usage: { total_tokens: 10 } });

test('refund demo separates company request, generated suggestions, waiting, and real completion', () => {
  const c = createRefundDemo(), plan = actionPlan(c);
  assert(actionsFresh(c));
  assert.equal(plan.requests[0].title, '불량 사진 보내기');
  assert.equal(plan.suggestions.length, 1);
  assert.match(plan.suggestions[0].title, /배송비/);
  assert.equal(plan.waiting.length, 1);
  assert.equal(plan.confirmations.length, 0);
  assert.match(actionsMarkdown(c), /AI 제안 \/ 업체 요청 아님/);
});

test('source validation rejects invented quotes, roles, deadlines, conditions, and reused IDs', () => {
  const c = createRefundDemo();
  for (const mutate of [
    a => a.source.quote = '계좌번호를 보내 주세요.',
    a => a.source.messageId = c.messages[0].id,
    a => a.dueText = '모레까지',
    a => a.condition = '환불을 포기하면',
    a => a.source.quote = '불량 사진을 보내 주세요.',
    a => { a.state = 'withdrawn'; a.update = null; },
    a => { a.state = 'reported_done'; a.update = a.source; },
  ]) { const raw = structuredClone(demoActions(c)); mutate(raw.items[0]); assert.throws(() => validateActions(raw,c), { code: 'ACTIONS_EVIDENCE' }); }
  const dup = demoActions(c); dup.items.push(structuredClone(dup.items[0]));
  assert.throws(() => validateActions(dup,c), { code: 'ACTIONS_EVIDENCE' });
});

test('ambiguous regenerated IDs cannot reuse one previous completion for two actions', () => {
  const c = createRefundDemo();
  c.nextActions.items[0].completedAt = '2026-11-15T00:00:00Z';
  const before = structuredClone(c), raw = demoActions(c);
  const oldId = raw.items[0].id;
  raw.items[0].id = 'regenerated';
  raw.items.push({ ...structuredClone(raw.items[0]), id: oldId, title: '사진 제출' });
  assert.throws(() => applyActions(c, raw), { code: 'ACTIONS_EVIDENCE' });
  assert.deepEqual(c, before);
});

test('schema constrains company source IDs and does not add fields to existing analysis schema', () => {
  const c = createRefundDemo(), s = actionsSchemaFor(c);
  assert.deepEqual(s.properties.items.items.properties.source.properties.messageId.enum, [c.messages[1].id]);
  c.messages = c.messages.filter(m => m.role === 'customer');
  assert.equal(actionsSchemaFor(c).properties.items.maxItems, 0);
});

test('completion survives refresh and re-extraction without changing questions, promises, or drafts', async () => {
  const f = fixture(async () => ({}));
  try {
    let c = f.c, id = c.nextActions.items[0].id;
    const before = structuredClone({ questions: c.questions, promises: c.promises, drafts: c.drafts });
    c = f.service.completeAction(c.id,id,{version:c.version,completed:true});
    assert(c.nextActions.items[0].completedAt);
    f.ai.structured = async p => p.name === 'replytrack_actions' ? result(c) : { data: { valid: true, feedback: '' }, usage: {total_tokens:5} };
    c = await f.service.actions(c.id,c.version);
    assert.equal(c.nextActions.usage.total_tokens,15);
    assert(c.nextActions.items[0].completedAt);
    assert.deepEqual({ questions:c.questions,promises:c.promises,drafts:c.drafts },before);
    c = f.service.completeAction(c.id,id,{version:c.version,completed:false});
    assert.equal(c.nextActions.items[0].completedAt,null);
    assert.equal(f.store.get(c.id).nextActions.items[0].completedAt,null);
  } finally { f.store.close(); }
});

test('new message disables old action completion and hides stale question-based suggestions', () => {
  const f=fixture();
  try {
    const c=f.service.append(f.c.id,{version:f.c.version,role:'agent',text:'사진은 필요 없습니다.'});
    assert(!actionsFresh(c)); assert.equal(actionPlan(c).suggestions.length,0);
    assert.throws(()=>f.service.completeAction(c.id,c.nextActions.items[0].id,{version:c.version,completed:true}),e=>e.status===409);
    assert.match(actionsMarkdown(c),/이전 기록/);
    assert.deepEqual(c.nextActions,f.c.nextActions);
  } finally { f.store.close(); }
});

test('withdrawal requires a later agent quote, and omission retains a reviewable record', () => {
  const c=createRefundDemo();
  c.messages.push({id:'new',role:'agent',text:'사진은 필요 없습니다.',sentAt:null});
  const raw=demoActions(c); Object.assign(raw.items[0],{state:'withdrawn',update:{messageId:'new',quote:'사진은 필요 없습니다.'}});
  applyActions(c,raw); assert.equal(actionPlan(c).requests.length,0); assert.equal(actionPlan(c).history[0].state,'withdrawn');
  c.messages[2].role='customer'; assert.throws(()=>validateActions(raw,c),{code:'ACTIONS_EVIDENCE'});
  applyActions(c,{items:[]}); assert.equal(c.nextActions.items[0].state,'review');
});

test('a reported completion never invents user confirmation; repeated explicit requests get new work', () => {
  const c=createRefundDemo();
  c.messages.push({id:'done',role:'customer',text:'사진을 보냈습니다.',sentAt:null});
  const raw=demoActions(c); Object.assign(raw.items[0],{state:'reported_done',update:{messageId:'done',quote:'사진을 보냈습니다.'}});
  applyActions(c,raw); assert.equal(c.nextActions.items[0].completedAt,null);
  c.messages.push({id:'again',role:'agent',text:'더 선명한 사진을 다시 보내 주세요.',sentAt:null});
  raw.items.push({id:'new-photo',title:'선명한 사진 다시 보내기',source:{messageId:'again',quote:'더 선명한 사진을 다시 보내 주세요.'},state:'requested',dueText:'',condition:'',update:null});
  applyActions(c,raw); assert.equal(actionPlan(c).requests.length,1); assert.equal(actionPlan(c).history.length,1);
});

test('no inferred date for business days or missing message date; conditional source is preserved', () => {
  const c=createRefundDemo(); c.nextActions=undefined;
  c.messages[1].text='교환을 원하시면 3영업일 이내에 색상을 선택해 주세요.';
  applyActions(c,{items:[{id:'choice',title:'교환 색상 선택하기',source:{messageId:c.messages[1].id,quote:c.messages[1].text},condition:'교환을 원하시면',dueText:'3영업일 이내',state:'requested',update:null}]});
  assert.equal(c.nextActions.items[0].dueAt,null); assert.equal(c.nextActions.items[0].condition,'교환을 원하시면');
  c.nextActions=undefined; c.messages[1].text='내일까지 사진을 보내 주세요.'; c.messages[1].sentAt=null;
  applyActions(c,{items:[{id:'photo',title:'사진 보내기',source:{messageId:c.messages[1].id,quote:c.messages[1].text},condition:'',dueText:'내일까지',state:'requested',update:null}]});
  assert.equal(c.nextActions.items[0].dueAt,null);
});

test('review failure and provider failure preserve the complete saved record', async () => {
  const f=fixture();
  try {
    f.ai.structured=async p=>p.name==='replytrack_actions'?result(f.c):{data:{valid:false,feedback:'누락'}};
    await assert.rejects(f.service.actions(f.c.id,f.c.version),{code:'ACTIONS_REVIEW'});
    assert.deepEqual(f.store.get(f.c.id),f.c);
    f.ai.structured=async()=>{throw new Error('provider failed');};
    await assert.rejects(f.service.actions(f.c.id,f.c.version));
    assert.deepEqual(f.store.get(f.c.id),f.c);
  } finally { f.store.close(); }
});

test('cancel during generation prevents even a late provider response from saving or reviewing', async () => {
  const f=fixture(); let release, calls=0;
  try {
    const controller=new AbortController();
    f.ai.structured=async()=>{calls++; await new Promise(r=>{release=r;}); return result(f.c);};
    const pending=f.service.actions(f.c.id,f.c.version,{signal:controller.signal});
    controller.abort(cancelled()); release();
    await assert.rejects(pending,{code:'OPERATION_CANCELLED'});
    assert.equal(calls,1); assert.deepEqual(f.store.get(f.c.id),f.c);
  } finally { f.store.close(); }
});

test('concurrent record edits cannot be overwritten by an old action result', async () => {
  const f=fixture(); let release;
  try {
    f.ai.structured=async()=>{await new Promise(r=>{release=r;}); return result(f.c);};
    const pending=f.service.actions(f.c.id,f.c.version);
    const edited=f.service.metadata(f.c.id,{version:f.c.version,title:'수정한 환불 문의'}); release();
    await assert.rejects(pending,e=>e.status===409);
    assert.deepEqual(f.store.get(f.c.id),edited);
  } finally { f.store.close(); }
});

test('HTTP refund demo lifecycle and cancellable actions API preserve user completion', async () => {
  const app=createApp({store:new CaseStore(':memory:')});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
  try {
    let c=(await call('/api/demo','POST',{scenario:'refund'})).data;
    assert.equal(c.demoScenario,'refund');
    c=(await call(`/api/cases/${c.id}/actions/${c.nextActions.items[0].id}`,'PATCH',{version:c.version,completed:true})).data;
    assert(c.nextActions.items[0].completedAt); assert.equal(c.promises[0].confirmedAt,null);
    const job=(await call('/api/operations','POST',{id:randomUUID(),kind:'actions',caseId:c.id,input:{version:c.version}})).data;
    await app.operations.jobs.get(job.id).done;
    c=(await call(`/api/operations/${job.id}`)).data.result;
    assert(c.nextActions.items[0].completedAt);
    c=(await call(`/api/cases/${c.id}/demo-next`,'POST',{version:c.version})).data;
    assert.equal(c.nextActions.items[0].state,'reported_done'); assert(c.nextActions.items[0].completedAt);
    c=(await call(`/api/cases/${c.id}/demo-next`,'POST',{version:c.version})).data;
    assert.equal(actionPlan(c).confirmations.length,2);
    assert.equal(c.promises[1].confirmedAt,null);
    assert.equal((await call(`/api/cases/${c.id}/actions/missing`,'PATCH',{version:c.version,completed:true})).status,404);
    assert.equal((await call(`/api/cases/${c.id}/actions/${c.nextActions.items[0].id}`,'PATCH',{version:1,completed:false})).status,409);
    const legacy=(await call('/api/demo','POST',{})).data; assert.match(legacy.title,/A\/S/);
  } finally { await new Promise(r=>app.server.close(r)); app.store.close(); }
});

test('completed actions persist across DB reopen and summaries never hide an outstanding action', () => {
  const folder=mkdtempSync(join(tmpdir(),'replytrack-actions-'));
  let store=new CaseStore(join(folder,'test.sqlite'));
  try {
    const s=new ReplyTrack(store,{}); let c=s.demo({scenario:'refund'});
    assert.equal(store.list()[0].customerActions,1); assert.equal(store.list()[0].actionsNeedRefresh,false);
    c=s.completeAction(c.id,c.nextActions.items[0].id,{version:c.version,completed:true});
    store.close(); store=new CaseStore(join(folder,'test.sqlite'));
    assert.equal(store.get(c.id).nextActions.items[0].completedAt,c.nextActions.items[0].completedAt);
    assert.equal(store.list()[0].customerActions,0);
    const old=createRefundDemo(); delete old.nextActions; store.create(old);
    assert.equal(store.list().find(x=>x.id===old.id).actionsNeedRefresh,true);
    assert.equal(actionPlan(store.get(old.id)).requests.length,0);
  } finally { store.close(); rmSync(folder,{recursive:true,force:true}); }
});

test('actions use the real Responses serialization, strict schema and reversible ID aliases', async () => {
  let request;
  const c=createRefundDemo();
  const client=new OpenAIClient({apiKey:'sk-test-not-a-real-credential',fetchImpl:async(_,init)=>{
    request=JSON.parse(init.body);
    const wire=JSON.parse(request.input[0].content[0].text);
    const item={...wire.existingItems[0],state:'requested',update:null};
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items:[item]})}]}]}));
  }});
  const items=demoActions(c).items;
  const response=await client.structured({name:'replytrack_actions',schema:actionsSchemaFor(c),instructions:'Extract customer actions',data:{messages:c.messages,existingItems:items}});
  assert.equal(request.store,false); assert.equal(request.text.format.strict,true);
  assert(!JSON.stringify(request).includes(c.messages[0].id));
  validateActions(response.data,c); assert.equal(response.data.items[0].source.messageId,c.messages[1].id);
});
