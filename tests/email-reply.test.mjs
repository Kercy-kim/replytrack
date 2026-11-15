import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emailReplyPlan, splitEmailEvidence } from '../src/email-reply.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
const saved = JSON.parse(readFileSync(new URL('../evals/results/live-browser/inquiry-overview.json', import.meta.url))).cases.find(c => c.name === 'email');
function fixture() { return { ...structuredClone(saved.initial), messages: structuredClone(saved.updated.messages) }; }

test('email agent-only updates preserve question identity and full semantic decisions', () => {
  const c = fixture(), original = structuredClone(c), plan = emailReplyPlan(c);
  const properties = plan.schema.properties.questions.items.properties;
  assert(!('source' in properties)); assert(!('title' in properties));
  for (const field of ['status', 'reason', 'evidence', 'followUp']) assert(field in properties);
  const data = structuredClone(saved.updated);
  data.questions.forEach(q => { delete q.title; delete q.source; });
  const result = plan.restore(data);
  for (const q of result.questions) {
    const before = c.questions.find(old => old.id === q.id);
    assert.equal(q.title, before.title); assert.deepEqual(q.source, before.source);
    const updated = saved.updated.questions.find(old => old.id === q.id);
    assert.equal(q.status, updated.status); assert.deepEqual(q.evidence, updated.evidence);
  }
  assert.deepEqual(result.promises, data.promises); assert.deepEqual(c, original);
});

test('initial, new customer questions, unknown speakers and stale source identities use full analysis', () => {
  const variants = [
    c => { c.channel = 'chat'; }, c => { c.analysis = null; },
    c => { c.analyzedMessageCount = c.messages.length; }, c => { c.questions = []; },
    c => { c.messages.at(-1).role = 'customer'; }, c => { c.messages.at(-1).role = 'unknown'; },
    c => { c.questions[0].source.quote = 'not in the source'; },
  ];
  for (const mutate of variants) { const c = fixture(); mutate(c); assert.equal(emailReplyPlan(c), null); }
});

test('compact results cannot drop, duplicate or invent question identities', () => {
  const c = fixture(), plan = emailReplyPlan(c);
  for (const questions of [[], c.questions.slice(1), c.questions.map(() => c.questions[0]), c.questions.map((q, i) => i ? q : { ...q, id: 'invented' })]) {
    assert.throws(() => plan.restore({ questions }), { code: 'AI_EVIDENCE' });
  }
});

test('conditional, corrected and long email histories keep medium reasoning', () => {
  assert.equal(emailReplyPlan(fixture()).effort, 'low');
  for (const cue of ['Only if approved.', 'After verification.', 'Correction: the previous date is wrong.', 'Unless you reply.', '정정합니다.']) {
    const c = fixture(); c.messages.at(-1).text += cue; assert.equal(emailReplyPlan(c).effort, 'medium');
  }
  const c = fixture(); c.messages.at(-1).text += 'text '.repeat(600); assert.equal(emailReplyPlan(c).effort, 'medium');
});

test('nonadjacent exact email sentences become separate citations without inventing or editing text', () => {
  const messages = [{id:'m',role:'agent',text:'Refunds require verification. Screenshots are optional. We cannot confirm eligibility yet.'}];
  const quote='Refunds require verification. We cannot confirm eligibility yet.';
  const data={questions:[{evidence:[{messageId:'m',quote}]}]};
  assert.deepEqual(splitEmailEvidence(data,messages).questions[0].evidence.map(e=>e.quote),['Refunds require verification.','We cannot confirm eligibility yet.']);
  assert.equal(data.questions[0].evidence.length,1);
  for (const bad of ['Refunds require approval. We cannot confirm eligibility yet.','We cannot confirm eligibility yet. Refunds require verification.','Refunds require verification. invented','Refunds require verification. We cannot confirm eligibility yet!']) {
    const d={questions:[{evidence:[{messageId:'m',quote:bad}]}]}; assert.deepEqual(splitEmailEvidence(d,messages),d);
  }
  assert.deepEqual(splitEmailEvidence(data,[{...messages[0],role:'customer'}]),data);
});

test('a malformed compact response retries the full medium schema before changing stored results', async () => {
  const store = new CaseStore(':memory:');
  try {
    const c = store.create(fixture()), calls = [];
    const svc = new ReplyTrack(store, { configured: true, async structured(args) {
      calls.push(args);
      assert.deepEqual(store.get(c.id).questions,c.questions);
      return { data: calls.length === 1 ? { questions: [] } : structuredClone(saved.updated), model: 'fixture' };
    } });
    const updated = await svc.analyze(c.id,c.version);
    assert.equal(calls.length,2);assert.equal(calls[0].reasoningEffort,'low');assert.equal(calls[1].reasoningEffort,'medium');
    assert(!calls[0].schema.properties.questions.items.properties.source);assert(calls[1].schema.properties.questions.items.properties.source);
    assert.deepEqual(updated.questions.map(q=>q.status).sort(),['answered','answered','unanswered']);
  } finally { store.close(); }
});
