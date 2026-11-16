// Paid synthetic contrast checks for duration vs procedure vs no related answer.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ReplyTrack} from '../src/service.mjs';
import {CaseStore} from '../src/store.mjs';
import {OpenAIClient} from '../src/openai.mjs';
import {emailCases} from '../evals/email-cases.mjs';
assert(process.argv.includes('--run'));
const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);assert(out&&!existsSync(out));
let fixtures=[
  ['procedure','How long will the review take?','After we verify your receipt, we will review your recovery request.',['partial']],
  ['unknown','How long will the review take?','We do not know how long your review will take.',['review']],
  ['greeting','How long will the review take?','Hello. Thank you for contacting support.',['unanswered']],
  ['duration','How long will the review take?','The review usually takes 3 business days.',['answered']],
  ['future-answer','How long will the review take?','We will check the expected review duration and email you tomorrow.',['waiting']],
  ['documents-only','What documents should I send? How long will the review take?','Please send your purchase receipt.',['answered','unanswered']],
];
const replay=process.argv.includes('--replay-only');
if(replay){const f=emailCases[0];fixtures=[['captured-failure',f.customer,f.agent,['answered','partial']]];}
const report={at:new Date().toISOString(),scope:'Question status and relevant evidence contrast checks; not a full promise-quality benchmark.',hashes:Object.fromEntries(['src/service.mjs','src/email.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])),results:[]};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));let cursor=0;
async function worker(){while(cursor<fixtures.length){const [id,customer,agent,expected]=fixtures[cursor++],row={id,expected,calls:[]};report.results.push(row);
  const store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:'gpt-5-mini-2025-08-07'});
  let first=true;
  try{const svc=new ReplyTrack(store,{async structured(args){
    if(replay&&first){
      first=false;row.injectedSource='evals/results/presentation/recording-2026-11-16-readiness.json';
      const bad=JSON.parse(readFileSync(row.injectedSource)).calls.find(c=>c.name==='replytrack_analysis').data;
      const data=JSON.parse(JSON.stringify(bad).replaceAll(bad.questions[0].source.messageId,args.data.messages[0].id).replaceAll(bad.promises[0].evidence.messageId,args.data.messages[1].id));
      return {model:'captured-first-failure-no-API-call',data};
    }
    const start=Date.now(),r=await client.structured(args);row.calls.push({name:args.name,ms:Date.now()-start,request:args.data,...r});save();return r;
  }});
    const c=svc.create({channel:'email',title:id,messages:[{role:'customer',text:customer},{role:'agent',text:agent}]});row.record=await svc.analyze(c.id,c.version);
    assert.deepEqual(row.record.questions.map(q=>q.status),expected);
    for(const q of row.record.questions){assert.equal(q.evidence.length===0,q.status==='unanswered');for(const e of q.evidence)assert(row.record.messages.some(m=>m.id===e.messageId&&m.role==='agent'&&m.text.includes(e.quote)));}
    assert(row.record.promises.every(p=>!p.confirmedAt));row.passed=true;
  }catch(e){row.passed=false;row.error=e.message;}finally{store.close();save();console.log(id,row.passed?'PASS':'FAIL');}
}}
await Promise.all([worker(),worker()]);report.passed=report.results.every(r=>r.passed);save();if(!report.passed)process.exitCode=1;
