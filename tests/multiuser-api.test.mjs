import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { testDatabase } from './helpers/postgres.mjs';
import { OfficialContext } from '../src/official-context.mjs';
import { newCase } from '../src/domain.mjs';

test('web API isolates 10 users, all case writes and job polling; blocks CSRF and participant configuration', async () => {
  const database=await testDatabase(); let active=0,peak=0,calls=0,pair=[],pairMode=true;
  const ai={configured:true,model:'test',structured:async()=>{
    calls++;active++;peak=Math.max(peak,active);
    // Hold pairs until both provider calls arrive, independent of DB latency.
    if(pairMode) await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Concurrent job did not start')),10000);
      pair.push(()=>{clearTimeout(timer);resolve();});
      if(pair.length===2) { const ready=pair;pair=[];setTimeout(()=>ready.forEach(r=>r()),30); }
    });
    active--;return {data:{ok:true}};
  }};
  const guideReleases=[];
  const official=new OfficialContext({ai});
  official.run=async()=>{await new Promise(r=>guideReleases.push(r));return {state:'omitted'};};
  const app=createApp({database,ai,official,hosting:{publicOrigin:null,password:''}});
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,method='GET',body,token,headers={})=>{
    const res=await fetch(base+path,{method,redirect:'manual',headers:{...(token?{Cookie:token}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],body:res.headers.get('content-type')?.includes('json')?await res.json():await res.text()};
  };
  try {
    assert.equal((await request('/')).status,303); assert.equal((await request('/api/cases')).status,401); assert.equal((await request('/login')).status,200);
    assert.equal((await request('/api/auth/login','POST',{username:'replytrack',password:'Local-test-admin-12345'},null,{Origin:'https://evil.example'})).status,403);
    const admin=await request('/api/auth/login','POST',{username:'replytrack',password:'Local-test-admin-12345'}); assert.equal(admin.status,200);
    const users=[];
    for(let i=0;i<10;i++) {
      const invite=await request('/api/admin/invites','POST',{},admin.cookie);
      const user=await request('/api/auth/register','POST',{username:`webuser${i}`,password:'Participant-test-1234',invite:invite.body.code});
      assert.equal(user.status,201); users.push(user);
    }
    const [a,b]=users;
    for(const path of ['/api/config','/api/admin/invites','/api/demo']) assert.equal((await request(path,path==='/api/config'?'PUT':'POST',{},b.cookie)).status,403);
    const record=(await request('/api/cases','POST',{title:'A만의 문의',company:'시험몰',messages:[{role:'customer',text:'환불 언제인가요?'}]},a.cookie)).body;
    assert.equal((await request('/api/cases','GET',null,b.cookie)).body.length,0);
    const id=record.id;
    const routes=[['GET',`/api/cases/${id}`],['PATCH',`/api/cases/${id}`,{title:'탈취',version:1}],['DELETE',`/api/cases/${id}`,{version:1}],['POST',`/api/cases/${id}/messages`,{version:1,role:'agent',text:'잘못된 접근'}],['POST',`/api/cases/${id}/email-messages`,{version:1,messages:[]}],['PATCH',`/api/cases/${id}/questions/test`,{version:1}],['PATCH',`/api/cases/${id}/promises/test`,{version:1}],['PATCH',`/api/cases/${id}/actions/test`,{version:1}],['PATCH',`/api/cases/${id}/drafts/followup`,{version:1}],['GET',`/api/cases/${id}/official-context`],['POST',`/api/cases/${id}/official-context`,{}]];
    for(const [method,path,data] of routes) assert.equal((await request(path,method,data,b.cookie)).status,404,path);
    for(const kind of ['analyze','draft','actions','email-explanation','extract']) assert.equal((await request('/api/operations','POST',{id:randomUUID(),caseId:id,kind,input:{version:1,caseId:id,kind:'followup'}},b.cookie)).status,404,kind);
    assert.equal(calls,0);
    assert.equal((await request(`/api/cases/${id}`,'GET',null,a.cookie)).body.title,'A만의 문의');
    assert.equal((await request(`/api/cases/${id}`,'PATCH',{title:'정상 수정',version:1},a.cookie,{Origin:''})).status,403);
    assert.equal((await request('/api/extract','POST',{},a.cookie)).status,400);
    assert.equal((await request(`/api/cases/${id}/analyze`,'POST',{version:1},a.cookie)).status,400);
    const jobs=await Promise.all(users.map(u=>request('/api/operations','POST',{id:randomUUID(),kind:'preflight'},u.cookie)));
    assert(jobs.every(j=>j.status===202));
    for(const method of ['GET','DELETE']) assert.equal((await request(`/api/operations/${jobs[0].body.id}`,method,method==='DELETE'?{}:null,b.cookie)).status,404);
    await Promise.all([...app.operations.jobs.values()].map(j=>j.done));
    assert.equal(calls,10); assert.equal(peak,2);
    for(let i=0;i<10;i++) { const result=await request(`/api/operations/${jobs[i].body.id}`,'GET',null,users[i].cookie);assert.equal(result.body.state,'completed');assert.equal((await request('/api/auth/me','GET',null,users[i].cookie)).body.usage.used,1); }
    // Unsupported official guidance is omitted without inflating usage.
    assert.equal((await request(`/api/cases/${id}/official-context`,'POST',{},a.cookie)).body.state,'omitted');
    assert.equal((await request('/api/auth/me','GET',null,a.cookie)).body.usage.used,1);
    const guideRecords=await Promise.all(users.slice(7).map(u=>{
      const c=newCase({title:'계정 복구',company:'Google',messages:[{role:'customer',text:'계정을 복구할 때 어떤 자료가 필요한가요?'}]});
      c.analysis={model:'test'};c.analyzedMessageCount=1;
      return database.forUser(u.body.user.id).create(c);
    }));
    const guides=await Promise.all(guideRecords.map((c,i)=>request(`/api/cases/${c.id}/official-context`,'POST',{},users[i+7].cookie)));
    assert.equal(guides.filter(r=>r.body.state==='loading').length,2);
    assert.equal(guides.filter(r=>r.body.state==='omitted').length,1);
    for(let i=0;i<3;i++) {
      assert.equal((await request('/api/auth/me','GET',null,users[i+7].cookie)).body.usage.used,guides[i].body.state==='loading'?2:1);
      if(guides[i].body.state==='loading') {
        await request(`/api/cases/${guideRecords[i].id}/official-context`,'POST',{},users[i+7].cookie);
        assert.equal((await request('/api/auth/me','GET',null,users[i+7].cookie)).body.usage.used,2);
      }
    }
    guideReleases.forEach(r=>r());await Promise.all([...official.entries.values()].map(e=>e.done));
    pairMode=false;
    for(const [u,previous] of [[a,30],[admin,100]]) {
      await database.pool.query("INSERT INTO rt_usage(user_id,day,count) VALUES($1,(now() AT TIME ZONE 'Asia/Seoul')::date,$2) ON CONFLICT(user_id,day) DO UPDATE SET count=$2",[u.body.user.id,previous]);
      const beyond=await request('/api/operations','POST',{id:randomUUID(),kind:'preflight'},u.cookie);
      assert.equal(beyond.status,202);await app.operations.jobs.get(beyond.body.id).done;
      assert.equal((await request(`/api/operations/${beyond.body.id}`,'GET',null,u.cookie)).body.state,'completed');
      assert.deepEqual((await request('/api/auth/me','GET',null,u.cookie)).body.usage,{used:previous+1});
    }
    await request('/api/auth/logout','POST',{},a.cookie); assert.equal((await request('/api/cases','GET',null,a.cookie)).status,401);
    const again=await request('/api/auth/login','POST',{username:'webuser0',password:'Participant-test-1234'}); assert.equal((await request('/api/cases','GET',null,again.cookie)).body[0].id,id);
  } finally { guideReleases.forEach(r=>r());app.operations.close(); await new Promise(r=>app.server.close(r)); await database.close(); }
});
