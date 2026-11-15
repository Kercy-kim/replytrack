// Paid, counterbalanced comparison against an immutable local main worktree.
// Measures analysis operations only; browser registration timings are separate.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { registrationCases } from '../evals/registration-latency-cases.mjs';
import { grade } from '../evals/grade.mjs';
import { gradeReasons } from '../evals/reason-quality.mjs';
assert(process.argv.includes('--run'));
const option=(key,fallback)=>process.argv.find(a=>a.startsWith(key+'='))?.slice(key.length+1)||fallback;
const baseline=resolve(option('--baseline','.artifacts/registration-baseline-e085033'));
const out=option('--out','evals/results/registration-latency/paired.json');assert(!existsSync(out));
const repeats=Number(option('--repeats','2'));assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=3);
const fixtures=registrationCases;
const modules={};
for(const [variant,dir] of [['before',baseline],['after',resolve('.')]]){
  const load=p=>import(pathToFileURL(resolve(dir,p)).href);
  modules[variant]={...(await load('src/service.mjs')),...(await load('src/store.mjs')),...(await load('src/openai.mjs'))};
}
const hashes=dir=>Object.fromEntries(['src/service.mjs','src/schema.mjs','src/prompts.mjs','src/email-reply.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(dir,p))).digest('hex')]));
const report={at:new Date().toISOString(),mode:'Live API, analysis-only, 2 workers, alternating variant order',model:'gpt-5-mini-2025-08-07',baselineCommit:'e0850338787af69cea001b6222bbf8eaba72d03a',repeats,fixtures,fixtureHash:createHash('sha256').update(JSON.stringify(fixtures)).digest('hex'),hashes:{before:hashes(baseline),after:hashes('.')},results:[]};
mkdirSync(dirname(out),{recursive:true});const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
const jobs=Array.from({length:repeats},(_,repeat)=>fixtures.map((fixture,index)=>({fixture,repeat:repeat+1,variants:(repeat+index)%2?['after','before']:['before','after']}))).flat();let cursor=0;
async function worker(){while(cursor<jobs.length){const job=jobs[cursor++];for(const variant of job.variants){
  const f=job.fixture,{CaseStore,ReplyTrack,OpenAIClient}=modules[variant],store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
  const entry={id:f.id,repeat:job.repeat,variant,calls:[],stages:[]};report.results.push(entry);
  const service=new ReplyTrack(store,{async structured(args){const at=performance.now();try{const result=await client.structured(args);entry.calls.push({name:args.name,effort:args.reasoningEffort,ms:Math.round(performance.now()-at),...result});save();return result;}catch(e){entry.calls.push({name:args.name,error:e.code,ms:Math.round(performance.now()-at),transport:e.transport});throw e;}}});
  const analyze=async(c,phase,expected,previous)=>{const at=performance.now();const saved=await service.analyze(c.id,c.version);entry.stages.push({phase,ms:Math.round(performance.now()-at),record:saved,grade:grade(saved,expected,previous),reasonGrade:gradeReasons(saved,f.id)});save();return saved;};
  try{let c=service.create({title:f.title,company:'Synthetic Support',channel:f.channel||'chat',messages:f.messages});c=await analyze(c,'initial',f.expected);
    if(f.next){const previous=structuredClone(c);for(const m of f.next)c=service.append(c.id,{...m,version:c.version});c=await analyze(c,'reply',f.after,previous);}
    entry.passed=entry.stages.every(s=>s.grade.pass&&s.reasonGrade.pass);
  }catch(e){entry.error={code:e.code,message:e.message};entry.passed=false;}finally{store.close();save();console.log(`${variant} ${f.id} #${job.repeat}: ${entry.passed?'PASS':'FAIL'} ${entry.stages.map(s=>s.phase+'='+s.ms+'ms').join(' ')}`);}
}}}
await Promise.all([worker(),worker()]);report.complete=report.results.length===fixtures.length*repeats*2;report.passed=report.complete&&report.results.every(r=>r.passed);save();if(!report.passed)process.exitCode=1;
