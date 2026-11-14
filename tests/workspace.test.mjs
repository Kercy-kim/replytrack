import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { createApp } from '../server.mjs';
import { koreaDay, deadlineState, summarizeDeadlines, filterCases, savedDraft, dirtyDraftKinds } from '../public/workspace.js';

test('deadline urgency follows Korean calendar boundaries and never flags confirmed or unknown dates', () => {
  assert.equal(koreaDay('2026-11-13T14:59:59Z'), '2026-11-13');
  assert.equal(koreaDay('2026-11-13T15:00:00Z'), '2026-11-14');
  const today = '2026-11-14';
  assert.equal(deadlineState({dueAt:'2026-11-13'}, today), 'overdue');
  assert.equal(deadlineState({dueAt:'2026-11-14'}, today), 'today');
  assert.equal(deadlineState({dueAt:'2026-11-15'}, today), 'upcoming');
  assert.equal(deadlineState({dueAt:'2026-11-13',confirmedAt:'2026-11-13T01:00:00Z'}, today), 'confirmed');
  assert.equal(deadlineState({dueAt:null}, today), 'unknown');
  assert.equal(deadlineState({dueAt:'2026-02-30'}, today), 'unknown');
  assert.deepEqual(summarizeDeadlines([{dueAt:'2026-11-13'},{dueAt:'2026-11-14'},{dueAt:null},{dueAt:'2026-11-12',confirmedAt:'yes'}],today),{overdue:1,today:1,upcoming:0,unknown:1,nextDueAt:'2026-11-13'});
});

test('workspace search, priority, and archive filters compose without mutating input', () => {
  const base = {title:'청소기 A/S',company:'클린홈',updatedAt:'2026-11-14T01:00:00Z',unanswered:2,promises:1,deadlines:{overdue:0,today:0,nextDueAt:null}};
  const cases = [{...base,id:'normal'},{...base,id:'due',deadlines:{overdue:1,today:0,nextDueAt:'2026-11-12'}},{...base,id:'archive',archivedAt:'2026-11-14T01:00:00Z'},{...base,id:'analysis',pendingAnalysis:true}];
  assert.deepEqual(filterCases(cases).map(c=>c.id),['due','analysis','normal']);
  assert.deepEqual(filterCases(cases,{query:'  ａ／ｓ ',filter:'due'}).map(c=>c.id),['due']);
  assert.deepEqual(filterCases(cases,{query:'클린홈',filter:'archived'}).map(c=>c.id),['archive']);
  assert.equal(filterCases(cases,{query:'없는 업체'}).length,0);
  assert.equal(cases[0].id,'normal');
});

test('draft edits persist across reopening the database; conflicts cannot overwrite them', async () => {
  const directory = mkdtempSync(join(tmpdir(),'replytrack-workspace-'));
  const file = join(directory,'cases.sqlite');
  let store = new CaseStore(file);
  try {
    let service = new ReplyTrack(store,{}), c = service.demo();
    c = await service.draft(c.id,{version:c.version,kind:'handoff'});
    const original = structuredClone(c.drafts.handoff), version = c.version;
    c = service.saveDraft(c.id,'handoff',{version,body:'제가 직접 정리한 문의입니다.\n답변 부탁드립니다.'});
    assert.deepEqual(c.drafts.handoff.sourceMessageIds,original.sourceMessageIds);
    assert.equal(c.drafts.handoff.body,original.body);
    assert(c.drafts.handoff.editedAt);
    assert.throws(()=>service.saveDraft(c.id,'handoff',{version,body:'오래된 창의 편집'}),e=>e.status===409);
    assert.throws(()=>service.saveDraft(c.id,'handoff',{version:c.version,body:' '.repeat(10)}),e=>e.status===400);
    store.close(); store = new CaseStore(file); service = new ReplyTrack(store,{});
    c = store.get(c.id);
    assert.equal(savedDraft(c.drafts.handoff),'제가 직접 정리한 문의입니다.\n답변 부탁드립니다.');
    assert.deepEqual(dirtyDraftKinds(c.drafts,{handoff:savedDraft(c.drafts.handoff)}),[]);
    assert.deepEqual(dirtyDraftKinds({}, {handoff:'다른 작업에서 초기화되어도 남길 편집'}),['handoff']);
    const before = structuredClone(c);
    c = service.metadata(c.id,{version:c.version,title:'수리 견적 확인',company:'새 고객센터',archived:true});
    assert(c.archivedAt);
    assert.deepEqual(c.questions,before.questions);
    assert.deepEqual(c.promises,before.promises);
    assert.deepEqual(c.drafts,before.drafts);
    assert.deepEqual(c.messages,before.messages);
    assert.equal(store.list()[0].archivedAt,c.archivedAt);
    c = service.metadata(c.id,{version:c.version,archived:false});
    assert.equal(c.archivedAt,null);
    assert.deepEqual(c.promises,before.promises);
  } finally { store.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('web API exposes metadata and draft saving with validation, version checks, and shared summaries',async () => {
  const app = createApp({store:new CaseStore(':memory:')});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path,method='GET',body) => {
    const r = await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined});
    return {status:r.status,data:await r.json()};
  };
  try {
    let c = (await call('/api/demo','POST',{})).data;
    const path = `/api/cases/${c.id}`;
    assert.equal((await call(path,'PATCH',{version:c.version,title:' '})).status,400);
    assert.equal((await call(path,'PATCH',{version:c.version,archived:'yes'})).status,400);
    assert.equal((await call(`${path}/drafts/handoff`,'PATCH',{version:c.version,body:'먼저 생성'})).status,404);
    c = (await call(`${path}/drafts`,'POST',{version:c.version,kind:'handoff'})).data;
    assert.equal((await call(`${path}/drafts/handoff`,'PATCH',{version:c.version,body:'가'.repeat(8001)})).status,400);
    const version = c.version;
    c = (await call(`${path}/drafts/handoff`,'PATCH',{version,body:'직접 편집한 초안'})).data;
    assert.equal(c.drafts.handoff.editedBody,'직접 편집한 초안');
    assert.equal((await call(path,'PATCH',{version,archived:true})).status,409);
    c = (await call(path,'PATCH',{version:c.version,title:'새 제목',company:'',archived:true})).data;
    assert.equal(c.title,'새 제목'); assert.equal(c.company,'고객센터'); assert(c.archivedAt);
    const list = (await call('/api/cases')).data;
    assert.equal(list[0].archivedAt,c.archivedAt);
    assert.equal(typeof list[0].deadlines.overdue,'number');
    assert.equal((await fetch(base+'/workspace.js')).status,200);
  } finally { await new Promise(resolve=>app.server.close(resolve)); app.store.close(); }
});
