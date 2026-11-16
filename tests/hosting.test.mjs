import test from 'node:test';
import assert from 'node:assert/strict';
import { hostingConfig } from '../src/hosting.mjs';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { request } from 'node:http';

const password='test-only-long-password';
const origin='https://replytrack-test.onrender.com';
const authorization='Basic '+Buffer.from('replytrack:'+password).toString('base64');

test('local hosting remains loopback-only and Render requires HTTPS plus an access password',()=>{
  assert.deepEqual(hostingConfig({}),{publicOrigin:null,password:'',bindHost:'127.0.0.1'});
  for(const raw of ['not a URL','http://example.com','https://x.example/path','https://x.example?q=1','https://u:p@x.example']){
    assert.throws(()=>hostingConfig({REPLYTRACK_PUBLIC_ORIGIN:raw,REPLYTRACK_DEMO_PASSWORD:password}));
  }
  assert.throws(()=>hostingConfig({RENDER:'true'}));
  assert.throws(()=>hostingConfig({RENDER:'true',RENDER_EXTERNAL_URL:origin}));
  assert.throws(()=>hostingConfig({REPLYTRACK_PUBLIC_ORIGIN:origin,REPLYTRACK_DEMO_PASSWORD:'short'}));
  const config=hostingConfig({RENDER:'true',RENDER_EXTERNAL_URL:origin,REPLYTRACK_DEMO_PASSWORD:password});
  assert.equal(config.publicOrigin,origin);assert.equal(config.bindHost,'0.0.0.0');
  assert.equal(hostingConfig({RENDER:'true',RENDER_EXTERNAL_URL:origin,REPLYTRACK_PUBLIC_ORIGIN:'https://custom.example',REPLYTRACK_DEMO_PASSWORD:password}).publicOrigin,'https://custom.example');
});

test('public hosting protects records, API settings and replay while permitting the health check',async()=>{
  let aiCalls=0;
  const app=createApp({store:new CaseStore(':memory:'),ai:{configured:false,model:'test',async structured(){aiCalls++;throw Error('not expected');}},hosting:hostingConfig({REPLYTRACK_PUBLIC_ORIGIN:origin,REPLYTRACK_DEMO_PASSWORD:password})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const call=(path,headers={},options={})=>new Promise((resolve,reject)=>{
    const req=request(base+path,{method:options.method||'GET',headers:{Host:new URL(origin).host,...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.end(options.body);
  });
  try{
    assert.deepEqual(await (await call('/api/health')).json(),{ok:true,app:'ReplyTrack'});
    for(const path of ['/','/presentation','/presentation-data.json','/api/cases','/api/config']){
      const res=await call(path);assert.equal(res.status,401);assert.match(res.headers.get('www-authenticate'),/Basic realm="ReplyTrack"/);assert.equal((await res.text()).includes(password),false);
    }
    assert.equal((await call('/api/config',{}, {method:'PUT',body:'{}'})).status,401);
    assert.equal((await call('/api/cases',{authorization:'Basic invalid'})).status,401);
    assert.equal((await call('/api/cases',{authorization,Origin:origin})).status,200);
    assert.equal((await call('/api/cases',{authorization,Origin:'https://evil.example'})).status,403);
    assert.equal((await call('/api/cases',{authorization,Origin:origin.replace('https:','http:')})).status,403);
    assert.equal((await call('/api/health',{Host:'evil.example'})).status,403);
    assert.equal((await call('/',{authorization,'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'})).status,200);
    assert.equal((await call('/api/cases',{authorization,'Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal((await fetch(base+'/api/cases')).status,401); // Local host cannot bypass deployed auth.
    const created=await call('/api/demo',{authorization,Origin:origin,'Content-Type':'application/json'},{method:'POST',body:'{}'});
    assert.equal(created.status,201);const c=await created.json();
    assert.equal((await call('/api/cases/'+c.id)).status,401);
    assert.equal((await call('/api/cases/'+c.id,{authorization})).status,200);
    assert.equal((await call('/.env',{authorization})).status,404);
    assert.equal(aiCalls,0);
  }finally{await new Promise(r=>app.server.close(r));app.store.close();}
});
