// Actual update latency, using identical saved states and counterbalanced variants.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
assert(process.argv.includes('--run'));
const option=(k,f)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1)||f;
const out=option('--out','evals/results/email-tail/paired.json');assert(!existsSync(out));
const repeats=Number(option('--repeats','3'));assert([1,2,3].includes(repeats));
const variant=option('--variant','both');assert(['both','before','after'].includes(variant));
const recorded=JSON.parse(readFileSync('evals/results/presentation/recording-2026-11-16-final.json'));
const fixtures=[
  {id:'OBSERVED-84',reply:recorded.after.messages.at(-1).text,deadline:false},
  {id:'GENERAL-PERIOD',reply:'We received your transaction ID. The review usually takes 3 business days. Your account has not been restored yet. We will email you after the review.',deadline:false},
  {id:'EXPLICIT-DEADLINE',reply:'We received your transaction ID. We will complete the review of your recovery request within 3 business days. Your account has not been restored yet. We will email you after the review.',deadline:true},
];
const dirs={before:'.artifacts/email-tail-baseline-4aab25c',after:'.'},modules={};
const hashes=dir=>Object.fromEntries(['src/service.mjs','src/email-reply.mjs','src/analysis-focus.mjs','src/prompts.mjs','src/schema.mjs','src/openai.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(resolve(dir,p))).digest('hex')]));
for(const [name,dir]of Object.entries(dirs)){
  const load=p=>import(pathToFileURL(resolve(dir,p)));
  modules[name]={...(await load('src/service.mjs')),...(await load('src/store.mjs')),...(await load('src/openai.mjs'))};
}
const report={at:new Date().toISOString(),baseline:'4aab25c5986144231a35598175c08c591b632b71',model:'gpt-5-mini-2025-08-07',scope:'Complete new-agent-reply analysis, validation and saving; excludes transcription/explanation/actions. Frozen initial state; 2 workers; counterbalanced order. No paid evaluations run alongside the paired comparison.',hashes:{before:hashes(dirs.before),after:hashes('.')},fixtures,results:[]};
mkdirSync(dirname(out),{recursive:true});const save=()=>writeFileSync(out,JSON.stringify(report,null,2));save();
const jobs=Array.from({length:repeats},(_,repeat)=>fixtures.map((f,i)=>({f,repeat:repeat+1,variants:variant==='both'?((i+repeat)%2?['after','before']:['before','after']):[variant]}))).flat();let next=0;
async function worker(){while(next<jobs.length){const {f,repeat,variants}=jobs[next++];for(const v of variants){
  const {CaseStore,ReplyTrack,OpenAIClient}=modules[v],store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
  const e={id:f.id,variant:v,repeat,calls:[]};report.results.push(e);
  const service=new ReplyTrack(store,{async structured(args){const start=performance.now();try{const r=await client.structured(args);e.calls.push({name:args.name,effort:args.reasoningEffort,ms:Math.round(performance.now()-start),promptChars:args.instructions.length,request:args.data,...r});save();return r;}catch(error){e.calls.push({name:args.name,ms:Math.round(performance.now()-start),error:{code:error.code,message:error.message},transport:error.transport});save();throw error;}}});
  const seed=structuredClone(recorded.before);seed.messages=structuredClone(recorded.after.messages);seed.messages.at(-1).text=f.reply;e.seed=seed;
  const start=performance.now();
  try{
    const c=store.create(seed);const result=await service.analyze(c.id,c.version);e.record=result;
    assert.deepEqual(result.questions.map(q=>q.id),seed.questions.map(q=>q.id));
    assert(result.questions.every(q=>q.status==='answered'));
    assert.deepEqual(result.questions.map(q=>q.source),seed.questions.map(q=>q.source));
    assert.deepEqual(result.warnings,[]);assert(result.promises.every(p=>!p.confirmedAt));
    const old=result.promises.find(p=>p.id===seed.promises[0].id);assert(old);assert.equal(old.state,'promised');
    if(f.deadline)assert.match(old.dueText,/3 business days/);else assert.equal(old.dueText,'');
    assert.equal(result.promises.length,3);
    assert.equal(result.promises.filter(p=>p.state==='reported').length,1);
    assert(result.promises.some(p=>p.state==='reported'&&/We received your transaction ID\./.test(p.evidence.quote)));
    assert(result.promises.some(p=>p.state==='promised'&&p.evidence.quote.includes('We will email you after the review.')));
    assert(result.promises.filter(p=>p.id!==old.id).every(p=>!p.dueText));
    e.passed=true;
  }catch(error){e.passed=false;e.error={code:error.code,message:error.message};}
  finally{e.ms=Math.round(performance.now()-start);store.close();save();console.log(v,f.id,repeat,e.passed?'PASS':'FAIL',e.ms+'ms');}
}}}
await Promise.all([worker(),worker()]);report.complete=true;report.candidatePassed=report.results.filter(e=>e.variant==='after').every(e=>e.passed);save();if(!report.candidatePassed)process.exitCode=1;
