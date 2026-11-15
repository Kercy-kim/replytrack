// Paid paired benchmark: live correction updates and controlled live semantic repairs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cases } from '../evals/support-cases.mjs';
import { unseenCases } from '../evals/unseen-cases.mjs';
import { registrationCases } from '../evals/registration-latency-cases.mjs';
import { grade } from '../evals/grade.mjs';
import { gradeReasons } from '../evals/reason-quality.mjs';
assert(process.argv.includes('--run'));
const option=(name,fallback)=>process.argv.find(s=>s.startsWith(name+'='))?.slice(name.length+1)||fallback;
const out=option('--out','evals/results/review-latency/paired.json');assert(!existsSync(out));
const repeats=Number(option('--repeats','2'));assert([1,2,3].includes(repeats));
const baseline=resolve('.artifacts/review-baseline-ea822f6');
const read=p=>JSON.parse(readFileSync(`evals/results/registration-latency/${p}.json`));
const full=read('full48'),oldPair=read('paired-final'),scope=read('paired-guarded'),browser=read('browser-after');
const fixtures=[];
for(const id of ['S06','R03','NS05','NU06']){
  const source=full.results.find(r=>r.id===id),gold=[...cases,...unseenCases].find(c=>c.id===id);
  fixtures.push({id,kind:'live-update',seed:{...structuredClone(source.stages[0].record),messages:structuredClone(source.stages[1].record.messages)},expected:gold.after,previous:source.stages[0].record});
}
const clear=c=>({...structuredClone(c),questions:[],promises:[],analysis:null,analyzedMessageCount:0});
const future=oldPair.results.find(r=>r.variant==='after'&&r.id==='R03'&&r.repeat===1);
fixtures.push({id:'REPAIR-DATE',kind:'replayed-first/live-repair',seed:clear(future.stages[0].record),first:future.calls[0].data,expected:cases.find(c=>c.id==='R03').expected});
const docs=scope.results.find(r=>r.variant==='after'&&r.id==='WEB-EMAIL'&&r.repeat===1);
fixtures.push({id:'REPAIR-DOCS',kind:'replayed-first/live-repair',seed:clear(docs.stages[0].record),first:docs.calls[0].data,expected:registrationCases.find(c=>c.id==='WEB-EMAIL').expected});
const email=browser.cases.find(c=>c.name==='email');
fixtures.push({id:'REPAIR-DURATION',kind:'replayed-first/live-repair',seed:{...structuredClone(email.initial),messages:structuredClone(email.updated.messages)},first:email.updated,expected:registrationCases.find(c=>c.id==='WEB-EMAIL').after,previous:email.initial});
const modules={};
for(const [variant,dir] of [['before',baseline],['after',resolve('.')]]){
  const load=p=>import(pathToFileURL(resolve(dir,p)).href);
  modules[variant]={...(await load('src/service.mjs')),...(await load('src/store.mjs')),...(await load('src/openai.mjs'))};
}
const hashes=dir=>Object.fromEntries(['src/service.mjs','src/prompts.mjs','src/schema.mjs','src/email.mjs','src/email-reply.mjs','src/analysis-focus.mjs'].filter(p=>existsSync(resolve(dir,p))).map(p=>[p,createHash('sha256').update(readFileSync(resolve(dir,p))).digest('hex')]));
const report={at:new Date().toISOString(),model:'gpt-5-mini-2025-08-07',baselineCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:baseline,encoding:'utf8'}).trim(),repeats,mode:'2 workers, counterbalanced variant order; correction time is complete update; repair time excludes a replayed initial output and measures live repair plus validation',hashes:{before:hashes(baseline),after:hashes('.')},fixtures,results:[]};
mkdirSync(dirname(out),{recursive:true});const save=()=>writeFileSync(out,JSON.stringify(report,null,2));save();
const jobs=Array.from({length:repeats},(_,repeat)=>fixtures.map((f,index)=>({f,repeat:repeat+1,variants:(index+repeat)%2?['after','before']:['before','after']}))).flat();let cursor=0;
async function worker(){while(cursor<jobs.length){const {f,repeat,variants}=jobs[cursor++];for(const variant of variants){
  const {CaseStore,ReplyTrack,OpenAIClient}=modules[variant],store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
  const entry={id:f.id,kind:f.kind,variant,repeat,calls:[]};report.results.push(entry);
  const service=new ReplyTrack(store,{async structured(args){
    if(f.first&&!entry.calls.length){entry.calls.push({simulated:true,name:args.name});return {data:structuredClone(f.first),model:'replayed-observed-output'};}
    const at=performance.now();try{const result=await client.structured(args);entry.calls.push({name:args.name,effort:args.reasoningEffort,ms:Math.round(performance.now()-at),...result});save();return result;}
    catch(error){entry.calls.push({name:args.name,effort:args.reasoningEffort,ms:Math.round(performance.now()-at),error:{code:error.code,message:error.message},transport:error.transport});save();throw error;}
  }});
  const at=performance.now();
  try{const c=store.create(structuredClone(f.seed));entry.record=await service.analyze(c.id,c.version);entry.grade=grade(entry.record,f.expected,f.previous);entry.reasonGrade=gradeReasons(entry.record,f.id);entry.passed=entry.grade.pass&&entry.reasonGrade.pass;}
  catch(e){entry.error={code:e.code,message:e.message};entry.passed=false;}finally{entry.ms=Math.round(performance.now()-at);store.close();save();console.log(`${variant} ${f.id} #${repeat}: ${entry.passed?'PASS':'FAIL'} ${entry.ms}ms`);}
}}}
await Promise.all([worker(),worker()]);report.complete=true;report.candidatePassed=report.results.filter(r=>r.variant==='after').every(r=>r.passed);save();if(!report.candidatePassed)process.exitCode=1;
