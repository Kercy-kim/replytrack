import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { testDatabase } from './helpers/postgres.mjs';
import { createApp } from '../server.mjs';
import { EmailFixtureAI } from './helpers/email-fixture.mjs';
import { emailCases } from '../evals/email-cases.mjs';
import { newCase } from '../src/domain.mjs';
import { Accounts } from '../src/accounts.mjs';

const input={title:'계정 복구 문의',channel:'email',messages:[{role:'customer',text:emailCases[0].customer},{role:'agent',text:emailCases[0].agent}]};
test('guest lifetime, cleanup, upgrade and existing-account transfer preserve ownership and records',async()=>{
  const db=await testDatabase({participants:1});
  try{
    const a=await db.accounts.startGuest(), b=await db.accounts.startGuest();
    assert.notEqual(a.user.id,b.user.id);assert.equal(a.user.role,'guest');assert.equal(a.user.username,'비회원');
    const c=await db.forUser(a.user.id).create(newCase(input));
    await assert.rejects(db.forUser(b.user.id).get(c.id),{status:404});
    const reopened=new Accounts(db.pool,{participants:1});await reopened.initialize('Local-test-admin-12345');
    assert.equal((await reopened.authenticate(a.token)).id,a.user.id);
    await db.accounts.recordOperation(a.user,randomUUID());
    const joined=await db.accounts.register({username:'joined',password:'Participant-test-1234'},{id:a.user.id,token:a.token});
    assert.equal(joined.user.id,a.user.id);assert.equal(joined.user.role,'participant');
    assert.equal(await db.accounts.authenticate(a.token),null);
    assert.equal((await db.forUser(joined.user.id).get(c.id)).title,input.title);
    assert.deepEqual(await db.accounts.usage(joined.user),{used:1});
    await assert.rejects(db.accounts.register({username:'second',password:'Participant-test-1234'}),{status:409});
    // A full membership quota must not block anonymous use.
    const other=await db.accounts.startGuest();
    const d=await db.forUser(other.user.id).create(newCase(input));
    await db.accounts.recordOperation(other.user,randomUUID());
    await assert.rejects(db.accounts.login({username:'joined',password:'Wrong-password-1234'},{id:other.user.id,token:other.token}),{status:401});
    assert.equal((await db.forUser(other.user.id).get(d.id)).id,d.id);
    const login=await db.accounts.login({username:'joined',password:'Participant-test-1234'},{id:other.user.id,token:other.token});
    assert.equal((await db.forUser(login.user.id).list()).length,2);
    await db.pool.query("UPDATE rt_auth_limits SET count=100 WHERE bucket='guest-start'");
    await assert.rejects(db.accounts.startGuest(),{status:429});
    assert.equal(await db.accounts.authenticate(other.token),null);assert.deepEqual(await db.accounts.usage(login.user),{used:2});
    // Expiry is enforced even if the periodic cleanup has not run yet.
    await db.forUser(b.user.id).create(newCase(input));await db.accounts.recordOperation(b.user,randomUUID());
    await db.pool.query("UPDATE rt_users SET guest_expires_at=now()-interval '1 second' WHERE id=$1",[b.user.id]);
    assert.equal(await db.accounts.authenticate(b.token),null);
    await db.accounts.purgeExpiredGuests();
    for(const [table,col] of [['rt_users','id'],['rt_sessions','user_id'],['rt_cases','owner_id'],['rt_usage','user_id'],['rt_reservations','user_id']])assert.equal((await db.pool.query(`SELECT * FROM ${table} WHERE ${col}=$1`,[b.user.id])).rows.length,0);
    assert.equal((await db.forUser(login.user.id).list()).length,2);
  }finally{await db.close();}
});

test('guest account linking is atomic on capacity errors and competing upgrades',async()=>{
  const db=await testDatabase();
  try{
    const member=await db.accounts.register({username:'member',password:'Participant-test-1234'});
    for(let i=0;i<30;i++)await db.forUser(member.user.id).create(newCase(input));
    const guest=await db.accounts.startGuest(), identity={id:guest.user.id,token:guest.token};
    const record=await db.forUser(guest.user.id).create(newCase(input));
    await assert.rejects(db.accounts.login({username:'member',password:'Participant-test-1234'},identity),{status:409});
    assert.equal((await db.accounts.authenticate(guest.token)).id,guest.user.id);
    assert.equal((await db.forUser(guest.user.id).get(record.id)).id,record.id);
    const outcomes=await Promise.allSettled(['first','second'].map(username=>db.accounts.register({username,password:'Participant-test-1234'},identity)));
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.find(x=>x.status==='rejected').reason.status,409);
    assert.equal((await db.forUser(guest.user.id).get(record.id)).id,record.id);
  }finally{await db.close();}
});

test('guest API supports registration, analysis, reply, draft and signup; isolates sessions and protects admin routes',async()=>{
  const database=await testDatabase(), ai=new EmailFixtureAI();
  const app=createApp({database,ai,hosting:{publicOrigin:null,password:''}});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const req=async(path,method='GET',body,token,extra={})=>{
    const res=await fetch(base+path,{method,redirect:'manual',headers:{...(token?{Cookie:token}:{}),...(body?{'Content-Type':'application/json',Origin:base}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],body:res.headers.get('content-type')?.includes('json')?await res.json():await res.text()};
  };
  try{
    assert.equal((await req('/api/cases')).status,401);
    assert.equal((await req('/api/auth/guest','POST',{},null,{Origin:'https://evil.example'})).status,403);
    const a=await req('/api/auth/guest','POST',{id:'forged',role:'admin'}),b=await req('/api/auth/guest','POST',{});
    assert.equal(a.status,200);assert.equal(a.body.user.role,'guest');assert.notEqual(a.body.user.id,'forged');
    assert.equal((await req('/api/auth/guest','POST',{},a.cookie)).body.user.id,a.body.user.id);
    assert.equal((await req('/','GET',null,a.cookie)).status,200);
    for(const [path,method] of [['/api/config','PUT'],['/api/demo','POST']])assert.equal((await req(path,method,{},a.cookie)).status,403);
    const run=async(kind,caseId,input={})=>{
      const j=await req('/api/operations','POST',{id:randomUUID(),kind,caseId,input},a.cookie);assert.equal(j.status,202);
      assert.equal((await req(`/api/operations/${j.body.id}`,'GET',null,b.cookie)).status,404);
      await app.operations.jobs.get(j.body.id).done;
      const result=await req(`/api/operations/${j.body.id}`,'GET',null,a.cookie);assert.equal(result.body.state,'completed',JSON.stringify(result.body.error));return result.body.result;
    };
    const prepared=await run('prepare',null,{text:'연락처 010-1234-5678'});assert(!JSON.stringify(prepared).includes('010-1234-5678'));
    let c=(await req('/api/cases','POST',input,a.cookie)).body;
    assert.equal((await req(`/api/cases/${c.id}`,'GET',null,b.cookie)).status,404);
    assert.equal((await req(`/api/cases/${c.id}`,'DELETE',{version:c.version},b.cookie)).status,404);
    await run('analyze',c.id,{version:c.version});c=(await req(`/api/cases/${c.id}`,'GET',null,a.cookie)).body;
    assert(c.questions.some(q=>q.status==='partial'));
    await run('draft',c.id,{version:c.version,kind:'followup',questionIds:c.questions.filter(q=>q.status!=='answered').map(q=>q.id),language:'en'});
    c=(await req(`/api/cases/${c.id}`,'GET',null,a.cookie)).body;
    c=(await req(`/api/cases/${c.id}/messages`,'POST',{version:c.version,role:'agent',text:emailCases[0].reply},a.cookie)).body;
    await run('analyze',c.id,{version:c.version});
    const joined=await req('/api/auth/register','POST',{username:'guest_joined',password:'Participant-test-1234'},a.cookie);assert.equal(joined.status,201);
    assert.equal((await req('/api/cases','GET',null,a.cookie)).status,401);
    const kept=(await req(`/api/cases/${c.id}`,'GET',null,joined.cookie)).body;assert(kept.questions.every(q=>q.status==='answered'));
    assert.equal((await req('/api/cases','GET',null,b.cookie)).body.length,0);
    const bc=(await req('/api/cases','POST',input,b.cookie)).body;
    assert.equal((await req('/api/auth/logout','POST',{},b.cookie)).status,200);
    assert.equal((await req('/api/cases','GET',null,b.cookie)).status,401);
    assert.equal((await database.pool.query('SELECT id FROM rt_cases WHERE id=$1',[bc.id])).rows.length,0);
  }finally{await new Promise(r=>app.server.close(r));await database.close();}
});
