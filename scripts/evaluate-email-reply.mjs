import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emailReplyCases } from '../evals/email-reply-cases.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { emailReplyPlan } from '../src/email-reply.mjs';
assert(process.argv.includes('--run')); process.loadEnvFile('.env');
const output = process.env.EMAIL_REPLY_REPORT || 'evals/results/email-reply/final.json'; assert(!existsSync(output));
const report = { at: new Date().toISOString(), scope: '20 synthetic saved-question/new-agent-reply cases', hashes: Object.fromEntries(['src/service.mjs','src/email-reply.mjs','src/email.mjs','src/analysis-focus.mjs','src/prompts.mjs','evals/email-reply-cases.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')])), cases: [] };
const save=()=>{mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2));};
const queue=[...emailReplyCases];
async function worker(){while(queue.length){
  const [id,question,reply,status,promised,reported]=queue.shift(); const entry={id,calls:[]};report.cases.push(entry);
  const store=new CaseStore(':memory:'); const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:'gpt-5-mini-2025-08-07'});
  const service=new ReplyTrack(store,{configured:true,async structured(args){const at=Date.now();const r=await client.structured(args);entry.calls.push({name:args.name,effort:args.reasoningEffort,ms:Date.now()-at,usage:r.usage});save();return r;}});
  try{
    let c=service.create({title:id,company:'Synthetic Support',channel:'email',messages:[{role:'customer',text:question},{role:'agent',text:'Thank you for contacting support.'}]});
    c.questions=[{id:randomUUID(),title:'확인할 질문',source:{messageId:c.messages[0].id,quote:question},status:'unanswered',aiStatus:'unanswered',reason:'관련 안내 없음',evidence:[],followUp:question}];
    c.analysis={model:'synthetic-seed',at:new Date().toISOString()};c.analyzedMessageCount=2;c=store.save(c,c.version);
    const before=structuredClone(c);c=service.appendEmail(c.id,{version:c.version,messages:[{role:'agent',text:reply}]});entry.effort=emailReplyPlan(c)?.effort;
    const at=Date.now();c=await service.analyze(c.id,c.version);entry.ms=Date.now()-at;entry.result=c;
    assert.equal(c.questions.length,1);assert.equal(c.questions[0].status,status);assert.equal(c.questions[0].id,before.questions[0].id);assert.deepEqual(c.questions[0].source,before.questions[0].source);
    assert.equal(c.promises.filter(p=>p.state==='promised').length,promised);assert.equal(c.promises.filter(p=>p.state==='reported').length,reported);assert(c.promises.every(p=>!p.confirmedAt));assert.deepEqual(c.warnings,[]);
    entry.passed=true;
  }catch(e){entry.passed=false;entry.error=e.message;process.exitCode=1;}finally{store.close();save();console.log(id,entry.passed?'PASS':entry.error);}
}}
await Promise.all([worker(),worker(),worker()]);report.passed=report.cases.length===20&&report.cases.every(c=>c.passed);save();
