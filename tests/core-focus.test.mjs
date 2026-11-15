import test from 'node:test';
import assert from 'node:assert/strict';
import { draftScope } from '../public/draft-scope.js';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';

test('draft scope tracks selected questions and language without claiming edited prose is verified',()=>{
  const c={questions:[{id:'q1',title:'배송비'},{id:'q2',title:'환불일'}],drafts:{followup:{questionIds:['q1'],language:'ko'}}};
  assert(!draftScope(c,new Set(['q1']),'ko',s=>s).includes('warning-note'));
  for(const [ids,language] of [[['q2'],'ko'],[[],'ko'],[['q1'],'en']])assert(draftScope(c,new Set(ids),language,s=>s).includes('달라요'));
  assert.equal(draftScope({...c,drafts:{followup:{}}},new Set(),'ko',s=>s),'');
});
test('retired handoff is rejected before provider calls; existing saved content is preserved',async()=>{
  let calls=0;const store=new CaseStore(':memory:');const app=createApp({store,ai:{configured:true,async structured(){calls++;throw Error('must not call');}}});
  let c=app.service.demo({});c.drafts.handoff={body:'사용자가 저장한 이전 요약',editedBody:'보존할 편집 내용'};c=store.save(c,c.version);
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
  try {
    for(const [path,body] of [[`/api/cases/${c.id}/drafts`,{version:c.version,kind:'handoff'}],['/api/operations',{id:'removed-handoff',kind:'draft',caseId:c.id,input:{version:c.version,kind:'handoff'}}]]){
      const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,400);
    }
    assert.equal(calls,0);assert.deepEqual(store.get(c.id),c);
    const updated=await app.service.draft(c.id,{version:c.version,kind:'followup',questionIds:c.questions.filter(q=>q.status!=='answered').map(q=>q.id)});
    assert.deepEqual(updated.drafts.followup.questionIds,c.questions.filter(q=>q.status!=='answered').map(q=>q.id));
  }finally{await new Promise(r=>app.server.close(r));store.close();}
});
