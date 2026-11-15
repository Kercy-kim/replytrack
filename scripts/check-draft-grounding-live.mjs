// Paid regression using saved synthetic analyses; no question re-analysis or user records.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack, draftQuestionContext, draftSourceContext } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { DRAFT_REVIEW_PROMPT } from '../src/prompts.mjs';
import { draftReviewSchema } from '../src/schema.mjs';
import { draftChecks, reviewPassed } from '../src/feature-review.mjs';
assert(process.argv.includes('--run'));
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6)||'evals/results/usability/draft-grounding.json';
const omissionOnly=process.argv.includes('--omission-only');
assert(!existsSync(out), 'Preserve earlier results.');
const sourcePath='evals/results/usability/full48.json';
const source=JSON.parse(readFileSync(sourcePath));
const failed=source.results.find(r=>r.id==='S04');
const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:'gpt-5-mini-2025-08-07'});
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const report={mode:'Live draft regeneration and reviewer controls, saved synthetic analyses',sourcePath,sourceHash:digest(sourcePath),hashes:Object.fromEntries(['src/prompts.mjs','src/service.mjs','src/schema.mjs','src/feature-review.mjs','scripts/check-draft-grounding-live.mjs'].map(p=>[p,digest(p)])),results:[]};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
const record=structuredClone(failed.stages.at(-1).record);
const good={body:'제 주문의 추가 배송비가 얼마인지 알려주시겠습니까?',sourceMessageIds:record.messages.map(m=>m.id)};
const explicit=structuredClone(record);explicit.messages[0].text+=' 배송지는 제주도입니다.';
const probes=[
  ['invented-location',record,failed.draft,false],
  ['question-only',record,good,true],
  ['customer-confirmed-location',explicit,failed.draft,true],
  ['wrong-speaker',record,{...good,body:'고객님의 배송지가 제주도인지 알려주세요.'},false],
];
for(const [name,c,draft,expectedValid] of (omissionOnly?[]:probes)){
  const r={name,kind:'review-control',expectedValid};report.results.push(r);
  try{const result=await client.structured({name:'replytrack_draft_review',schema:draftReviewSchema,instructions:DRAFT_REVIEW_PROMPT,reasoningEffort:'medium',data:{kind:'followup',...draftSourceContext(c,'followup'),questions:draftQuestionContext(c.questions.filter(q=>q.status!=='answered')),draft:{body:draft.body,sourceMessageIds:draft.sourceMessageIds}}});r.response=result;r.passed=reviewPassed(result.data,draftChecks)===expectedValid;}
  catch(e){r.error=e.message;r.passed=false;}save();console.log(`${name}: ${r.passed?'PASS':'FAIL'}`);
}
const jobs=omissionOnly?[{name:'S02-missing-question-repair',source:source.results.find(r=>r.id==='S02'),omission:true}]:[...source.results.filter(r=>r.draft).map(r=>({name:r.id,source:r})),...Array.from({length:2},(_,i)=>({name:`S04-repeat-${i+1}`,source:failed})),{name:'S04-wrong-feedback-replay',source:failed,replay:true}];
let cursor=0;
async function worker(){while(cursor<jobs.length){
  const job=jobs[cursor++],store=new CaseStore(':memory:'),r={name:job.name,kind:job.omission?'controlled incomplete draft with live review and repair':job.replay?'controlled erroneous-review replay with live generation and final review':'product draft regeneration',calls:[]};report.results.push(r);
  let replayed=false,omitted=false;
  const ai={async structured(args){
    if(job.omission&&!omitted&&args.name==='replytrack_draft'){
      omitted=true;const data={body:'배송비는 얼마인가요?',sourceMessageIds:[job.source.stages.at(-1).record.messages[0].id]};
      r.calls.push({name:args.name,syntheticOmission:true,data});return {data,model:'omission-control'};
    }
    if(job.replay&&!replayed&&args.name==='replytrack_draft_review'){
      replayed=true;const data=job.source.calls.find(c=>c.name==='replytrack_draft_review'&&c.data.valid===false).data;
      r.calls.push({name:args.name,syntheticReplay:true,data});return {data,model:'recorded-error-replay'};
    }
    const start=Date.now(),response=await client.structured(args);r.calls.push({name:args.name,ms:Date.now()-start,...response});return response;
  }};
  try{
    const c=store.create(structuredClone(job.source.stages.at(-1).record)),service=new ReplyTrack(store,ai);
    const updated=await service.draft(c.id,{version:c.version,kind:'followup',questionIds:c.questions.filter(q=>q.status!=='answered').map(q=>q.id)});
    r.draft=updated.drafts.followup;r.passed=true;
    if(job.source.id==='S04'){
      // The place occurs only in a policy example and must not become a supplied address.
      assert(!/제주|배송지\s*(?:는|가|:)|고객님의/.test(r.draft.body));
      assert(/배송비/.test(r.draft.body));
    }
    assert(updated.drafts.followup.review);
    if(job.omission){assert.match(r.draft.body,/도착/);assert.match(r.draft.body,/배송비/);assert.equal(r.draft.review.attempts,2);}
  }catch(e){r.error=e.message;r.passed=false;}finally{store.close();save();console.log(`${r.name}: ${r.passed?'PASS':'FAIL'}`);}
}}
await Promise.all([worker(),worker()]);
report.passed=report.results.length===(omissionOnly?1:14)&&report.results.every(r=>r.passed);save();if(!report.passed)process.exitCode=1;
