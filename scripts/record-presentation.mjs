import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { emailCases, emailThread } from '../evals/email-cases.mjs';

assert(process.argv.includes('--run'), 'Pass --run for paid synthetic recording.');
const out = process.argv[process.argv.indexOf('--out') + 1];
assert(process.argv.includes('--out') && out && !existsSync(out), 'Choose a new --out file.');
mkdirSync('evals/results/presentation', { recursive: true });
const files = ['src/service.mjs', 'src/prompts.mjs', 'src/email.mjs', 'src/schema.mjs', 'src/next-actions.mjs'];
const report = { synthetic: true, fixture: 'account-recovery', mode: 'live OpenAI Responses API', startedAt: new Date().toISOString(), baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])), calls: [], steps: [], passed: false };
const save = () => writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: 'gpt-5-mini-2025-08-07' });
const ai = { async structured(args) { const start = Date.now(); const result = await client.structured(args); report.calls.push({ name: args.name, ms: Date.now() - start, ...result }); save(); return result; } };
const store = new CaseStore(':memory:'), svc = new ReplyTrack(store, ai), fixture = emailCases[0];
const normalize = text => text.replace(/\s+/g, ' ').trim();
async function step(name, task) { const start = Date.now(); const result = await task(); report.steps.push({ name, ms: Date.now() - start }); save(); console.log(name); return result; }
try {
  const read = await step('extract', () => svc.extract({ channel: 'email', myAddress: 'me@example.test', text: emailThread(fixture) }));
  assert.deepEqual(read.messages.map(m => normalize(m.text)), [fixture.customer, fixture.agent]);
  read.messages.forEach((m, i) => { assert(['unknown', i ? 'agent' : 'customer'].includes(m.role)); m.role = i ? 'agent' : 'customer'; });
  report.senderReview = 'Synthetic fixture roles confirmed at the user review step';
  let c = svc.create({ title: '해외 서비스 계정 복구 문의', company: '가상 고객지원', channel: 'email', messages: read.messages });
  c = await step('analyze', () => svc.analyze(c.id, c.version));
  assert.deepEqual(c.questions.map(q => q.status).sort(), ['answered', 'partial']);
  c = await step('explain', () => svc.explainEmail(c.id, c.version));
  c = await step('actions-before', () => svc.actions(c.id, c.version));
  assert.equal(c.nextActions.items.length, 1); assert.equal(c.nextActions.items[0].state, 'requested');
  c = await step('english-draft', () => svc.draft(c.id, { version: c.version, kind: 'followup', language: 'en', questionIds: c.questions.filter(q => q.status !== 'answered').map(q => q.id) }));
  report.before = structuredClone(c); save();
  const next = await step('extract-reply', () => svc.extract({ channel: 'email', caseId: c.id, version: c.version, myAddress: 'me@example.test', text: emailThread(fixture, true) }));
  assert.deepEqual(next.messages.map(m => normalize(m.text)), [fixture.reply]);
  assert(['agent', 'unknown'].includes(next.messages[0].role)); next.messages[0].role = 'agent';
  c = svc.appendEmail(c.id, { version: c.version, messages: next.messages });
  c = await step('reanalyze', () => svc.analyze(c.id, c.version));
  c = await step('explain-reply', () => svc.explainEmail(c.id, c.version));
  c = await step('actions-after', () => svc.actions(c.id, c.version));
  assert(c.questions.every(q => q.status === 'answered'));
  assert.equal(c.analysis.comparison.questions.filter(q => q.before?.status !== q.after?.status).length, 1);
  assert.equal(c.nextActions.items[0].state, 'reported_done');
  assert(c.nextActions.items.every(i => !i.completedAt)); assert(c.promises.every(p => !p.confirmedAt));
  report.after = c; report.passed = true;
} catch (e) { report.error = { message: e.message, code: e.code }; process.exitCode = 1; console.error(report.error); }
finally { report.finishedAt = new Date().toISOString(); save(); store.close(); }
