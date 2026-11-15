// Local functional/browser regression. Real OCR and Chrome, synthetic AI, no paid calls.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const dir='.artifacts/completeness';await mkdir(dir,{recursive:true});
const jobs=[['unit',['--test']],['syntax',['scripts/check.mjs']],...['web-operations','email-browser','email-demo','next-actions','inquiry-workspace','ui-refinement','official-context','presentation','reading-flow'].map(name=>[name,[`scripts/check-${name}.mjs`]])];
const report={at:new Date().toISOString(),scope:'Local regression, synthetic AI. Paid live API checks are separate.',results:[]};let cursor=0;
async function worker(){while(cursor<jobs.length){const [name,args]=jobs[cursor++],start=Date.now();let output='';const code=await new Promise(resolve=>{const p=spawn(process.execPath,args,{env:process.env,windowsHide:true});p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',e=>{output+=e.message;resolve(-1);});p.once('close',resolve);});await writeFile(`${dir}/${name}.log`,output);report.results.push({name,code,ms:Date.now()-start,log:`${dir}/${name}.log`});await writeFile(`${dir}/result.json`,JSON.stringify(report,null,2));console.log(`${name}: ${code===0?'PASS':'FAIL'}`);if(code!==0)console.log(output.slice(-2500));}}
await Promise.all([worker(),worker()]);report.passed=report.results.length===jobs.length&&report.results.every(r=>r.code===0);await writeFile(`${dir}/result.json`,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
