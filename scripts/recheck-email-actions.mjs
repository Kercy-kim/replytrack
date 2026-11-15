import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { ReplyTrack } from '../src/service.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { CaseStore } from '../src/store.mjs';
assert(process.argv.includes('--run'), 'Pass --run for paid synthetic checks.');
process.loadEnvFile('.env');
const output = process.env.EMAIL_ACTION_REPORT || 'evals/results/email-inquiries/actions-final.json';
assert(!existsSync(output), 'Preserve previous reports.');
const files = ['evals/results/email-inquiries/billing-final.json', 'evals/results/email-inquiries/account-complete.json'];
const report = { at: new Date().toISOString(), cases: [] };
await Promise.all(files.map(async file => {
  const previous = JSON.parse(readFileSync(file)).cases[0];
  assert(previous.after, 'Run full flow to explanation before checking actions.');
  const entry = { id: previous.id, sourceReport: file, calls: [] }; report.cases.push(entry);
  const store = new CaseStore(':memory:');
  const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
  const ai = { async structured(args) { const result = await client.structured(args); entry.calls.push({ name: args.name, ...result }); return result; } };
  try {
    const c = store.create(previous.after), svc = new ReplyTrack(store, ai);
    entry.result = await svc.actions(c.id, c.version);
    assert(entry.result.nextActions.items.some(i => /거래|ID/i.test(i.title)));
    assert(entry.result.nextActions.items.every(i => !i.completedAt));
    if (previous.id === 'account-recovery') assert(entry.result.nextActions.items.some(i => i.state === 'reported_done'));
    entry.passed = true;
  } catch (e) { entry.passed = false; entry.error = { message: e.message, code: e.code }; }
  finally { store.close(); writeFileSync(output, JSON.stringify(report, null, 2)); console.log(`${entry.id}: ${entry.passed ? 'pass' : 'FAIL'}`); }
}));
if (report.cases.some(c => !c.passed)) process.exitCode = 1;
