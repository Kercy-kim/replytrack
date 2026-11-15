import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { emailCases, emailThread } from '../evals/email-cases.mjs';
assert(process.argv.includes('--run'), 'Pass --run for paid synthetic evaluation.');
process.loadEnvFile('.env');
assert(process.env.OPENAI_API_KEY, 'Local API configuration required.');
const output = process.env.EMAIL_EVAL_REPORT || 'evals/results/email-inquiries/initial.json';
assert(!existsSync(output), 'Preserve previous reports; choose a new EMAIL_EVAL_REPORT.');
const report = { at: new Date().toISOString(), cases: [] };
// Line wrapping is allowed by email import; words, punctuation and order are not.
const normalizedText = text => text.replace(/\s+/g, ' ').trim();
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); };
await Promise.all(emailCases.filter(f => !process.env.EMAIL_EVAL_CASE || f.id === process.env.EMAIL_EVAL_CASE).map(async f => {
  const entry = { id: f.id, calls: [], steps: [] }; report.cases.push(entry);
  const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  const ai = { configured: true, async structured(args) { const start = Date.now(); const r = await client.structured(args); entry.calls.push({ name: args.name, ms: Date.now() - start, ...r }); save(); return r; } };
  const store = new CaseStore(':memory:'); const svc = new ReplyTrack(store, ai);
  async function step(label, task) { const start = Date.now(); const r = await task(); entry.steps.push({ label, ms: Date.now() - start }); save(); console.log(`${f.id}: ${label}`); return r; }
  try {
    const read = await step('extract', () => svc.extract({ channel: 'email', myAddress: 'me@example.test', text: emailThread(f) }));
    assert.deepEqual(read.messages.map(m => normalizedText(m.text)), [f.customer, f.agent].map(normalizedText));
    const expectedRoles = ['customer', 'agent'];
    assert(read.messages.every((m, i) => m.role === expectedRoles[i] || m.role === 'unknown'));
    entry.senderReviewRequired = read.messages.some(m => m.role === 'unknown');
    // The product's review step requires the user to resolve unknown roles before saving.
    read.messages.forEach((m, i) => { if (m.role === 'unknown') m.role = expectedRoles[i]; });
    let c = svc.create({ channel: 'email', title: f.id, messages: read.messages });
    c = await step('analyze', () => svc.analyze(c.id, c.version));
    entry.initial = structuredClone(c);
    assert.deepEqual(c.questions.map(q => q.status).sort(), [...f.initial].sort());
    c = await step('explain', () => svc.explainEmail(c.id, c.version));
    for (const pattern of f.keywords) assert.match(c.emailExplanation.items[0].korean, pattern);
    c = await step('english-draft', () => svc.draft(c.id, { version: c.version, kind: 'followup', language: 'en', questionIds: c.questions.filter(q => q.status !== 'answered').map(q => q.id) }));
    assert.equal(c.drafts.followup.language, 'en');
    entry.before = structuredClone(c);
    const added = await step('extract-reply', () => svc.extract({ channel: 'email', myAddress: 'me@example.test', text: emailThread(f, true), caseId: c.id, version: c.version }));
    assert.deepEqual(added.messages.map(m => normalizedText(m.text)), [normalizedText(f.reply)]);
    assert(['agent', 'unknown'].includes(added.messages[0].role));
    if (added.messages[0].role === 'unknown') { entry.replySenderReviewRequired = true; added.messages[0].role = 'agent'; }
    c = svc.appendEmail(c.id, { version: c.version, messages: added.messages });
    assert.notEqual(c.emailExplanation.messageCount, c.messages.length);
    c = await step('reanalyze', () => svc.analyze(c.id, c.version));
    assert.deepEqual(c.questions.map(q => q.status).sort(), [...f.updated].sort());
    assert(c.analysis.comparison.questions.length > 0);
    assert(c.promises.every(p => !p.confirmedAt));
    c = await step('explain-reply', () => svc.explainEmail(c.id, c.version));
    entry.after = structuredClone(c); save();
    c = await step('actions', () => svc.actions(c.id, c.version));
    assert(c.nextActions.items.some(i => /transaction ID/.test(i.source.quote)));
    assert(c.nextActions.items.every(i => !i.completedAt));
    if (f.id === 'billing-email') assert(!c.nextActions.items.some(i => /스크린샷|캡처|screenshot/i.test(i.title)));
    entry.after = c; entry.passed = true;
  } catch (e) { entry.passed = false; entry.error = { message: e.message, code: e.code }; console.log(`${f.id}: FAILED ${e.code || ''} ${e.message}`); }
  finally { store.close(); save(); }
}));
if (report.cases.some(c => !c.passed)) process.exitCode = 1;
