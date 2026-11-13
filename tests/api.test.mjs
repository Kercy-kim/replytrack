import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';

test('HTTP demo lifecycle, state updates, drafts, deletion and isolation',async()=>{
  const app=createApp({store:new CaseStore(':memory:'),ai:new OpenAIClient()});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const call=async(path,method='GET',body)=>{
    const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:res.status,data:await res.json()};
  };
  try {
    assert.equal((await call('/api/health')).data.ok,true);
    let r=await call('/api/demo','POST',{}); assert.equal(r.status,201); let c=r.data;
    assert.deepEqual(c.questions.map(q=>q.status),['waiting','answered','unanswered']);
    r=await call(`/api/cases/${c.id}/drafts`,'POST',{version:c.version,kind:'followup',questionIds:c.questions.filter(q=>q.status!=='answered').map(q=>q.id)});
    assert.equal(r.status,200); c=r.data; assert.match(c.drafts.followup.body,/배송비/);
    c=(await call(`/api/cases/${c.id}/demo-next`,'POST',{version:c.version})).data;
    assert.equal(c.questions[2].status,'answered'); assert.equal(c.drafts.followup,undefined);
    assert.equal((await call(`/api/cases/${c.id}/demo-next`,'POST',{version:c.version-1})).status,409);
    c=(await call(`/api/cases/${c.id}/demo-next`,'POST',{version:c.version})).data;
    assert.equal(c.promises[0].confirmedAt,null);
    c=(await call(`/api/cases/${c.id}/promises/${c.promises[0].id}`,'PATCH',{version:c.version,confirmed:true})).data;
    assert(c.promises[0].confirmedAt);
    c=(await call(`/api/cases/${c.id}/drafts`,'POST',{version:c.version,kind:'handoff'})).data;
    assert.match(c.drafts.handoff.body,/제가 확인/);
    assert.equal((await call('/.env')).status,404); assert.equal((await call('/data/replytrack.sqlite')).status,404);
    const cross=await fetch(base+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});
    assert.equal(cross.status,403);
    const badType=await fetch(base+'/api/demo',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});
    assert.equal(badType.status,415);
    assert.equal((await call('/api/config')).data.configured,false);
    assert.equal(JSON.stringify((await call('/api/config')).data).includes('apiKey'),false);
    assert.equal((await call(`/api/cases/${c.id}`,'DELETE',{version:c.version})).status,200);
    assert.equal((await call('/api/cases')).data.length,0);
  } finally {await new Promise(resolve=>app.server.close(resolve));app.store.close();}
});
test('Responses request has strict schema and no storage; provider errors are redacted',async()=>{
  let request;
  const client=new OpenAIClient({apiKey:'sk-test-not-a-real-credential',fetchImpl:async(url,options)=>{
    request=JSON.parse(options.body);
    return new Response(JSON.stringify({status:'completed',model:'gpt-5-mini',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]}));
  }});
  const result=await client.structured({name:'test',schema:{type:'object'},instructions:'test',data:{text:'hello'}});
  assert.equal(result.data.ok,true); assert.equal(request.store,false); assert.equal(request.text.format.strict,true);
  client.fetch=async()=>new Response('do not expose provider details',{status:401});
  await assert.rejects(()=>client.structured({}),e=>e.code==='AI_AUTH'&&!e.message.includes('credential'));
  client.fetch=async()=>new Response(JSON.stringify({status:'incomplete',output:[]}));
  await assert.rejects(()=>client.structured({}),{code:'AI_INCOMPLETE'});
});
