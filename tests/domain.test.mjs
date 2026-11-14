import test from 'node:test';
import assert from 'node:assert/strict';
import { newCase, applyAnalysis, dueDate, validateDraft } from '../src/domain.mjs';
import { createDemo, demoAnalysis } from '../src/demo.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('questions are grounded in customer text, answers in agent text', () => {
  const c = createDemo(), raw = demoAnalysis(c);
  raw.questions[0].status='answered'; raw.questions[0].evidence=[{messageId:c.messages[1].id,quote:'수리비는 무료입니다.'}];
  raw.questions[1].evidence=[{messageId:c.messages[0].id,quote:'입고 후 수리는 며칠 걸리나요?'}];
  raw.questions.push({...raw.questions[2], id:'hallucinated',source:{messageId:c.messages[1].id,quote:'수리비는 점검 후 안내하겠습니다.'}});
  raw.promises.push({...raw.promises[0],id:'fake',evidence:{messageId:c.messages[1].id,quote:'오늘 환불합니다.'}});
  applyAnalysis(c,raw);
  assert.equal(c.questions.length,3);
  assert.equal(c.questions[0].status,'review');
  assert.equal(c.questions[1].status,'review');
  assert.equal(c.promises.length,1);
  assert(c.warnings.length>=2);
});
test('omitted questions and promises are retained for review', () => {
  const c=createDemo(), qid=c.questions[0].id, pid=c.promises[0].id;
  const raw=demoAnalysis(c); raw.questions.shift(); raw.promises=[];
  applyAnalysis(c,raw);
  assert.equal(c.questions.find(q=>q.id===qid).status,'review');
  assert(c.promises.some(p=>p.id===pid));
});
test('user corrections and confirmation survive additional replies', () => {
  const store=new CaseStore(':memory:'); const service=new ReplyTrack(store,{});
  try {
    let c=service.demo(); const q=c.questions[0], p=c.promises[0];
    c=service.question(c.id,q.id,{version:c.version,title:'내가 수정한 수리비 질문',status:'review'});
    c=service.promise(c.id,p.id,{version:c.version,confirmed:true});
    const confirmedAt=c.promises[0].confirmedAt;
    c=service.advance(c.id,c.version); c=service.advance(c.id,c.version);
    assert.equal(c.questions[0].status,'review');
    assert.equal(c.questions[0].aiStatus,'answered');
    assert.equal(c.questions[0].title,'내가 수정한 수리비 질문');
    assert.equal(c.promises[0].confirmedAt,confirmedAt);
    c=service.question(c.id,q.id,{version:c.version,applyAI:true});
    assert.equal(c.questions[0].status,'answered');
    assert.equal(c.questions[0].manualStatus,null);
  } finally { store.close(); }
});
test('agent report is not user-confirmed completion', () => {
  const store=new CaseStore(':memory:'); const service=new ReplyTrack(store,{});
  try {
    let c=service.demo(); c=service.advance(c.id,c.version); c=service.advance(c.id,c.version);
    assert.equal(c.promises[0].state,'reported'); assert.equal(c.promises[0].confirmedAt,null);
    assert(c.questions.every(q=>q.status==='answered'));
    assert(c.promises[0].dueAt);
  } finally {store.close();}
});
test('waiting without a linked future commitment becomes review, not an invented promise', () => {
  const c = createDemo(), raw = demoAnalysis(c);
  c.promises = []; raw.promises = [];
  applyAnalysis(c, raw);
  assert.equal(c.questions[0].aiStatus, 'review');
  assert.equal(c.questions[0].status, 'review');
  assert.equal(c.promises.length, 0);
  assert(c.warnings.some(w => w.includes('답변 대기')));
});
test('unanswered with cited agent guidance is flagged without discarding the source or comparison', () => {
  const c = createDemo(), raw = demoAnalysis(c), originalId = c.questions[2].id;
  const evidence = { messageId: c.messages[1].id, quote: raw.questions[0].evidence[0].quote };
  raw.questions[2].status = 'unanswered'; raw.questions[2].evidence = [evidence];
  applyAnalysis(c, raw);
  const q = c.questions.find(q => q.id === originalId);
  assert.equal(q.status, 'review'); assert.equal(q.aiStatus, 'review');
  assert.deepEqual(q.evidence, [evidence]);
  assert(c.warnings.some(w => w.includes('미답변')));
  const change = c.analysis.comparison.questions.find(q => q.id === originalId);
  assert.equal(change.before.status, 'unanswered'); assert.equal(change.after.status, 'review');
});
test('an inconsistent unanswered AI label cannot overwrite a manual status', () => {
  const c = createDemo(), raw = demoAnalysis(c);
  c.questions[2].manualStatus = 'partial'; c.questions[2].status = 'partial';
  raw.questions[2].status = 'unanswered'; raw.questions[2].evidence = raw.questions[0].evidence;
  applyAnalysis(c, raw);
  assert.equal(c.questions[2].status, 'partial'); assert.equal(c.questions[2].aiStatus, 'review');
});
test('waiting requires the promise to be linked to that question and its cited reply', () => {
  const valid = createDemo(); applyAnalysis(valid, demoAnalysis(valid));
  assert.equal(valid.questions[0].status, 'waiting');
  const unrelated = createDemo(), raw = demoAnalysis(unrelated);
  unrelated.promises = []; raw.promises[0].questionIds = [raw.questions[2].id];
  applyAnalysis(unrelated, raw);
  assert.equal(unrelated.questions[0].status, 'review');
});
test('unsupported AI waiting does not overwrite a manually chosen status', () => {
  const c = createDemo(), raw = demoAnalysis(c);
  c.questions[0].manualStatus = 'partial'; c.questions[0].status = 'partial';
  c.promises = []; raw.promises = [];
  applyAnalysis(c, raw);
  assert.equal(c.questions[0].status, 'partial'); assert.equal(c.questions[0].aiStatus, 'review');
});
test('deadlines use known source date in Korea, never analysis time', () => {
  assert.equal(dueDate('내일까지',null),null);
  assert.equal(dueDate('내일까지','2026-12-31T16:00:00Z'),'2027-01-02');
  assert.equal(dueDate('모레','2026-02-27T00:00:00+09:00'),'2026-03-01');
  assert.equal(dueDate('2026년 2월 30일까지',null),null);
  assert.equal(dueDate('2026-12-20까지',null),'2026-12-20');
  assert.equal(dueDate('3~5영업일','2026-11-14T00:00:00Z'),null);
});
test('drafts reject invented source references and numbers', () => {
  const c=createDemo();
  assert.throws(()=>validateDraft({body:'환불은 50,000원입니다.',sourceMessageIds:[c.messages[1].id]},c),{code:'DRAFT_FACT'});
  assert.throws(()=>validateDraft({body:'안녕하세요.',sourceMessageIds:['missing']},c),{code:'DRAFT_EVIDENCE'});
  assert.equal(validateDraft({body:'수리비 안내 예정일과 왕복 배송비 부담 주체를 알려 주세요.',sourceMessageIds:c.messages.map(m=>m.id)},c).sourceMessageIds.length,2);
});
test('drafts cannot infer identical or different agents from anonymized message roles', () => {
  const c = createDemo(), sourceMessageIds = c.messages.map(m => m.id);
  for (const actor of ['동일 상담원', '같은 담당자', '다른 한 상담원', '두 명의 상담사', '여러 담당자', '상담원들', '상담사들', '담당자들']) {
    assert.throws(() => validateDraft({ body: `${actor}의 안내가 달랐습니다.`, sourceMessageIds }, c), { code: 'DRAFT_ACTOR' });
  }
  assert.equal(validateDraft({ body: '이전 답변과 후속 답변의 안내가 달랐습니다.', sourceMessageIds }, c).body, '이전 답변과 후속 답변의 안내가 달랐습니다.');
  c.messages[0].text += ' 다른 상담원에게 연결됐어요.';
  assert.equal(validateDraft({ body: '다른 상담원에게 연결됐습니다.', sourceMessageIds: [c.messages[0].id] }, c).body, '다른 상담원에게 연결됐습니다.');
  c.messages[0].text += ' 상담원들이 안내했습니다.';
  assert.equal(validateDraft({ body: '상담원들의 안내를 받았습니다.', sourceMessageIds: [c.messages[0].id] }, c).body, '상담원들의 안내를 받았습니다.');
});
test('drafts reject internal message IDs in prose but allow identifiers actually present in the source', () => {
  const c = createDemo(), id = c.messages[0].id;
  assert.throws(() => validateDraft({ body: `이전 문의(${id})의 답변을 알려 주세요.`, sourceMessageIds: [id] }, c), { code: 'DRAFT_REFERENCE' });
  c.messages[0].text += ` 고객에게 보이는 접수번호는 ${id}입니다.`;
  assert.equal(validateDraft({ body: `접수번호 ${id}의 답변을 알려 주세요.`, sourceMessageIds: [id] }, c).sourceMessageIds[0], id);
});
test('stale writes cannot overwrite recent changes', () => {
  const store=new CaseStore(':memory:');
  try { const c=store.create(createDemo()); store.save(c,c.version); assert.throws(()=>store.save(c,c.version),{code:'VERSION_CONFLICT'}); }
  finally {store.close();}
});
test('failed AI keeps appended source, old analysis and pending status', async () => {
  const store=new CaseStore(':memory:');
  const ai={structured:async()=>{throw new Error('provider offline');}};
  const service=new ReplyTrack(store,ai);
  try {
    let c=createDemo(); c.mode='live'; c=store.create(c);
    c=service.append(c.id,{version:c.version,role:'agent',text:'배송비는 업체 부담입니다.'});
    await assert.rejects(()=>service.analyze(c.id,c.version),/provider offline/);
    const saved=store.get(c.id);
    assert.equal(saved.messages.length,3); assert.equal(saved.analyzedMessageCount,2);
    assert.equal(saved.questions[2].status,'unanswered'); assert.equal(service.busy.size,0);
    assert.equal(store.list()[0].pendingAnalysis,true);
  } finally {store.close();}
});
test('AI result arriving after manual edits is rejected', async () => {
  const store=new CaseStore(':memory:'); let resolveAI;
  const service=new ReplyTrack(store,{structured:()=>new Promise(resolve=>{resolveAI=resolve;})});
  try {
    let c=createDemo(); c.mode='live'; c=store.create(c);
    const analysis=service.analyze(c.id,c.version);
    service.question(c.id,c.questions[0].id,{version:c.version,status:'review'});
    resolveAI({data:demoAnalysis(c),model:'test'});
    await assert.rejects(analysis,{code:'VERSION_CONFLICT'});
    assert.equal(store.get(c.id).questions[0].status,'review');
  } finally {store.close();}
});
test('unknown speakers and empty conversations require review',()=>{
  assert.throws(()=>newCase({title:'test',messages:[{role:'unknown',text:'hello'}]}),{status:400});
  assert.throws(()=>newCase({title:'test',messages:[]}),{status:400});
});
test('blank extraction is rejected without spending an AI request',async()=>{
  let calls=0;
  const service=new ReplyTrack(null,{structured:()=>{calls++;}});
  await assert.rejects(()=>service.extract({text:'   '}),{status:400});
  assert.equal(calls,0);
});
test('SQLite records survive closing and reopening the store',()=>{
  const dir=mkdtempSync(join(tmpdir(),'replytrack-test-')), file=join(dir,'cases.sqlite');
  let store=new CaseStore(file);
  try {
    const c=store.create(createDemo()); store.close(); store=new CaseStore(file);
    const saved=store.get(c.id);
    assert.equal(saved.messages[0].text,c.messages[0].text);
    assert.deepEqual(saved.questions,c.questions);
    assert.equal(store.list().length,1);
  } finally {
    store.close();
    for(const name of readdirSync(dir)) unlinkSync(join(dir,name));
    rmdirSync(dir);
  }
});
