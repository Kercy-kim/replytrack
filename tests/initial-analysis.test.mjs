import test from 'node:test';
import assert from 'node:assert/strict';
import { initialAnalysisPlan, FOCUSED_ANALYSIS_PROMPT } from '../src/analysis-focus.mjs';
import { EMAIL_ANALYSIS_PROMPT } from '../src/email.mjs';
import { INITIAL_ANALYSIS_PROMPT, INITIAL_EMAIL_ANALYSIS_PROMPT } from '../src/prompts.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { readFileSync } from 'node:fs';
const messages = [{role:'customer',text:'What documents? How long?'},{role:'agent',text:'Please provide your receipt.'}];
const seed = () => ({ analysis:null, questions:[], promises:[], channel:'email', messages:structuredClone(messages) });

test('initial plan retains all extraction fields, removes only unused drafts, and does not select lower effort', () => {
  const c={...seed(),channel:'chat'}, before=structuredClone(c), plan=initialAnalysisPlan(c), props=plan.schema.properties.questions.items.properties;
  for(const key of ['id','title','source','status','reason','evidence'])assert(key in props);
  assert(!('followUp' in props)); assert(!plan.schema.properties.questions.maxItems);
  assert(plan.schema.properties.promises); assert.equal(plan.effort,undefined); assert.equal(plan.restore,undefined);
  assert(!plan.schema.properties.promises.items.properties.deadlineCleared);
  assert.equal(plan.prompt,INITIAL_ANALYSIS_PROMPT);
  assert(!plan.prompt.includes('- followUp은'));
  assert.match(plan.prompt,/단순 선행 조건.*evidence에 보존/);
  assert.deepEqual(c,before);
});

test('separate processing and later-notification messages keep medium without redundant low-effort review', async()=>{
  const recorded=JSON.parse(readFileSync(new URL('../evals/results/initial-analysis/timing-final.json',import.meta.url))).results.find(r=>r.id==='T04');
  const store=new CaseStore(':memory:');let calls=0;
  try {
    const svc=new ReplyTrack(store,{async structured(args){
      calls++;assert.equal(args.reasoningEffort,'medium');
      let data=JSON.stringify(recorded.calls[0].data);
      recorded.stages[0].record.messages.forEach((m,i)=>{data=data.replaceAll(m.id,args.data.messages[i].id);});
      return {model:'recorded-correct-first-output',data:JSON.parse(data)};
    }});
    const c=svc.create({title:'발송과 후속 안내',messages:recorded.stages[0].record.messages});
    const result=await svc.analyze(c.id,c.version);
    assert.equal(calls,1);assert.equal(result.questions[0].status,'answered');
    assert.equal(result.promises.length,2);assert(result.promises.some(p=>p.dueText==='11월 18일'));
  }finally{store.close();}
});

test('initial scope excludes saved state, revisions, long histories and unresolved speakers', () => {
  for(const mutate of [c=>{c.analysis={};},c=>c.questions.push({}),c=>c.promises.push({}),c=>c.messages.push(...structuredClone(messages),...structuredClone(messages)),c=>{c.messages[1].text+='x'.repeat(2001);},c=>{c.messages[1].role='unknown';},c=>{c.messages[1].text+=' Correction: the earlier information was wrong.';}]) {
    const c=seed();mutate(c);assert.equal(initialAnalysisPlan(c),null);
  }
  const c=seed();c.messages[1].text+=' Only if approved.';assert.equal(initialAnalysisPlan(c),null);
  const after=seed();after.messages[1].text+=' After we verify the receipt, we will review the request.';assert.equal(initialAnalysisPlan(after),null);
});

test('compound questions with a shared future-notice quote keep medium and avoid redundant review', async()=>{
  const recorded=JSON.parse(readFileSync(new URL('../evals/results/initial-analysis/paired-verified.json',import.meta.url))).results.find(r=>r.variant==='after'&&r.id==='WEB-REFUND'&&r.repeat===3);
  const store=new CaseStore(':memory:');let calls=0;
  try {
    const svc=new ReplyTrack(store,{async structured(args){
      calls++;assert.equal(args.reasoningEffort,'medium');
      let data=JSON.stringify(recorded.calls[0].data);
      recorded.record.messages.forEach((m,i)=>{data=data.replaceAll(m.id,args.data.messages[i].id);});
      return {model:'recorded-correct-first-output',data:JSON.parse(data)};
    }});
    const c=svc.create({title:'복합 환불 질문',messages:recorded.record.messages});
    const result=await svc.analyze(c.id,c.version);
    assert.equal(calls,1);assert.deepEqual(result.questions.map(q=>q.status),['answered','unanswered','waiting']);
    assert.equal(result.promises.length,1);assert.match(result.promises[0].dueText,/11월 18일/);
  }finally{store.close();}
});

for(const broken of [false,true])test(`initial email preserves extraction, medium and citation repair (${broken})`,async()=>{
  const store=new CaseStore(':memory:'),calls=[];
  try {
    const svc=new ReplyTrack(store,{async structured(args){
      calls.push(args); const [customer,agent]=args.data.messages;
      assert.equal(store.get(c.id).analysis,null);
      return {model:'fixture',data:{summary:'영수증 제출 안내',questions:[
        {id:'new-q-1',title:'필요한 자료',source:{messageId:customer.id,quote:'What documents?'},status:'answered',reason:'영수증을 제출하라고 안내받았습니다.',evidence:[{messageId:agent.id,quote:broken&&calls.length===1?'Not in source':agent.text}]},
        {id:'new-q-2',title:'소요 기간',source:{messageId:customer.id,quote:'How long?'},status:'unanswered',reason:'관련 안내가 없습니다.',evidence:[]}
      ],promises:[]}};
    }});
    const c=svc.create({title:'자료 문의',channel:'email',messages});const result=await svc.analyze(c.id,c.version);
    assert.equal(calls.length,broken?2:1);assert(calls.every(c=>c.reasoningEffort==='medium'));
    assert(calls[0].instructions.startsWith(INITIAL_EMAIL_ANALYSIS_PROMPT));assert(calls[0].instructions.includes(EMAIL_ANALYSIS_PROMPT));
    assert(calls[0].schema.properties.promises.items.properties.deadlineCleared);
    assert(calls[0].instructions.includes('- 기존 약속 id를 재사용한다.'));
    assert.deepEqual(calls[0].data.messages,c.messages);assert(!calls[0].schema.properties.questions.items.properties.followUp);
    if(broken){assert(!calls[1].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));assert.match(calls[1].data.revisionFeedback,/원문/);}
    assert.deepEqual(result.questions.map(q=>q.status),['answered','unanswered']);assert(result.questions.every(q=>q.followUp===''));
  }finally{store.close();}
});
