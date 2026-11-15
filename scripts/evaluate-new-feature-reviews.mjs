import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {OpenAIClient} from '../src/openai.mjs';
import {ACTIONS_REVIEW_PROMPT,actionsReviewSchema} from '../src/next-actions.mjs';
import {actionChecks,guideChecks,reviewPassed} from '../src/feature-review.mjs';
import {REVIEW_PROMPT,reviewSchema} from '../src/official-guide.mjs';
import {reviewControls} from '../evals/new-feature-review-controls.mjs';
const out=resolve(process.argv[2]||'.artifacts/new-feature-eval/review-controls.json');
if(existsSync(out))throw Error('Output already exists');
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY required');
mkdirSync(dirname(out),{recursive:true});
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const files=['src/next-actions.mjs','src/official-guide.mjs','src/feature-review.mjs','src/openai.mjs','evals/new-feature-review-controls.mjs','scripts/evaluate-new-feature-reviews.mjs'];
const report={startedAt:new Date().toISOString(),hashes:Object.fromEntries(files.map(f=>[f,hash(f)])),results:[]};
const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini'});
let cursor=0;
async function worker(){
  while(cursor<reviewControls.length){
    const c=reviewControls[cursor++],start=performance.now();let result;
    try{const response=await client.structured({name:'replytrack_quality_review_control',schema:c.kind==='actions'?actionsReviewSchema:reviewSchema,instructions:c.kind==='actions'?ACTIONS_REVIEW_PROMPT:REVIEW_PROMPT,data:c.data,reasoningEffort:'medium',maxOutputTokens:3000});result={...c,response,pass:reviewPassed(response.data,c.kind==='actions'?actionChecks:guideChecks)===c.expected};}
    catch(error){result={...c,pass:false,error:{code:error.code,message:error.message}};}
    result.ms=Math.round(performance.now()-start);report.results.push(result);
    writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(`${result.id} ${result.pass?'PASS':'FAIL'} ${result.response?.data?.feedback||result.error?.code||''}`);
  }
}
await Promise.all([worker(),worker()]);report.finishedAt=new Date().toISOString();report.summary={cases:report.results.length,passed:report.results.filter(r=>r.pass).length,failed:report.results.filter(r=>!r.pass).map(r=>r.id)};writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));process.exitCode=report.summary.failed.length?1:0;
