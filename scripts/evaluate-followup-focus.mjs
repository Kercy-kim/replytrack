import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { followupFocusCases, gradeFollowup } from '../evals/followup-focus-cases.mjs';
assert(process.argv.includes('--run'));
const option = (name, fallback) => process.argv.find(s => s.startsWith(name+'='))?.slice(name.length+1) || fallback;
const out = option('--out','evals/results/followup-focus/generated.json'); assert(!existsSync(out));
const variant = option('--variant','after'), probes = process.argv.includes('--probes');
assert(['before','after'].includes(variant));
const root = variant === 'before' ? '.artifacts/followup-baseline-b8942ce' : '.';
const load = p => import(pathToFileURL(resolve(root,p)));
const { ReplyTrack, draftSourceContext, draftQuestionContext } = await load('src/service.mjs');
const { CaseStore } = await load('src/store.mjs');
const { OpenAIClient } = await load('src/openai.mjs');
const { DRAFT_REVIEW_PROMPT } = await load('src/prompts.mjs');
const { draftLanguagePrompt } = await load('src/email.mjs');
const { draftReviewSchema } = await load('src/schema.mjs');
const { draftChecks, reviewPassed } = await load('src/feature-review.mjs');
const fixtures = [...followupFocusCases];
const saved = JSON.parse(readFileSync('evals/results/review-latency/browser-verified.json')).cases.find(c => c.name === 'refund').generated;
fixtures.unshift({ ...followupFocusCases[0], id:'OBSERVED', title:'실제 웹에서 넓어진 제목과 부연이 남았던 기록', seed:saved });
if (!probes) {
  const full = JSON.parse(readFileSync('evals/results/review-latency/full48.json'));
  const controls = {
    S02:{required:['도착|배송.*언제','배송비'],forbidden:['운송장','1234567890']},
    S04:{required:['배송비'],forbidden:['제주도입니다','배송지[^?]*알려']},
    R02:{required:['환불'],forbidden:['차감','공제','산출','반품비[^?]*얼마']},
    U02:{required:['해지'],forbidden:['방법','절차','버튼']},
    NS01:{required:['접시','운송장'],forbidden:['머그컵','8800123456']},
    NR02:{required:['검수','통과|승인'],forbidden:['도착[^?]*(?:언제|여부|했)']},
    NU03:{required:['기본','예약|변경','다음'],forbidden:['방법','절차','선택만']},
  };
  for (const [id,gold] of Object.entries(controls)) fixtures.push({id,...gold,seed:full.results.find(r=>r.id===id).stages.at(-1).record});
}
const only = option('--only','').split(',').filter(Boolean);
const selected = fixtures.filter(f=>!only.length||only.includes(f.id)); assert(selected.length);
const report = { at:new Date().toISOString(), variant, probes, model:'gpt-5-mini-2025-08-07', scope:probes?'Live production reviewer on frozen good/bad drafts; not a generation accuracy measure.':'Seeded question states; live production draft generation, validation, repair and review. Analysis is not rerun.',
  hashes:Object.fromEntries(['src/service.mjs','src/prompts.mjs','src/feature-review.mjs','src/schema.mjs','src/email.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')])),
  fixturesHash:createHash('sha256').update(readFileSync('evals/followup-focus-cases.mjs')).digest('hex'),results:[] };
mkdirSync(dirname(out),{recursive:true});const save=()=>writeFileSync(out,JSON.stringify(report,null,2));save();
let cursor=0;
async function worker(){while(cursor<selected.length){const f=selected[cursor++],store=new CaseStore(':memory:'),entry={id:f.id,calls:[]};report.results.push(entry);
  const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
  const ai={async structured(args){const at=Date.now();try{const r=await client.structured(args);entry.calls.push({name:args.name,effort:args.reasoningEffort,ms:Date.now()-at,...r});save();return r;}catch(e){entry.calls.push({name:args.name,ms:Date.now()-at,error:e.code});throw e;}}};
  const svc=new ReplyTrack(store,ai);
  try{
    let c;
    if(f.seed)c=store.create(structuredClone(f.seed));
    else{
      c=svc.create({title:f.title,channel:f.language==='en'?'email':'chat',messages:f.messages.map((text,i)=>({role:i?'agent':'customer',text}))});
      c.questions=f.questions.map(q=>({id:randomUUID(),title:q.title,source:{messageId:c.messages[0].id,quote:q.quote},status:q.status,aiStatus:q.status,reason:'평가용 상태',evidence:c.messages.slice(1).map(m=>({messageId:m.id,quote:m.text})),followUp:''}));
      c.analysis={model:'seeded-states'};c.analyzedMessageCount=c.messages.length;c=store.save(c,c.version);
    }
    entry.input=c;
    const questions=c.questions.filter(q=>q.status!=='answered'),language=f.language||'ko';
    if(probes){entry.probes=[];for(const [label,body,expected]of[['good',f.good,true],['bad',f.bad,false],...(f.otherBad?[['alternative',f.otherBad,false]]:[])]){
      const r=await ai.structured({name:'replytrack_draft_review',schema:draftReviewSchema,instructions:DRAFT_REVIEW_PROMPT+draftLanguagePrompt(language),reasoningEffort:'medium',data:{kind:'followup',...draftSourceContext(c,'followup'),questions:draftQuestionContext(questions),draft:{body,sourceMessageIds:c.messages.map(m=>m.id)}}});
      const approved=reviewPassed(r.data,draftChecks);entry.probes.push({label,body,expected,approved,passed:approved===expected});
    }entry.passed=entry.probes.every(p=>p.passed);}
    else{const at=Date.now(),result=await svc.draft(c.id,{version:c.version,kind:'followup',language,questionIds:questions.map(q=>q.id)});entry.ms=Date.now()-at;entry.draft=result.drafts.followup;entry.grade=gradeFollowup(entry.draft.body,f);entry.passed=entry.grade.passed;}
  }catch(e){entry.error={code:e.code,message:e.message};entry.passed=false;}finally{store.close();save();console.log(f.id,entry.passed?'PASS':'FAIL');}
}}
await Promise.all([worker(),worker()]);report.complete=report.results.length===selected.length;report.passed=report.complete&&report.results.every(r=>r.passed);save();if(!report.passed)process.exitCode=1;
