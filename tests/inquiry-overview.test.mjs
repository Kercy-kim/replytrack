import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, createRefundDemo } from '../src/demo.mjs';
import { inquiryOverview, inquiryLabel, needsAttention, isWaiting } from '../public/inquiry-overview.js';
import { CaseStore } from '../src/store.mjs';
import { filterCases } from '../public/workspace.js';

test('an inquiry can need my attention and wait on the company; a reported result is not confirmed', () => {
  const c = createRefundDemo(), before = structuredClone(c);
  const o = inquiryOverview(c);
  assert.equal(o.followups, 1); assert.equal(o.waitingAnswers, 1); assert.equal(o.waitingPromises, 1); assert.equal(o.requests, 1);
  assert(needsAttention(o)); assert(isWaiting(o)); assert.deepEqual(c, before);
  c.promises[0].state = 'reported';
  assert.equal(inquiryOverview(c).confirmations, 1);
  c.promises[0].confirmedAt = new Date().toISOString();
  assert.equal(inquiryOverview(c).confirmations, 0);
});

test('new source cannot advertise stale questions, promises or requests as current', () => {
  const c = createRefundDemo(); c.messages.push({ id: 'new', role: 'agent', text: '기한을 정정합니다.' });
  const o = inquiryOverview(c);
  assert.equal(o.fresh, false); assert.equal(o.requestsFresh, false);
  assert.deepEqual([o.followups, o.waitingAnswers, o.waitingPromises, o.confirmations, o.requests], [0, 0, 0, 0, 0]);
  assert.equal(isWaiting(o), false); assert.equal(needsAttention(o), false); assert.equal(inquiryLabel(o), '대화 정리 필요');
  // Request extraction can be updated separately from question analysis.
  c.nextActions.messageIds = c.messages.map(m => m.id);
  assert.equal(inquiryOverview(c).requests, 1); assert.equal(inquiryOverview(c).fresh, false);
});

test('an empty request list is distinct from never checking requests; no overview asserts resolution', () => {
  const c = createDemo(); c.questions.forEach(q => { q.status = 'answered'; }); c.promises.forEach(p => { p.confirmedAt = 'confirmed'; });
  assert.equal(inquiryLabel(inquiryOverview(c)), '업체 요청 확인 전');
  c.nextActions = { messageIds: c.messages.map(m => m.id), items: [] };
  assert.equal(inquiryLabel(inquiryOverview(c)), '기록된 확인 항목 없음');
  c.nextActions.items = [{ state: 'withdrawn' }, { state: 'requested', completedAt: 'confirmed' }, { state: 'reported_done' }];
  assert.equal(inquiryOverview(c).requests, 0);
});

test('list search includes bounded inquiry preview; overlapping filters exclude archived and stale records', () => {
  const store = new CaseStore(':memory:');
  try {
    const original = createRefundDemo(); original.channel = 'email'; original.messages[0].text = '계정 복구 요청 '+ '긴 내용 '.repeat(80);
    const saved = store.create(original); const [row] = store.list();
    assert.equal(row.preview.length, 180); assert.equal(row.channel, 'email'); assert(row.overview.requestsFresh);
    assert.equal(filterCases([row], { query: '복구 요청' }).length, 1);
    assert.equal(filterCases([row], { filter: 'attention' }).length, 1); assert.equal(filterCases([row], { filter: 'waiting' }).length, 1);
    const archived = { ...row, archivedAt: '2026-11-15' };
    assert.equal(filterCases([archived], { filter: 'waiting' }).length, 0); assert.equal(filterCases([archived], { filter: 'archived' }).length, 1);
    const changed = store.get(saved.id); changed.messages.push({ id: 'next', role: 'agent', text: '새 답변' }); store.save(changed, changed.version);
    assert.equal(filterCases(store.list(), { filter: 'attention' }).length, 0); assert.equal(filterCases(store.list(), { filter: 'analysis' }).length, 1);
    assert.equal(store.get(saved.id).messages[0].text, original.messages[0].text);
  } finally { store.close(); }
});
