// Paid initial analysis only. Full registration is measured separately in Chrome.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { registrationCases } from '../evals/registration-latency-cases.mjs';
import { timingCases } from '../evals/timing-cases.mjs';
import { grade } from '../evals/grade.mjs';
import { gradeReasons } from '../evals/reason-quality.mjs';
assert(process.argv.includes('--run'));
const option = (k, fallback) => process.argv.find(a => a.startsWith(k + '='))?.slice(k.length + 1) || fallback;
const out = option('--out', 'evals/results/initial-analysis/paired.json'); assert(!existsSync(out));
const variant = option('--variant', 'both'), repeats = Number(option('--repeats', '2'));
assert(['before', 'after', 'both'].includes(variant)); assert([1,2,3].includes(repeats));
const email = structuredClone(registrationCases.find(f => f.id === 'WEB-EMAIL'));
email.id = 'EMAIL-REVIEW'; email.messages[1].text += ' After we verify the transaction ID, we will review your recovery request.';
email.expected.questions[1].status = 'partial'; email.expected.questions[1].evidence = [1];
email.expected.promises = [{ message: 1, topic: '검토|심사|복구', state: 'promised', dueAt: null, deadline: '' }];
const fixtures = [...registrationCases, email, timingCases.find(f => f.id === 'T04')].filter(f => !option('--only','') || option('--only','').split(',').includes(f.id)).map(({next,after,...f})=>f);
assert(fixtures.length);
const dirs = { before: resolve('.artifacts/initial-baseline-fc25f08'), after: resolve('.') }, modules = {};
for (const [v, dir] of Object.entries(dirs)) { const load = p => import(pathToFileURL(resolve(dir,p))); modules[v] = { ...await load('src/service.mjs'), ...await load('src/store.mjs'), ...await load('src/openai.mjs') }; }
const hashes = dir => Object.fromEntries(['src/service.mjs','src/schema.mjs','src/prompts.mjs','src/analysis-focus.mjs','src/email-reply.mjs','src/openai.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(dir,p))).digest('hex')]));
const report = { at: new Date().toISOString(), baseline: execFileSync('git',['-C',dirs.before,'rev-parse','HEAD'],{encoding:'utf8'}).trim(), model:'gpt-5-mini-2025-08-07', scope:'Initial analysis/validation/save only; 2 workers; counterbalanced variants; full sources; no simultaneous paid suites during comparison.', fixtures, hashes:{before:hashes(dirs.before),after:hashes(dirs.after)}, results:[] };
mkdirSync(dirname(out),{recursive:true}); const save=()=>writeFileSync(out,JSON.stringify(report,null,2)); save();
const jobs=Array.from({length:repeats},(_,i)=>fixtures.map((f,j)=>({f,repeat:i+1,variants:variant==='both'?((i+j)%2?['after','before']:['before','after']):[variant]}))).flat(); let next=0;
async function worker(){while(next<jobs.length){const {f,repeat,variants}=jobs[next++];for(const v of variants){
  const {CaseStore,ReplyTrack,OpenAIClient}=modules[v],store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
  const row={id:f.id,variant:v,repeat,calls:[]};report.results.push(row);
  const svc=new ReplyTrack(store,{async structured(args){const start=performance.now();try{const r=await client.structured(args);row.calls.push({name:args.name,effort:args.reasoningEffort,ms:Math.round(performance.now()-start),request:args.data,...r});save();return r;}catch(e){row.calls.push({name:args.name,ms:Math.round(performance.now()-start),error:e.code,transport:e.transport});save();throw e;}}});
  const start=performance.now();
  try{const c=svc.create({title:f.title,channel:f.channel||'chat',company:'Synthetic Support',messages:f.messages});row.record=await svc.analyze(c.id,c.version);row.grade=grade(row.record,f.expected);row.reasonGrade=gradeReasons(row.record,f.id);row.passed=row.grade.pass&&row.reasonGrade.pass;}
  catch(e){row.passed=false;row.error={code:e.code,message:e.message};}
  finally{row.ms=Math.round(performance.now()-start);store.close();save();console.log(v,f.id,repeat,row.passed?'PASS':'FAIL',row.ms);}
}}}
await Promise.all([worker(),worker()]);report.complete=true;report.candidatePassed=report.results.filter(r=>r.variant==='after').every(r=>r.passed);save();if(!report.candidatePassed)process.exitCode=1;
