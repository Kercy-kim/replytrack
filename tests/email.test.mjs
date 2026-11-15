import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { validateEmailExplanation, validateEmailTranscript } from '../src/email.mjs';
import { emailExplanationPanel } from '../public/email.js';
import { createApp } from '../server.mjs';
import { EmailFixtureAI } from './helpers/email-fixture.mjs';
import { randomUUID } from 'node:crypto';

const messages = [{ role: 'customer', text: 'When can I recover my account?' }, { role: 'agent', text: 'Send the transaction ID. Do not send your password.' }];
function fixture(fn) {
  const store = new CaseStore(':memory:');
  const service = new ReplyTrack(store, { configured: true, structured: fn });
  const c = service.create({ title: 'Email test', channel: 'email', messages });
  return { store, service, c };
}
const explanation = c => ({ items: c.messages.filter(m => m.role === 'agent').map(m => ({ messageId: m.id, quote: m.text, korean: '거래 번호를 보내 주세요. 비밀번호는 보내지 마세요.' })) });

test('email transcription preserves original language, quoted-only messages and removes exact repeats', () => {
  const msgs = [...messages, messages[0]];
  assert.deepEqual(validateEmailTranscript(msgs, '> ' + messages.map(m => m.text).join('\n> ')), messages);
  assert.deepEqual(validateEmailTranscript(msgs, messages.map(m => m.text).join('\n'), [messages[0]]), [messages[1]]);
  assert.throws(() => validateEmailTranscript([{ role: 'agent', text: 'Your account is recovered.' }], messages[1].text), { code: 'EMAIL_TRANSCRIPT' });
  assert.equal(validateEmailTranscript([{ ...messages[1], sentAt: '2026-11-15T00:00:00.000Z' }], messages[1].text, [{ ...messages[1], sentAt: '2026-11-14T00:00:00.000Z' }]).length, 1);
});

test('explanation rejects incomplete, translated, wrong-role and fabricated source quotes', t => {
  const { store, c } = fixture(); t.after(() => store.close());
  validateEmailExplanation(explanation(c), c.messages);
  for (const mutate of [d => d.items.pop(), d => d.items.push(d.items[0]), d => d.items[0].quote = '거래 번호를 보내세요', d => d.items[0].messageId = c.messages[0].id, d => d.items[0].korean = 'English only']) {
    const d = explanation(c); mutate(d);
    assert.throws(() => validateEmailExplanation(d, c.messages), { code: 'EMAIL_EVIDENCE' });
  }
});

test('failed or cancelled explanation preserves the prior result and never confirms recovery', async t => {
  let valid = true, controller;
  const f = fixture(async args => {
    if (args.name === 'replytrack_email_review') { controller?.abort(); return { data: { valid, feedback: '' } }; }
    return { data: explanation(f.c), model: 'fixture' };
  }); t.after(() => f.store.close());
  let c = await f.service.explainEmail(f.c.id, f.c.version);
  const before = structuredClone(c);
  valid = false;
  await assert.rejects(f.service.explainEmail(c.id, c.version), { code: 'EMAIL_REVIEW' });
  assert.deepEqual(f.store.get(c.id), before);
  valid = true; controller = new AbortController();
  await assert.rejects(f.service.explainEmail(c.id, c.version, { signal: controller.signal }), { code: 'OPERATION_CANCELLED' });
  assert.deepEqual(f.store.get(c.id), before);
});

test('explanation cannot overwrite simultaneous edits and missing answers cost no call', async t => {
  let calls = 0;
  const f = fixture(async args => {
    calls++;
    if (args.name === 'replytrack_email_review') { f.service.metadata(f.c.id, { version: f.c.version, title: 'Changed' }); return { data: { valid: true } }; }
    return { data: explanation(f.c) };
  }); t.after(() => f.store.close());
  await assert.rejects(f.service.explainEmail(f.c.id, f.c.version), { status: 409 });
  assert.equal(f.store.get(f.c.id).title, 'Changed');
  assert.equal(f.store.get(f.c.id).emailExplanation, undefined);
  const onlyQuestion = f.service.create({ title: 'No answer', channel: 'email', messages: [messages[0]] });
  const before = calls;
  await assert.rejects(f.service.explainEmail(onlyQuestion.id, onlyQuestion.version));
  assert.equal(calls, before);
});

test('email append is atomic, preserves stale explanations and drafts, and respects versions', async t => {
  const f = fixture(async args => ({ data: args.name === 'replytrack_email_review' ? { valid: true } : explanation(f.c), model: 'fixture' })); t.after(() => f.store.close());
  let c = await f.service.explainEmail(f.c.id, f.c.version);
  const before = structuredClone(c);
  assert.throws(() => f.service.appendEmail(c.id, { version: c.version, messages: [messages[1], { role: 'unknown', text: 'Unknown' }] }));
  assert.deepEqual(f.store.get(c.id), before);
  c = f.service.appendEmail(c.id, { version: c.version, messages: [{ role: 'agent', text: 'The review takes three business days.' }] });
  assert.equal(c.messages.length, 3);
  assert.equal(c.emailExplanation.messageCount, 2);
  assert.throws(() => f.service.appendEmail(c.id, { version: before.version, messages: [messages[1]] }), { status: 409 });
  const html = emailExplanationPanel(c, { esc: x => x.replaceAll('<', '&lt;'), button: () => '', date: x => x });
  assert.match(html, /이전 답변 기준/);
  assert.match(html, /원문 보기/);
});

test('English drafts use generation and review, default Korean remains unchanged', async t => {
  const prompts = [];
  const f = fixture(async args => {
    prompts.push(args.instructions);
    return args.name === 'replytrack_draft_review' ? { data: { valid: true, checks: { consumerVoice: true, selectedQuestionsCovered: true, sourceFactsOnly: true, noExtraRequests: true, noAnsweredRequests: true } } } : { data: { body: 'When can I recover my account?', sourceMessageIds: [f.c.messages[0].id] } };
  }); t.after(() => f.store.close());
  let c = f.store.get(f.c.id);
  c.analyzedMessageCount = 2;
  c.questions = [{ id: 'q', title: '복구 시점', status: 'unanswered', source: { messageId: c.messages[0].id, quote: messages[0].text }, evidence: [] }];
  c = f.store.save(c, c.version);
  c = await f.service.draft(c.id, { version: c.version, kind: 'followup', questionIds: ['q'] });
  assert.equal(c.drafts.followup.language, 'en');
  assert.equal(prompts.length, 2);
  assert(prompts.every(p => p.includes('출력 언어: 영어')));
  await assert.rejects(f.service.draft(c.id, { version: c.version, kind: 'followup', language: 'fr', questionIds: ['q'] }));
});

test('HTTP email workflow validates versions before AI and persists explanations plus new reply', async t => {
  const ai = new EmailFixtureAI(), app = createApp({ store: new CaseStore(':memory:'), ai });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => app.server.close(r)); app.store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, body) { const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; }
  let { data: c } = await request('/api/cases', { title: 'HTTP email', channel: 'email', messages });
  let response = await request('/api/operations', { id: randomUUID(), kind: 'email-explanation', caseId: c.id, input: { version: 0 } });
  assert.equal(response.status, 409); assert.equal(ai.calls.length, 0);
  response = await request('/api/operations', { id: randomUUID(), kind: 'email-explanation', caseId: c.id, input: { version: c.version } });
  assert.equal(response.status, 202);
  await app.operations.jobs.get(response.data.id).done;
  const job = app.operations.get(response.data.id);
  assert.equal(job.state, 'completed'); c = job.result;
  response = await request(`/api/cases/${c.id}/email-messages`, { version: c.version, messages: [{ role: 'agent', text: 'We received the transaction ID.' }] });
  assert.equal(response.status, 200);
  assert.equal(response.data.messages.length, 3);
  assert.equal(response.data.emailExplanation.messageCount, 2);
});

test('capture language is explicit and defaults to existing mixed OCR without remote images', async t => {
  const store = new CaseStore(':memory:'); t.after(() => store.close());
  const observed = [];
  const service = new ReplyTrack(store, { structured: () => { throw new Error('No AI during prepare'); } }, { ocr: async (image, context) => { observed.push(context.ocrLanguage); return 'Please provide the transaction ID.'; } });
  const image = 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  assert.match((await service.prepare({ image, ocrLanguage: 'eng' })).text, /transaction ID/);
  await service.prepare({ image });
  assert.deepEqual(observed, ['eng', undefined]);
  await assert.rejects(service.prepare({ image, ocrLanguage: 'invalid' }));
});
