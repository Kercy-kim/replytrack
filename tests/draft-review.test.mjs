import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { createDemo } from '../src/demo.mjs';

function setup(respond) {
  const store = new CaseStore(':memory:'), calls = [];
  const seed = createDemo(); seed.mode = 'live';
  const record = store.create(seed);
  const service = new ReplyTrack(store, { async structured(input) {
    calls.push(input); return { data: await respond(input, calls.length, record, service), model: 'fixture' };
  } });
  const input = { version: record.version, kind: 'followup', questionIds: [record.questions[0].id, record.questions[2].id] };
  return { store, record, service, calls, input };
}
const draft = (record, body = '수리비 안내 시점과 왕복 배송비 부담 주체를 알려주세요.') => ({ body, sourceMessageIds: [record.messages[0].id, record.messages[1].id] });

test('live drafts are reviewed for all selected questions and repaired once before saving', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record, count === 1 ? '배송비를 알려주세요.' : undefined) : { valid: count === 4, feedback: count === 2 ? '선택한 수리비 질문이 빠졌습니다.' : '' });
  try {
    const saved = await t.service.draft(t.record.id, t.input);
    assert.deepEqual(t.calls.map(c => c.name), ['replytrack_draft', 'replytrack_draft_review', 'replytrack_draft', 'replytrack_draft_review']);
    assert.equal(t.calls[1].data.questions.length, 2);
    assert.equal(t.calls[1].reasoningEffort, 'medium');
    assert(t.calls[2].data.revisionFeedback.includes('수리비'));
    assert.equal(saved.drafts.followup.body, draft(t.record).body);
    assert.equal(saved.drafts.followup.review.attempts, 2);
  } finally { t.store.close(); }
});
test('repeated review failure is bounded and preserves the previously saved draft', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record) : { valid: false, feedback: '소비자 관점과 맞지 않음' });
  try {
    const original = t.store.get(t.record.id); original.drafts.followup = { body: '보존할 기존 초안', editedBody: '직접 편집한 내용' };
    const saved = t.store.save(original, original.version);
    await assert.rejects(() => t.service.draft(saved.id, { ...t.input, version: saved.version }), { code: 'DRAFT_REVIEW' });
    assert.equal(t.calls.length, 4);
    assert.deepEqual(t.store.get(saved.id).drafts, saved.drafts);
    assert.equal(t.store.get(saved.id).version, saved.version);
  } finally { t.store.close(); }
});
test('review provider errors and concurrent edits cannot overwrite stored work', async () => {
  for (const mode of ['offline', 'conflict']) {
    const t = setup((input, count, record, service) => {
      if (input.name === 'replytrack_draft') return draft(record);
      if (mode === 'offline') throw new Error('review offline');
      service.metadata(record.id, { version: record.version, title: '사용자가 바꾼 제목' });
      return { valid: true, feedback: '' };
    });
    try {
      await assert.rejects(() => t.service.draft(t.record.id, t.input), mode === 'offline' ? /review offline/ : { code: 'VERSION_CONFLICT' });
      assert.equal(t.store.get(t.record.id).drafts.followup, undefined);
      if (mode === 'conflict') assert.equal(t.store.get(t.record.id).title, '사용자가 바꾼 제목');
      assert.equal(t.service.activeAI, 0);
    } finally { t.store.close(); }
  }
});
test('numeric evidence validation repairs before semantic review and malformed review fails closed', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record, count === 1 ? '수리비 987654원이 맞나요?' : undefined) : {});
  try {
    await assert.rejects(() => t.service.draft(t.record.id, t.input), { code: 'DRAFT_REVIEW' });
    assert.deepEqual(t.calls.map(c => c.name), ['replytrack_draft', 'replytrack_draft', 'replytrack_draft_review']);
    assert(t.calls[1].data.revisionFeedback.includes('숫자'));
    assert.equal(t.store.get(t.record.id).drafts.followup, undefined);
  } finally { t.store.close(); }
});
