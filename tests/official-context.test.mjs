import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficialContext, officialKey, officialProvider, articleText } from '../src/official-context.mjs';
import { officialPanel } from '../public/official-context.js';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
const record = () => ({ id:'case1', title:'계정 복구', company:'Google', mode:'live', analysis:{}, analyzedMessageCount:1, messages:[{id:'m1',role:'customer',text:'내 계정의 비밀번호를 잊었어요. 어떻게 복구하나요?'}] });
const source = {id:'s1',url:'https://support.google.com/accounts/answer/7682439?hl=ko',title:'계정 복구',checkedAt:'2026-11-15',body:'계정 복구 절차에 따라 계정 소유자임을 확인해야 합니다. 확인되지 않으면 접근을 허용하지 않습니다.'};
const item={sourceId:'s1',quote:'계정 복구 절차에 따라 계정 소유자임을 확인해야 합니다.',text:'계정 복구 절차에서 소유자 확인이 필요하다는 공식 안내입니다.'};
const approved={applicable:true,answersQuestion:true,grounded:true,conditionsPreserved:true,noConflict:true};
function fixture({items=[item],review=approved}={}) {
  const calls=[];const context=new OfficialContext({ai:{configured:true,async structured(args){calls.push(args);return {data:args.name.endsWith('_review')?review:{items}};}}});
  context.sources=async()=>[source];return {context,calls};
}
test('official provider identity requires an exact known company; pasted domains are never trusted',()=>{
  for(const company of ['Example Support','google.evil.test','Google or Apple','http://127.0.0.1','Google@example.test'])assert.equal(officialProvider({...record(),company}),null);
  assert.equal(officialProvider(record()).id,'google');assert.equal(officialProvider({...record(),company:'Apple Support'}).id,'apple');
  assert.equal(officialProvider({...record(),title:'배송',messages:[{text:'소포는 언제 오나요?'}]}),null);
});
test('only live first-party article content is used; scripts/navigation and incomplete markup are excluded',()=>{
  const body='This is the official article with conditions and exceptions. '.repeat(6);
  assert.equal(articleText(`<nav>ignore</nav><div role="main"><div>${body}</div><script>evil</script></div><footer>ignore</footer>`),body.trim());
  assert.throws(()=>articleText('<body>Only a search snippet</body>'));
});
test('automatic official context is cached independently and does not mutate question records',async()=>{
  const {context,calls}=fixture();const c=record(),before=structuredClone(c);
  assert.equal(context.start(c).state,'loading');context.start(c);await context.entries.get(officialKey(c)).done;
  const result=context.start(c);assert.equal(result.state,'ready');assert.equal(calls.length,2);assert.deepEqual(c,before);
  assert.equal(result.items[0].url,source.url);assert.equal(result.items[0].checkedAt,source.checkedAt);
  const next={...c,messages:[...c.messages,{id:'m2',text:'정정'}],analyzedMessageCount:2};assert.notEqual(officialKey(next),result.key);context.close();
});
test('unknown, demo and unanalyzed cases perform no source or model calls',()=>{
  const {context,calls}=fixture();for(const mutate of [c=>c.company='Unknown',c=>c.mode='demo',c=>c.analysis=null,c=>c.analyzedMessageCount=0]){const c=record();mutate(c);assert.equal(context.start(c).state,'omitted');}assert.equal(calls.length,0);
});
test('missing source, invented quotation, uncertainty or conflict suppresses the entire official card',async()=>{
  for(const config of [{items:[]},{items:[{...item,quote:'원문에 없는 정책입니다.'}]},...Object.keys(approved).map(key=>({review:{...approved,[key]:false}}))]){
    const {context}=fixture(config);const c=record();context.start(c);await context.entries.get(officialKey(c)).done;assert.equal(context.start(c).state,'omitted');context.close();
  }
});
test('SSG dated fallback and failed first-party fetching cannot become current official advice',async()=>{
  const context=new OfficialContext({ai:{configured:true},faq:{async search(){return {mode:'reviewed',sources:[source]};}}});
  assert.deepEqual(await context.sources({messages:[{text:'환불'}]},{id:'ssg'},new AbortController().signal),[]);
  const {context:failed}=fixture();failed.sources=async()=>{throw Error('source unavailable');};failed.start(record());await failed.entries.get(officialKey(record())).done;assert.equal(failed.start(record()).state,'omitted');
});

test('related but non-answering guidance is omitted without repairing it into a different answer',async()=>{
  const {context,calls}=fixture({review:{...approved,answersQuestion:false,feedback:'개인 완료일 대신 조회 방법을 안내함'}});
  context.start(record());await context.entries.get(officialKey(record())).done;
  assert.equal(context.start(record()).state,'omitted');assert.equal(calls.length,2);context.close();
});
test('a condition omission gets one bounded repair and still requires independent approval',async()=>{
  const calls=[];let reviews=0;
  const context=new OfficialContext({ai:{configured:true,async structured(args){calls.push(args);return {data:args.name.endsWith('_review')?(++reviews===1?{...approved,conditionsPreserved:false,feedback:'필수 조건을 보존하세요.'}:approved):{items:[item]}};}}});
  context.sources=async()=>[source];context.start(record());await context.entries.get(officialKey(record())).done;
  assert.equal(calls.length,4);assert.equal(calls[2].data.feedback,'필수 조건을 보존하세요.');assert.equal(context.start(record()).state,'ready');context.close();
  const failed=fixture({review:{...approved,conditionsPreserved:false,feedback:'미확인 조건'}});failed.context.start(record());await failed.context.entries.get(officialKey(record())).done;
  assert.equal(failed.calls.length,4);assert.equal(failed.context.start(record()).state,'omitted');failed.context.close();
});
test('closing server cancels optional work and prevents late official publication',async()=>{
  const {context}=fixture();let release;context.sources=()=>new Promise(r=>release=r);context.start(record());context.close();release([source]);await context.entries.get(officialKey(record())).done;assert.equal(context.start(record()).state,'omitted');
});
test('official UI omits incomplete results and escapes source and model text',()=>{
  const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  assert.equal(officialPanel({state:'omitted'},esc),'');assert.equal(officialPanel({state:'loading'},esc),'');
  assert(!officialPanel({state:'ready',items:[{...item,...source,text:'<img src=x onerror=alert(1)>'}]},esc).includes('<img'));
});
test('retired Chrome origins are denied and official context is isolated from saved inquiry',async t=>{
  const store=new CaseStore(':memory:');const {context}=fixture();const app=createApp({store,ai:{configured:false},official:context});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));store.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const origin of ['chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','https://evil.test','null']) assert.equal((await fetch(base+'/api/config',{headers:{Origin:origin}})).status,403);
  const c=store.create({...record(),updatedAt:new Date().toISOString()});const r=await fetch(`${base}/api/cases/${c.id}/official-context`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal((await r.json()).state,'loading');
  await context.entries.get(officialKey(c)).done;assert.equal((await (await fetch(`${base}/api/cases/${c.id}/official-context`)).json()).state,'ready');assert.deepEqual(store.get(c.id),c);
});
