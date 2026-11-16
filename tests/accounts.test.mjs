import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/postgres.mjs';
import { Accounts, digest, sessionCookie } from '../src/accounts.mjs';
import { newCase } from '../src/domain.mjs';
import { Operations } from '../src/operation.mjs';

test('PostgreSQL accounts: single-use invites, 10 participants, password/session hashes, restart and logout', async () => {
  const db = await testDatabase();
  try {
    const admin = await db.accounts.login({username:'replytrack',password:'Local-test-admin-12345'});
    const codes = await Promise.all(Array.from({length:10}, () => db.accounts.invite(admin.user)));
    await assert.rejects(db.accounts.invite(admin.user),{status:409});
    const registered = await Promise.all(codes.map(({code},i) => db.accounts.register({username:`person${i}`,password:'Participant-test-1234',invite:code})));
    assert.equal(new Set(registered.map(r=>r.user.id)).size,10);
    await assert.rejects(db.accounts.register({username:'reuse',password:'Participant-test-1234',invite:codes[0].code}),{status:400});
    await assert.rejects(db.accounts.invite(registered[0].user),{status:403});
    const stored = await db.pool.query('SELECT password_hash FROM rt_users');
    assert(stored.rows.every(r=>!r.password_hash.includes('test-1234')));
    assert.equal(new Set(stored.rows.map(r=>r.password_hash)).size,11);
    assert.equal((await db.pool.query('SELECT token_hash FROM rt_sessions WHERE token_hash=$1',[registered[0].token])).rows.length,0);
    assert.equal((await db.pool.query('SELECT token_hash FROM rt_sessions WHERE token_hash=$1',[digest(registered[0].token)])).rows.length,1);
    const reopened = new Accounts(db.pool); await reopened.initialize('New-unused-admin-12345');
    assert.equal((await reopened.authenticate(registered[0].token)).id,registered[0].user.id);
    await assert.rejects(reopened.login({username:'replytrack',password:'New-unused-admin-12345'}),{status:401});
    await reopened.logout(registered[0].token); assert.equal(await reopened.authenticate(registered[0].token),null);
    await db.pool.query("UPDATE rt_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(registered[1].token)]);
    assert.equal(await reopened.authenticate(registered[1].token),null);
    assert.match(sessionCookie('x',true),/HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
  } finally { await db.close(); }
});

test('PostgreSQL ownership, atomic version updates and usage records remain isolated without daily caps', async () => {
  const db = await testDatabase();
  try {
    const admin = (await db.accounts.login({username:'replytrack',password:'Local-test-admin-12345'})).user;
    const users = await Promise.all(['alpha','beta'].map(async username => db.accounts.register({username,password:'Participant-test-1234',invite:(await db.accounts.invite(admin)).code})));
    const [a,b] = users.map(u=>db.forUser(u.user.id));
    const c = await a.create(newCase({title:'비공개 환불 문의',company:'시험몰',messages:[{role:'customer',text:'환불은 언제인가요?'}]}));
    assert.equal((await a.list()).length,1); assert.equal((await b.list()).length,0);
    await assert.rejects(b.get(c.id),{status:404}); await assert.rejects(b.save(c,1),{status:404}); await assert.rejects(b.delete(c.id,1),{status:404});
    const edits = await Promise.allSettled([a.save({...c,title:'A'},1),a.save({...c,title:'B'},1)]);
    assert.equal(edits.filter(r=>r.status==='fulfilled').length,1); assert.equal(edits.find(r=>r.status==='rejected').reason.status,409);
    assert.equal((await db.forUser(users[0].user.id).get(c.id)).version,2);
    await db.pool.query("INSERT INTO rt_usage(user_id,day,count) VALUES($1,(now() AT TIME ZONE 'Asia/Seoul')::date,30),($2,(now() AT TIME ZONE 'Asia/Seoul')::date,100)",[users[0].user.id,admin.id]);
    await Promise.all(Array.from({length:10},()=>db.accounts.recordOperation(users[0].user,randomUUID())));
    assert.deepEqual(await db.accounts.usage(users[0].user),{used:40});
    assert.deepEqual(await db.accounts.usage(users[1].user),{used:0});
    const operationId=randomUUID(); await db.accounts.recordOperation(admin,operationId);
    await assert.rejects(db.accounts.recordOperation(admin,operationId),{status:409});
    assert.deepEqual(await db.accounts.usage(admin),{used:101});
  } finally { await db.close(); }
});

test('10 concurrent owners queue at most two jobs and cannot read or cancel each other', async () => {
  const operations = new Operations({queue:true,maxConcurrent:2}); let active=0, peak=0;
  try {
    const jobs=Array.from({length:10},(_,i)=>({id:randomUUID(),owner:`user-${i}`}));
    jobs.forEach(({id,owner})=>operations.start(id,async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,15));active--;return {owner};},owner));
    assert.equal(operations.get(jobs[9].id,jobs[9].owner).queuePosition,8);
    assert.throws(()=>operations.get(jobs[0].id,jobs[1].owner),{status:404}); assert.throws(()=>operations.cancel(jobs[0].id,jobs[1].owner),{status:404});
    assert.throws(()=>operations.start(randomUUID(),()=>{},jobs[0].owner),{status:429});
    await Promise.all([...operations.jobs.values()].map(j=>j.done));
    assert.equal(peak,2); jobs.forEach(j=>assert.deepEqual(operations.get(j.id,j.owner).result,{owner:j.owner}));
  } finally { operations.close(); }
});

test('memory-heavy OCR runs one at a time while another user can run an AI job', async () => {
  const operations=new Operations({queue:true}); let ocr=0,peak=0,aiRanDuringOcr=false;
  const image=async()=>{ocr++;peak=Math.max(peak,ocr);await new Promise(r=>setTimeout(r,25));ocr--;};
  operations.start(randomUUID(),image,'a','ocr'); operations.start(randomUUID(),image,'b','ocr');
  operations.start(randomUUID(),async()=>{aiRanDuringOcr=ocr===1;},'c');
  await Promise.all([...operations.jobs.values()].map(j=>j.done));
  assert.equal(peak,1);assert(aiRanDuringOcr);operations.close();
});

test('cancellation during an asynchronous commit reports its final outcome, never false cancellation', async () => {
  const operations=new Operations({queue:true}); const id=randomUUID();let release, started;
  const saving=new Promise(r=>started=r);
  operations.start(id,async context=>context.commit(async()=>{started();await new Promise(r=>release=r);return {saved:true};}),'owner');
  await saving;
  assert.equal(operations.cancel(id,'owner').state,'running');
  release();await operations.jobs.get(id).done;
  assert.equal(operations.get(id,'owner').state,'completed');assert.deepEqual(operations.get(id,'owner').result,{saved:true});
  operations.close();
});
