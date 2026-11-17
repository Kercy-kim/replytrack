import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {testDatabase} from './helpers/postgres.mjs';

test('13 guests can enter; queued jobs stay isolated and capacity rejection can be retried',async()=>{
  const database=await testDatabase();let release,active=0,peak=0,calls=0;
  const gate=new Promise(r=>release=r);
  const ai={configured:true,model:'fixture',async structured(){calls++;active++;peak=Math.max(peak,active);await gate;active--;return {data:{ok:true}};}};
  const app=createApp({database,ai,hosting:{publicOrigin:null,password:''}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const request=async(path,cookie,body)=>{const res=await fetch(base+path,{method:body?'POST':'GET',headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,cookie:res.headers.get('set-cookie')?.split(';')[0],body:await res.json()};};
  try{
    const guests=await Promise.all(Array.from({length:13},()=>request('/api/auth/guest',null,{})));
    assert(guests.every(g=>g.status===200&&g.body.user.role==='guest'));
    assert.equal(new Set(guests.map(g=>g.body.user.id)).size,13);
    const jobs=[];
    for(const g of guests)jobs.push(await request('/api/operations',g.cookie,{id:randomUUID(),kind:'preflight'}));
    assert(jobs.slice(0,12).every(j=>j.status===202));assert.equal(jobs[12].status,429);
    assert.match(jobs[12].body.error,/잠시 후 다시/);
    assert.equal((await request('/api/operations/'+jobs[0].body.id,guests[1].cookie)).status,404);
    assert.equal((await request('/api/operations/'+jobs[11].body.id,guests[11].cookie)).body.stage,'queued');
    assert.equal(peak,2);release();
    await Promise.all([...app.operations.jobs.values()].map(j=>j.done));
    const retry=await request('/api/operations',guests[12].cookie,{id:randomUUID(),kind:'preflight'});
    assert.equal(retry.status,202);await app.operations.jobs.get(retry.body.id).done;
    assert.equal((await request('/api/operations/'+retry.body.id,guests[12].cookie)).body.state,'completed');
    assert.equal(calls,13);assert.equal(peak,2);
    for(const g of guests)assert.equal((await request('/api/cases',g.cookie)).body.length,0);
  }finally{release();app.operations.close();await new Promise(r=>app.server.close(r));await database.close();}
});
