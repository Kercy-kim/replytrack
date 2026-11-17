import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {CaseStore} from '../src/store.mjs';
import {ReplyTrack} from '../src/service.mjs';
import {OpenAIClient} from '../src/openai.mjs';
assert(process.argv.includes('--run'));process.loadEnvFile('.env');
const dir=process.env.FIRST_INQUIRY_REPORT||'.artifacts/first-inquiry-eval';await mkdir(dir,{recursive:true});
const store=new CaseStore(':memory:'), ai=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini'}),service=new ReplyTrack(store,ai);
const report={at:new Date().toISOString(),cases:[]};let active;const original=ai.structured.bind(ai);ai.structured=async args=>{const start=Date.now();const r=await original(args);active.calls.push({name:args.name,ms:Date.now()-start,data:r.data,sources:args.data?.sources});await writeFile(dir+'/result.json',JSON.stringify(report,null,2));return r;};
const cases=[
 {company:'Google',goal:'비밀번호를 잊어서 계정에 로그인할 수 없어요. 계정을 복구하려면 어디에서 시작하고 무엇을 준비해야 하나요?',channel:'chat',language:'ko',host:'google.com'},
 {company:'Netflix',goal:'한국에서 넷플릭스를 직접 결제했습니다. 해지 후 다시 청구되어 확인을 문의하고 싶어요. 어디에 문의하면 되나요?',channel:'email',language:'en',host:'netflix.com'},
 {company:'구름토끼픽셀상점XYZ',goal:'구독 결제를 취소하고 싶어요. 어떻게 문의하면 되나요?',channel:'chat',language:'ko',empty:true},
];
const only=process.argv.find(a=>a.startsWith('--company='))?.slice(10);
for(const input of cases.filter(c=>!only||c.company===only)){const row={input,stages:[],calls:[]};active=row;report.cases.push(row);const start=Date.now();try{const c=await service.firstInquiry(input,{onStage:s=>{row.stages.push(s);console.log(input.company,s);}});row.ms=Date.now()-start;row.plan=c.firstInquiry;row.draft=c.drafts.first.body;assert.equal(c.messages.length,0);assert.equal(c.analysis,null);assert.equal(c.firstInquiry.state,'preparing');if(input.empty)assert.equal(c.firstInquiry.routes.length,0);else{assert(c.firstInquiry.routes.length);assert(c.firstInquiry.routes.every(r=>new URL(r.url).hostname.endsWith('.'+input.host)||new URL(r.url).hostname===input.host));}if(input.company==='Google')assert(!c.firstInquiry.preparations.some(p=>/전체 이름|등록된 전화번호|복구 이메일/.test(p.text)),'Password loss must not inherit username-loss requirements');row.passed=true;}catch(e){row.passed=false;row.error=e.message;}await writeFile(dir+'/result.json',JSON.stringify(report,null,2));console.log(input.company,row.passed?'PASS':row.error,row.ms);}
report.passed=report.cases.every(c=>c.passed);await writeFile(dir+'/result.json',JSON.stringify(report,null,2));store.close();if(!report.passed)process.exitCode=1;
