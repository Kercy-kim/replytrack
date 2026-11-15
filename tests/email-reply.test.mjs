import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emailReplyPlan, replyAnalysisPlan, splitEmailEvidence, receiptFulfillsDifferentAction } from '../src/email-reply.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { FOCUSED_ANALYSIS_PROMPT } from '../src/analysis-focus.mjs';
import { AppError } from '../src/errors.mjs';
const saved = JSON.parse(readFileSync(new URL('../evals/results/live-browser/inquiry-overview.json', import.meta.url))).cases.find(c => c.name === 'email');
function fixture() { return { ...structuredClone(saved.initial), messages: structuredClone(saved.updated.messages) }; }
function grouped(data, c) {
  const { promises, ...rest } = structuredClone(data);
  return { ...rest, existingPromiseUpdates: promises.filter(p => c.promises.some(old => old.id === p.id)), newPromises: promises.filter(p => !c.promises.some(old => old.id === p.id)) };
}

test('email agent-only updates preserve question identity and full semantic decisions', () => {
  const c = fixture(), original = structuredClone(c), plan = emailReplyPlan(c);
  const properties = plan.schema.properties.questions.items.properties;
  assert.equal(plan.schema.properties.summary.description, undefined);
  assert.equal(plan.schema.properties.promises.items.properties.title.description, undefined);
  assert(!('source' in properties)); assert(!('title' in properties));
  for (const field of ['status', 'reason', 'evidence']) assert(field in properties);
  assert(!('followUp' in properties));
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

test('the observed 84-second reply keeps full sources and medium review when a period becomes a promise deadline', async () => {
  const recorded = JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-final.json', import.meta.url)));
  const analyses = recorded.calls.filter(c => c.name === 'replytrack_analysis');
  const store = new CaseStore(':memory:');
  try {
    const c = store.create({ ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) });
    const plan = emailReplyPlan(c); assert.equal(plan.focused, false); assert.equal(plan.emailActionScope, true); assert.equal(plan.effort, 'medium');
    const calls = [];
    const service = new ReplyTrack(store, { async structured(args) { calls.push(args); const data = structuredClone(analyses[calls.length <= 2 ? 1 : 2].data); return { data: args.schema.properties.existingPromiseUpdates ? grouped(data, c) : data, model: 'recorded-failure-control' }; } });
    const result = await service.analyze(c.id, c.version);
    assert.equal(calls.length, 3); assert(calls.every(x => x.reasoningEffort === 'medium'));
    assert.deepEqual(calls[0].data.messages, c.messages); assert.deepEqual(calls[1].data.messages, c.messages);
    assert(!calls[1].schema.properties.questions);
    assert.equal(result.promises.length, 3); assert(result.promises.every(p => !p.dueText && !p.confirmedAt));
    assert(result.questions.every(q => q.status === 'answered'));
  } finally { store.close(); }
});

test('short established-question corrections use compact low output while conditions keep medium', () => {
  const c = fixture(); delete c.channel; // Chat records omit channel in persistent storage.
  const plan = replyAnalysisPlan(c); assert(plan); assert.equal(plan.effort, 'low');
  assert.equal(plan.focused, true);
  const result = plan.restore(saved.updated);
  for (const q of result.questions) { const original = c.questions.find(x => x.id === q.id); assert.equal(q.title, original.title); assert.deepEqual(q.source, original.source); }
  c.messages.at(-1).text += '앞서 안내한 기한은 취소합니다.'; assert.equal(replyAnalysisPlan(c).effort, 'low');
  c.messages.at(-1).text += '다만 승인되면 가능합니다.'; assert.equal(replyAnalysisPlan(c).effort, 'medium');
  assert.equal(replyAnalysisPlan(c).focused, false);
  c.messages.at(-1).role = 'customer'; assert.equal(replyAnalysisPlan(c), null);
});

test('compact chat updates preserve user corrections and source while applying new AI decisions', async () => {
  const store = new CaseStore(':memory:');
  try {
    const input = fixture(); input.channel = 'chat';
    input.questions[0].title = input.questions[0].manualTitle = '직접 수정한 필요 자료';
    input.questions[0].status = input.questions[0].manualStatus = 'review';
    const c = store.create(input), calls = [];
    const service = new ReplyTrack(store, { async structured(args) {
      calls.push(args); const data = structuredClone(saved.updated);
      data.questions.forEach(q => { delete q.title; delete q.source; delete q.followUp; });
      return { data, model: 'fixture' };
    } });
    const result = await service.analyze(c.id, c.version);
    assert.equal(calls.length, 1);
    assert(calls[0].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));
    assert.deepEqual(calls[0].data.messages, c.messages);
    assert(!calls[0].schema.properties.questions.items.properties.source);
    const q = result.questions.find(q => q.id === c.questions[0].id);
    assert.equal(q.title, '직접 수정한 필요 자료'); assert.equal(q.status, 'review'); assert.equal(q.aiStatus, 'answered');
    assert.deepEqual(q.source, c.questions[0].source);
    assert.deepEqual(result.questions.map(q => q.id), c.questions.map(q => q.id));
    assert(result.questions.every(q => q.followUp === ''));
  } finally { store.close(); }
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

test('conditional, corrected and long email histories keep medium', () => {
  assert.equal(emailReplyPlan(fixture()).effort, 'low');
  assert.equal(emailReplyPlan(fixture()).focused, false);
  assert.equal(emailReplyPlan(fixture()).emailActionScope, true);
  for (const cue of ['Only if approved.', 'After verification.', 'Unless you reply.']) {
    const c = fixture(); c.messages.at(-1).text += cue; assert.equal(emailReplyPlan(c).effort, 'medium');
    assert.equal(emailReplyPlan(c).emailActionScope, true);
  }
  for (const cue of ['Correction: the previous date is wrong.', '정정합니다.', '번복합니다.', 'The delivery date has changed.', 'We retract the deadline.', 'That amount was incorrect.']) {
    const c = fixture(); c.messages.at(-1).text += cue; assert.equal(emailReplyPlan(c).effort, 'medium');
    assert.equal(emailReplyPlan(c).focused, false);
    assert.equal(emailReplyPlan(c).emailActionScope, false);
    c.promises = [{ id: 'prior', dueAt: '2026-11-20', dueText: '2026년 11월 20일' }];
    assert.equal(emailReplyPlan(c).effort, 'medium');
  }
  const c = fixture(); c.messages.at(-1).text += 'text '.repeat(600); assert.equal(emailReplyPlan(c).effort, 'medium');
  assert.equal(emailReplyPlan(c).focused, false);
  assert.equal(emailReplyPlan(c).emailActionScope, false);
});

test('receipt guard requests review only for a receipt replacing a different promised action', () => {
  const record = { channel: 'email', promises: [{ id: 'old', state: 'promised', evidence: { quote: 'We will review your request.' } }] };
  const output = quote => ({ promises: [{ id: 'old', state: 'reported', evidence: { quote } }] });
  assert(receiptFulfillsDifferentAction(output('We received your documents.'), record));
  for (const quote of ['We completed the review.', 'We received your documents and verified your ID.', 'We reviewed the receipt.']) {
    assert(!receiptFulfillsDifferentAction(output(quote), record));
  }
  assert(!receiptFulfillsDifferentAction(output('We received your documents.'), { ...record, channel: 'chat' }));
  assert(!receiptFulfillsDifferentAction(output('We received your documents.'), { ...record, promises: [{ ...record.promises[0], evidence: { quote: 'We will acknowledge receipt.' } }] }));
  assert(!receiptFulfillsDifferentAction(output('We received your documents.'), { ...record, promises: [{ ...record.promises[0], evidence: { quote: 'After review, we will acknowledge receipt.' } }] }));
  assert(!receiptFulfillsDifferentAction({ promises: [{ ...output('We received your documents.').promises[0], id: 'new' }] }, record));
});

test('grouped email output preserves semantics and rejects cross-group IDs or missing groups', () => {
  const recorded = JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-final.json', import.meta.url)));
  const c = { ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) };
  const plan = emailReplyPlan(c), data = grouped(recorded.after, c);
  assert(!plan.schema.properties.promises);
  assert.deepEqual(plan.schema.properties.existingPromiseUpdates.items.properties.id.enum, c.promises.map(p => p.id));
  const restored = plan.restore(data);
  assert.deepEqual(restored.promises, [...data.existingPromiseUpdates, ...data.newPromises]);
  for (const invalid of [recorded.after, { ...data, newPromises: data.existingPromiseUpdates }, { ...data, existingPromiseUpdates: data.newPromises }]) {
    assert.throws(() => plan.restore(invalid), { code: 'AI_EVIDENCE' });
  }
});

test('a receipt cannot silently fulfill review and repeated invalid repair preserves storage', async () => {
  const recorded = JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-final.json', import.meta.url)));
  const correct = recorded.calls.filter(c => c.name === 'replytrack_analysis').at(-1).data;
  for (const repaired of [true, false]) {
    const store = new CaseStore(':memory:');
    try {
      const c = store.create({ ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) });
      const bad = { ...structuredClone(correct), questions: structuredClone(recorded.after.questions) };
      const old = bad.promises.find(p => p.id === c.promises[0].id);
      old.state = 'reported'; old.evidence = { messageId: c.messages.at(-1).id, quote: 'We received your transaction ID.' };
      let calls = 0;
      const svc = new ReplyTrack(store, { async structured(args) {
        calls++; assert.deepEqual(store.get(c.id), c);
        if (calls === 3) { assert.equal(args.reasoningEffort, 'medium'); assert(!args.schema.properties.questions); }
        return { data: calls <= 2 ? (args.schema.properties.existingPromiseUpdates ? grouped(bad, c) : bad) : structuredClone(repaired ? correct : bad), model: 'fixture' };
      } });
      if (repaired) {
        const result = await svc.analyze(c.id, c.version);
        assert.equal(result.promises.find(p => p.id === old.id).state, 'promised');
        assert.equal(result.promises.length, 3);
      } else {
        await assert.rejects(() => svc.analyze(c.id, c.version), { code: 'AI_EVIDENCE' });
        assert.deepEqual(store.get(c.id), c);
      }
      assert.equal(calls, 3);
    } finally { store.close(); }
  }
});

test('parallel analysis waits for both parts, counts both usages, and cancels its sibling on failure', async () => {
  const recorded = JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-final.json', import.meta.url)));
  const correct = { ...recorded.calls.filter(c => c.name === 'replytrack_analysis').at(-1).data, questions: recorded.after.questions };
  for (const fails of [false, true]) {
    const store = new CaseStore(':memory:');
    try {
      const c = store.create({ ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) });
      let calls = 0, release, cancelled = false;
      const ready = new Promise(r => { release = r; });
      const svc = new ReplyTrack(store, { async structured(args) {
        calls++; if (calls === 2) release();
        await ready;
        assert.deepEqual(args.data.messages, c.messages);
        assert.deepEqual(store.get(c.id), c);
        if (fails) {
          if (args.schema.properties.questions) throw new Error('synthetic failure');
          await new Promise((resolve, reject) => {
            const stop = () => { cancelled = true; reject(args.signal.reason); };
            if (args.signal.aborted) stop(); else args.signal.addEventListener('abort', stop, { once: true });
          });
        }
        return { data: args.schema.properties.questions ? { questions: correct.questions } : grouped(correct, c), model: 'fixture', usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, unobserved_requests: 0 } };
      } });
      if (fails) {
        await assert.rejects(() => svc.analyze(c.id, c.version), /synthetic failure/);
        assert(cancelled); assert.deepEqual(store.get(c.id), c); assert(!svc.busy.has(c.id));
      } else {
        const result = await svc.analyze(c.id, c.version);
        assert.equal(result.analysis.usage.total_tokens, 60);
        assert.equal(result.analysis.attempts, 2);
      }
      assert.equal(calls, 2);
    } finally { store.close(); }
  }
});

test('user cancellation aborts both parallel requests without saving either result', async () => {
  const recorded = JSON.parse(readFileSync(new URL('../evals/results/presentation/recording-2026-11-16-final.json', import.meta.url)));
  const store = new CaseStore(':memory:');
  try {
    const c = store.create({ ...structuredClone(recorded.before), messages: structuredClone(recorded.after.messages) });
    const controller = new AbortController(); let started = 0, aborted = 0;
    const svc = new ReplyTrack(store, { structured(args) {
      return new Promise((resolve, reject) => {
        args.signal.addEventListener('abort', () => { aborted++; reject(args.signal.reason); }, { once: true });
        if (++started === 2) controller.abort(new AppError(499, '테스트 취소', 'OPERATION_CANCELLED'));
      });
    } });
    await assert.rejects(() => svc.analyze(c.id, c.version, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
    assert.equal(started, 2); assert.equal(aborted, 2);
    assert.deepEqual(store.get(c.id), c); assert.equal(svc.activeAI, 0); assert(!svc.busy.has(c.id));
  } finally { store.close(); }
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
    assert(!calls[0].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));
    assert(!calls[1].instructions.startsWith(FOCUSED_ANALYSIS_PROMPT));
    assert(!calls[0].schema.properties.questions.items.properties.source);assert(calls[1].schema.properties.questions.items.properties.source);
    assert.deepEqual(updated.questions.map(q=>q.status).sort(),['answered','answered','unanswered']);
  } finally { store.close(); }
});
