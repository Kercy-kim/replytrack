import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {OpenAIClient} from '../src/openai.mjs';
import {OfficialContext,officialKey} from '../src/official-context.mjs';
assert(process.argv.includes('--run'));process.loadEnvFile('.env');
const dir=process.env.OFFICIAL_SEARCH_REPORT_DIR||'.artifacts/official-search';await mkdir(dir,{recursive:true});
const cases=[
  {company:'Netflix',text:'넷플릭스를 해지하면 결제한 기간이 끝날 때까지 계속 시청할 수 있나요?',expected:'ready',host:'netflix.com'},
  {company:'Adobe',text:'한국에서 개인용 Adobe 연간 플랜을 월별 결제 중입니다. 최초 주문 후 14일이 지나 취소하면 수수료가 있나요?',expected:'ready',host:'adobe.com'},
  {company:'Spotify',text:'Spotify Premium을 해지하면 저장한 플레이리스트와 음악 목록이 없어지나요?',expected:'ready',host:'spotify.com'},
  {company:'Netflix',text:'제 계정의 어제 취소한 결제금이 오늘 오후 3시까지 입금되는지 확답해 주세요.',expected:'omitted'},
  {company:'구름토끼픽셀상점XYZ',text:'구독을 해지하면 남은 기간 요금을 돌려받나요?',expected:'omitted'},
];
const report={at:new Date().toISOString(),cases:[]};
const save=()=>writeFile(dir+'/result.json',JSON.stringify(report,null,2));
for(const input of cases){
 const entry={...input,calls:[],sources:[]};report.cases.push(entry);
 const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini'});
 const ai={configured:true,supportsWebSearch:true,async structured(args){const at=Date.now();const r=await client.structured(args);entry.calls.push({name:args.name,ms:Date.now()-at,data:r.data,sourceUrls:r.sourceUrls,searched:r.searched,usage:r.usage});await save();return r;}};
 const context=new OfficialContext({ai});const get=context.sources.bind(context);
 context.sources=async(...args)=>{const sources=await get(...args);entry.sources=sources.map(({body,publisherText,...s})=>({...s,bodyLength:body.length,publisherText}));return sources;};
 const c={id:input.company,title:'공식 기준 문의',company:input.company,mode:'live',analysis:{},analyzedMessageCount:1,messages:[{id:'m1',role:'customer',text:input.text}]};
 const start=Date.now();
 try{context.start(c);await context.entries.get(officialKey(c))?.done;entry.result=context.start(c);entry.ms=Date.now()-start;
  assert.equal(entry.result.state,input.expected);
  if(input.host)assert(entry.result.items.every(i=>new URL(i.url).hostname===input.host||new URL(i.url).hostname.endsWith('.'+input.host)));
  entry.passed=true;
 }catch(error){entry.passed=false;entry.error=error.message;}finally{context.close();await save();console.log(input.company,entry.passed?'PASS':entry.error,entry.ms+'ms');}
}
report.passed=report.cases.every(c=>c.passed);await save();if(!report.passed)process.exitCode=1;
