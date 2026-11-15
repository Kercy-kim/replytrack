import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { OfficialContext, officialKey } from '../src/official-context.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run'));process.loadEnvFile('.env');
const path=process.env.OFFICIAL_CONTEXT_REPORT||'evals/results/email-reply/official-context.json';assert(!existsSync(path));
const report={at:new Date().toISOString(),cases:[],hashes:Object.fromEntries(['src/official-context.mjs','scripts/evaluate-official-context.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
const save=()=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2));};
const cases=[
  ['Google','Google 계정 비밀번호를 잊어 로그인할 수 없습니다. 공식 복구 절차를 어디에서 시작하나요?'],
  ['Microsoft','개인 Microsoft 계정 비밀번호를 잊었습니다. 계정 복구 양식에 어떤 정보를 준비해야 하나요?'],
  ['Apple','Apple 계정 복구를 시작해 기다리고 있습니다. 고객센터에서 복구 대기 시간을 줄여줄 수 있나요?'],
  ['SSG','SSG에서 신용카드로 결제한 일반 상품을 결제 다음 날 전체 취소했고 승인 완료입니다. 카드 환불 반영은 언제인지 궁금합니다.'],
  ['Unknown Support','계정 복구와 환불 기준을 알려주세요.'],
];
for(const [company,text] of cases){const entry={company,calls:[],sources:[]};report.cases.push(entry);const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:'gpt-5-mini-2025-08-07'});
  const context=new OfficialContext({ai:{configured:true,async structured(args){const start=Date.now();const r=await client.structured(args);entry.calls.push({name:args.name,ms:Date.now()-start,data:r.data,usage:r.usage});save();return r;}}});
  const fetchSources=context.sources.bind(context);context.sources=async(...args)=>{const sources=await fetchSources(...args);entry.sources=sources.map(({body,...s})=>({...s,bodyLength:body.length,bodyHash:createHash('sha256').update(body).digest('hex')}));return sources;};
  const c={id:company,title:'공식 기준 확인',company,mode:'live',analysis:{},analyzedMessageCount:1,messages:[{id:'m1',role:'customer',text}]};
  try{const at=Date.now();context.start(c);await context.entries.get(officialKey(c))?.done;entry.result=context.start(c);entry.ms=Date.now()-at;
    assert.equal(entry.result.state,company==='Unknown Support'?'omitted':'ready');entry.passed=true;
  }catch(e){entry.passed=false;entry.error=e.message;process.exitCode=1;}finally{context.close();save();console.log(company,entry.passed?'PASS':entry.error);}
}report.passed=report.cases.every(c=>c.passed);save();
