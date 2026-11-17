import test from 'node:test';
import assert from 'node:assert/strict';
import {officialSearchSpec,publicHttpsUrl,publicIPv4,fetchPublicArticle,searchOfficialSources} from '../src/official-search.mjs';
import {OfficialContext,officialKey,articleText,boundOfficialQuotes,officialItemsValid} from '../src/official-context.mjs';
import {OpenAIClient} from '../src/openai.mjs';
const record=()=>({id:'c1',company:'Netflix',title:'구독 취소',mode:'live',analysis:{},analyzedMessageCount:1,messages:[{id:'m1',role:'customer',text:'취소하면 남은 결제 기간에 시청할 수 있나요? me@private.example 주문번호 PRIVATE-8123'}]});
const url='https://help.netflix.com/ko/node/407';
const quote='구독을 취소해도 결제 기간이 종료될 때까지 이용할 수 있습니다.';
const body=(quote+' 다른 조건과 예외는 고객지원에서 확인할 수 있습니다. ').repeat(6);
const candidate={url,title:'Netflix 해지',publisherEvidence:'Netflix 공식 홈페이지에서 연결된 고객지원 문서'};
const source={...candidate,id:'s1',body,publisherText:'Netflix Help Center',discovered:true,checkedAt:new Date().toISOString()};
const good={applicable:true,answersQuestion:true,grounded:true,conditionsPreserved:true,noConflict:true,officialSource:true,feedback:''};
const intent={data:{searchable:true,topics:['구독 취소 후 이용 기간']}};
test('long exact source quotations are shortened without inventing or exceeding quotation limits',()=>{
 const long=Array.from({length:35},(_,i)=>'단어'+i).join(' '), sources=[{id:'s',body:long}];
 const items=boundOfficialQuotes([{sourceId:'s',text:'한국어 안내',quote:long}],sources);
 assert(officialItemsValid(items,sources));assert(long.includes(items[0].quote));assert(items[0].quote.length<=160);assert(items[0].quote.split(/\s+/).length<=25);
 const invented=[{sourceId:'s',text:'안내',quote:'존재하지 않는 인용'}];assert.deepEqual(boundOfficialQuotes(invented,sources),invented);assert(!officialItemsValid(invented,sources));
});
test('search uses a service name and fixed public topics, never private inquiry strings',()=>{
 const spec=officialSearchSpec(record());assert.equal(spec.company,'Netflix');assert.equal(spec.topic,'구독 해지 취소 정책 · 결제 청구 도움말');
 assert(!JSON.stringify(spec).includes('PRIVATE'));assert(!JSON.stringify(spec).includes('@'));
 for(const company of ['Unknown Support','https://evil.test','a@example.com','127.0.0.1','가상 고객센터',''])assert.equal(officialSearchSpec({...record(),company}),null);
});
test('source URL and resolved network address validation rejects internal and special targets',async()=>{
 for(const value of ['http://help.netflix.com','https://127.0.0.1','https://2130706433','https://[::1]','https://[::ffff:127.0.0.1]','https://user:pass@example.com','https://example.com:444','https://localhost','https://metadata.internal'])assert.equal(publicHttpsUrl(value),null,value);
 for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.1.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','::1'])assert.equal(publicIPv4(ip),false,ip);
 assert(publicIPv4('8.8.8.8'));
 await assert.rejects(fetchPublicArticle(url,{lookupImpl:async()=>[{address:'127.0.0.1',family:4}]}),/NON_PUBLIC_SOURCE/);
 await assert.rejects(fetchPublicArticle(url,{lookupImpl:async()=>[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}]}),/NON_PUBLIC_SOURCE/);
 const controller=new AbortController();controller.abort();await assert.rejects(fetchPublicArticle(url,{signal:controller.signal}));
 assert.equal(publicHttpsUrl(url+'?utm_source=chatgpt.com#part'),url);
});
test('model-invented URLs and absent search calls never become fetched official sources',async()=>{
 for(const result of [{searched:false,sourceUrls:[url],data:{sources:[candidate]}},{searched:true,sourceUrls:[],data:{sources:[candidate]}}]){
  let reads=0;const sources=await searchOfficialSources(record(),{ai:{structured:async args=>args.name.endsWith('_intent')?intent:result},readPage:async()=>{reads++;return '';},parseArticle:articleText});assert.deepEqual(sources,[]);assert.equal(reads,0);
 }
});
test('retrieved and fetched source text, not search summaries, is retained for exact grounding',async()=>{
 const calls=[];const sources=await searchOfficialSources(record(),{ai:{async structured(args){calls.push(args);return args.name.endsWith('_intent')?intent:{searched:true,sourceUrls:[url+'?utm_source=chatgpt.com'],data:{sources:[candidate,candidate]}};}},readPage:async()=>`<html><title>Netflix Help Center</title><body><main>${body}</main><footer>Netflix</footer></body></html>`,parseArticle:articleText});
 assert.equal(sources.length,1);assert.equal(sources[0].body,body.trim());assert.match(sources[0].publisherText,/Netflix/);assert(calls[1].webSearch);assert(!JSON.stringify(calls[1].data).includes('PRIVATE'));assert.equal(calls[1].data.topic,'구독 취소 후 이용 기간');
});
test('nonpublic questions and invented intent strings never reach the external search tool',async()=>{
 for(const data of [{searchable:false,topics:[]},{searchable:true,topics:['주문 PRIVATE-8123 언제 오나요']}]){
  let calls=0;assert.deepEqual(await searchOfficialSources(record(),{ai:{async structured(args){calls++;assert.equal(args.webSearch,undefined);assert(args.data.allowedTopics.includes('구독 취소 후 이용 기간'));return {data};}},parseArticle:articleText}),[]);assert.equal(calls,1);
 }
});
test('discovered guidance requires independent first-party verification and all applicability checks',async()=>{
 for(const failure of [null,'officialSource','applicable','answersQuestion','noConflict']){
  let calls=0;const c=record();const before=structuredClone(c);
  const ai={configured:true,supportsWebSearch:true,async structured(args){calls++;if(args.name.endsWith('_review')){assert(args.instructions.includes('officialSource:'));assert(args.schema.properties.officialSource);return {data:{...good,...(failure?{[failure]:false}:{})}};}return {data:{items:[{sourceId:'s1',text:'결제 기간까지 이용할 수 있습니다.',quote}]}};}};
  const context=new OfficialContext({ai,searchSources:async()=>[source]});assert(context.shouldStart(c));assert.equal(context.start(c).state,'loading');await context.entries.get(officialKey(c)).done;
  assert.equal(context.start(c).state,failure?'omitted':'ready');assert.equal(calls,2);assert.deepEqual(c,before);context.start(c);assert.equal(calls,2);context.close();
 }
});
test('search failures, invented quotes and cancellation do not change saved inquiries or publish advice',async()=>{
 const c=record();const ai={configured:true,supportsWebSearch:true,structured:async()=>({data:{items:[{sourceId:'s1',text:'잘못된 안내',quote:'출처에 없는 인용입니다.'}]}})};
 for(const searchSources of [async()=>{throw Error('search unavailable');},async()=>[source]]){
  const context=new OfficialContext({ai,searchSources});context.start(c);await context.entries.get(officialKey(c)).done;assert.equal(context.start(c).state,'omitted');context.close();
 }
 let resolve;const context=new OfficialContext({ai,searchSources:()=>new Promise(r=>resolve=r)});context.start(c);context.close();resolve([source]);await context.entries.get(officialKey(c)).done;assert.equal(context.start(c).state,'omitted');
});
test('OpenAI search requests require tool execution and retain provider source metadata without hedging',async()=>{
 let count=0;const client=new OpenAIClient({apiKey:'test-key',fetchImpl:async(_url,options)=>{
  count++;const payload=JSON.parse(options.body);assert.equal(payload.store,false);assert.equal(payload.tools[0].type,'web_search');assert.equal(payload.max_tool_calls,3);assert(payload.include.includes('web_search_call.action.sources'));
  return new Response(JSON.stringify({status:'completed',model:'gpt-5-mini',output:[{type:'web_search_call',status:'completed',action:{sources:[{url}]}},{type:'message',content:[{type:'output_text',text:'{"sources":[]}',annotations:[{type:'url_citation',url}]}]}]}),{headers:{'Content-Type':'application/json'}});
 }});
 const result=await client.structured({name:'replytrack_official_search',schema:{type:'object',properties:{sources:{type:'array',items:{type:'string'}}},required:['sources'],additionalProperties:false},instructions:'Search official sources',data:{company:'Netflix',topic:'cancel'},webSearch:true});
 assert.equal(result.searched,true);assert.deepEqual(result.sourceUrls,[url]);assert.equal(count,1);
});
