// Explicit, paid live evaluation. Never imported by node --test. No credentials in artifacts.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { OpenAIClient } from '../src/openai.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { OfficialFaq, selectOfficialSources } from '../src/official-guide.mjs';
import { newFeatureCases } from '../evals/new-feature-cases.mjs';
import { gradeActions, gradeGuide } from '../evals/new-feature-grade.mjs';

const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
const out = resolve(option('--out', '.artifacts/new-feature-eval/baseline.json'));
if(existsSync(out)) throw new Error('Use a new output filename; prior results are immutable.');
mkdirSync(dirname(out),{recursive:true});
const snapshotPath = resolve(option('--sources','.artifacts/new-feature-eval/official-sources.json'));
if(args.includes('--capture')) {
  if(existsSync(snapshotPath)) throw new Error('Source snapshot exists');
  const faq = new OfficialFaq(), captured = {at:new Date().toISOString(),sources:{}};
  for(const intent of ['cancel','return','exchange','refund']) {
    const result = await faq.search(intent);
    if(result.mode !== 'live') throw new Error(`Official capture failed: ${intent}`);
    captured.sources[intent] = result;
    console.log(`${intent}: ${result.sources.length} official bodies`);
  }
  mkdirSync(dirname(snapshotPath),{recursive:true}); writeFileSync(snapshotPath,JSON.stringify(captured,null,2)+'\n');
  process.exit(0);
}
if(!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required in the local environment.');
const snapshot = JSON.parse(readFileSync(snapshotPath,'utf8'));
const hash = contents => createHash('sha256').update(contents).digest('hex');
const files = ['src/service.mjs','src/next-actions.mjs','src/official-guide.mjs','src/feature-review.mjs','src/openai.mjs','src/ai-wire.mjs','src/privacy.mjs','src/domain.mjs','evals/new-feature-cases.mjs','evals/new-feature-grade.mjs','scripts/evaluate-new-features.mjs'];
const report = {startedAt:new Date().toISOString(),baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),model:process.env.OPENAI_MODEL||'gpt-5-mini',mode:args.includes('--live-search')?'live API + live official search':'live API + captured official sources / injected search failure',sourceHash:hash(readFileSync(snapshotPath)),hashes:Object.fromEntries(files.map(f=>[f,hash(readFileSync(f))])),results:[]};
const selected = newFeatureCases.filter(c => (!option('--only') || option('--only').split(',').includes(c.id)) && (!option('--kind') || c.kind === option('--kind')));
if(!selected.length) throw new Error('No cases selected');
const save = () => {
  report.summary={cases:report.results.length,passed:report.results.filter(r=>r.pass).length,failed:report.results.filter(r=>!r.pass).map(r=>r.id),calls:report.results.reduce((n,r)=>n+r.calls.length,0),tokens:report.results.flatMap(r=>r.calls).reduce((n,c)=>n+(c.usage?.total_tokens||0),0)};
  writeFileSync(out,JSON.stringify(report,null,2)+'\n');
};
save();
const client = new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:report.model});
// Connection is checked once; each case uses isolated storage and the real product methods.
const preflightStore = new CaseStore(':memory:');
try { const service = new ReplyTrack(preflightStore,client); await service.preflight(); report.preflight = service.config().connection; }
finally { preflightStore.close(); }
let cursor=0;
async function worker() {
  while(cursor<selected.length) {
    const c=selected[cursor++], row={id:c.id,kind:c.kind,title:c.title,stages:[],calls:[]}, start=performance.now(), store=new CaseStore(':memory:');
    const ai={configured:true,model:client.model,structured:async input=>{
      const started=performance.now();
      try {const result=await client.structured(input);row.calls.push({name:input.name,ms:Math.round(performance.now()-started),data:result.data,usage:result.usage,model:result.model});return result;}
      catch(error){row.calls.push({name:input.name,ms:Math.round(performance.now()-started),error:{code:error.code,message:error.message}});throw error;}
    }};
    const faq=c.fallback?new OfficialFaq({fetchImpl:async()=>{throw new Error('Injected search failure');}}):args.includes('--live-search')?new OfficialFaq():{search:async (intent,context,options)=>{
      const found=structuredClone(snapshot.sources[intent]);
      if(intent==='refund' && options?.includeCancellation) found.sources=selectOfficialSources([...found.sources,...structuredClone(snapshot.sources.cancel.sources)]);
      return found;
    }};
    const service=new ReplyTrack(store,ai,{faq});service.connection={state:'ready',checkedAt:new Date().toISOString()};
    try {
      if(c.kind==='actions') {
        let record=service.create({title:c.title,company:'가상 고객센터',messages:c.messages});
        row.input=structuredClone(record);
        record=await service.actions(record.id,record.version);
        row.stages.push({record:structuredClone(record),grade:gradeActions(record,c.expected)});
        if(c.followup) {
          for(const index of c.complete||[]) record=service.completeAction(record.id,record.nextActions.items[index].id,{version:record.version,completed:true});
          const previous=structuredClone(record);
          row.beforeFollowup=previous;
          for(const [role,text] of c.followup) record=service.append(record.id,{version:record.version,role,text,sentAt:'2026-11-15T10:00:00+09:00'});
          record=await service.actions(record.id,record.version);
          row.stages.push({record:structuredClone(record),grade:gradeActions(record,c.after,previous)});
        }
      } else {
        const input=structuredClone(c.input), questions=[];
        let result;
        for(let turn=0;turn<5;turn++) {
          result=await service.guide(input);
          if(result.status!=='question') break;
          questions.push(result.question.key);
          const answer=c.answersSequence?.[result.question.key];
          if(!answer) break;
          input.answers[result.question.key]=answer;
        }
        row.stages.push({result,questions,grade:gradeGuide(result,c,questions)});
      }
      row.pass=row.stages.every(s=>s.grade.pass);
    } catch(error) {row.pass=false;row.error={code:error.code||'UNKNOWN',message:error.message};}
    finally {store.close();row.ms=Math.round(performance.now()-start);report.results.push(row);save();console.log(`${row.id} ${row.pass?'PASS':'FAIL'} ${row.ms}ms ${row.error?.code||row.stages.flatMap(s=>s.grade.errors).join('; ')}`);}
  }
}
await Promise.all([worker(),worker()]);
report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify(report.summary));
process.exitCode=report.summary.failed.length?1:0;
