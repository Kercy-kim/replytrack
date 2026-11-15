import test from 'node:test';
import assert from 'node:assert/strict';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack, draftSourceContext } from '../src/service.mjs';
import { createDemo } from '../src/demo.mjs';
import { draftSchema, draftSchemaFor } from '../src/schema.mjs';
import { DRAFT_PROMPT, DRAFT_REVIEW_PROMPT } from '../src/prompts.mjs';
import { draftChecks } from '../src/feature-review.mjs';

function setup(respond) {
  const store = new CaseStore(':memory:'), calls = [];
  const seed = createDemo(); seed.mode = 'live';
  const record = store.create(seed);
  const service = new ReplyTrack(store, { async structured(input) {
    calls.push(input); const data = await respond(input, calls.length, record, service);
    if (input.name === 'replytrack_draft_review' && data?.valid === true && !('checks' in data)) data.checks = Object.fromEntries(Object.keys(draftChecks).map(k => [k, true]));
    return { data, model: 'fixture' };
  } });
  const input = { version: record.version, kind: 'followup', questionIds: [record.questions[0].id, record.questions[2].id] };
  return { store, record, service, calls, input };
}
const draft = (record, body = '수리비 안내 시점과 왕복 배송비 부담 주체를 알려주세요.') => ({ body, sourceMessageIds: [record.messages[0].id, record.messages[1].id] });

test('a global approval cannot override missing or rejected draft checks', async () => {
  for (const checks of [{}, ...Object.keys(draftChecks).map(failed => Object.fromEntries(Object.keys(draftChecks).map(k => [k, k !== failed])))]) {
    const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record) : { valid: true, checks, feedback: '' });
    try { await assert.rejects(() => t.service.draft(t.record.id, t.input), { code: 'DRAFT_REVIEW' }); assert.equal(t.store.get(t.record.id).drafts.followup, undefined); }
    finally { t.store.close(); }
  }
});

test('draft reference schema permits only message IDs from this conversation, never question IDs', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record) : { valid: true, feedback: '' });
  try {
    await t.service.draft(t.record.id, t.input);
    const sources = t.calls[0].schema.properties.sourceMessageIds;
    assert.equal(t.calls[0].instructions, DRAFT_PROMPT);
    assert.equal(t.calls[1].instructions, DRAFT_REVIEW_PROMPT);
    assert.deepEqual(sources.items.enum, t.record.messages.map(m => m.id));
    assert.equal(sources.minItems, 1);
    assert.equal(sources.maxItems, t.record.messages.length);
    assert(!sources.items.enum.includes(t.record.questions[0].id));
    assert.deepEqual(draftSchemaFor([{ id: 'another-message' }]).properties.sourceMessageIds.items.enum, ['another-message']);
    assert.equal(draftSchema.properties.sourceMessageIds.items.enum, undefined);
    assert.deepEqual(sources.items.enum, t.record.messages.map(m => m.id));
  } finally { t.store.close(); }
});

test('draft generation and review cannot treat AI reasoning or follow-up suggestions as source facts', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record) : { valid: true, feedback: '' });
  try {
    const c = t.store.get(t.record.id);
    for (const q of c.questions) { q.reason = q.aiReason = '근거 없는 비용 차감'; q.followUp = '새로운 산출 내역을 요구하세요'; }
    const saved = t.store.save(c, c.version);
    await t.service.draft(c.id, { ...t.input, version: saved.version });
    assert.equal(t.calls.length, 2);
    for (const call of t.calls) {
      for (const q of call.data.questions) assert.deepEqual(Object.keys(q).sort(), ['evidence', 'id', 'source', 'status', 'topicHint']);
      assert.deepEqual(call.data.answeredQuestions, c.questions.filter(q => q.status === 'answered').map(({ id, title, source, status, evidence }) => ({ id, topicHint: title, source, status, evidence })));
      assert(call.data.questions.every(q => !call.data.answeredQuestions.some(a => a.id === q.id)));
      assert.deepEqual(call.data.messages, c.messages.map(({ id, role, text }) => ({ id, role, text })));
    }
  } finally { t.store.close(); }
});

test('answered selections cannot trigger AI or overwrite an existing draft', async () => {
  const t = setup(() => { throw new Error('must not call AI'); });
  try {
    const record = t.store.get(t.record.id);
    record.questions.forEach(q => { q.status = 'answered'; });
    record.drafts.followup = { body: '기존 초안', editedBody: '직접 편집한 초안' };
    const saved = t.store.save(record, record.version);
    await assert.rejects(t.service.draft(saved.id, { ...t.input, version: saved.version }), /미해결 질문/);
    assert.equal(t.calls.length, 0);
    assert.deepEqual(t.store.get(saved.id), saved);
  } finally { t.store.close(); }
});

test('draft sources omit metadata dates and unknown confirmation while preserving explicit user confirmation', () => {
  const record = createDemo(), before = structuredClone(record);
  record.promises[0].confirmedAt = '2026-11-14T00:00:00Z';
  const context = draftSourceContext(record);
  for (const m of context.messages) assert.deepEqual(Object.keys(m).sort(), ['id', 'role', 'text']);
  for (const p of context.promises) { assert(!('dueAt' in p)); assert(!('confirmedAt' in p)); }
  assert.equal(context.promises[0].confirmedByUser, true);
  assert(context.promises.slice(1).every(p => !('confirmedByUser' in p)));
  assert.deepEqual(context.promises.map(p => p.evidence), record.promises.map(p => p.evidence));
  assert.deepEqual(context.promises.map(p => p.dueText), record.promises.map(p => p.dueText));
  assert.deepEqual(record.messages, before.messages);
});

test('live drafts are reviewed for all selected questions and repaired once before saving', async () => {
  const t = setup((input, count, record) => input.name === 'replytrack_draft' ? draft(record, count === 1 ? '배송비를 알려주세요.' : undefined) : { valid: count === 4, feedback: count === 2 ? '선택한 수리비 질문이 빠졌습니다.' : '' });
  try {
    const saved = await t.service.draft(t.record.id, t.input);
    assert.deepEqual(t.calls.map(c => c.name), ['replytrack_draft', 'replytrack_draft_review', 'replytrack_draft', 'replytrack_draft_review']);
    assert.equal(t.calls[1].data.questions.length, 2);
    assert.equal(t.calls[0].reasoningEffort, 'low');
    assert.equal(t.calls[1].reasoningEffort, 'medium');
    assert.equal(t.calls[2].reasoningEffort, 'medium');
    assert.equal(t.calls[3].reasoningEffort, 'medium');
    assert.deepEqual(t.calls[2].data.questions, t.calls[0].data.questions);
    assert.equal(t.calls[2].data.previousDraft, null);
    assert.equal(saved.drafts.followup.body, draft(t.record).body);
    assert.equal(saved.drafts.followup.review.attempts, 2);
  } finally { t.store.close(); }
});

test('semantic retry cannot promote reviewer-invented requirements or rejected text to source facts', async () => {
  const invented = '배송지는 제주도입니다';
  const t = setup((input, count, record) => input.name === 'replytrack_draft'
    ? draft(record, count === 1 ? invented : undefined)
    : { valid: count === 4, feedback: count === 2 ? `${invented}라는 문장을 반드시 추가하세요.` : '' });
  try {
    await t.service.draft(t.record.id, t.input);
    assert.equal(t.calls.length, 4);
    assert.equal(t.calls[2].data.previousDraft, null);
    assert(!JSON.stringify(t.calls[2].data).includes(invented));
    assert.deepEqual(t.calls[2].data.messages, t.calls[0].data.messages);
    assert.deepEqual(t.calls[2].data.questions, t.calls[0].data.questions);
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
