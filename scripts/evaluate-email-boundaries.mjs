import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OpenAIClient } from '../src/openai.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { ACTIONS_REVIEW_PROMPT, actionsReviewSchema } from '../src/next-actions.mjs';
import { EMAIL_ACTIONS_PROMPT } from '../src/email.mjs';
import { actionChecks, reviewPassed } from '../src/feature-review.mjs';
assert(process.argv.includes('--run'), 'Pass --run for paid synthetic checks.');
process.loadEnvFile('.env');
const output = process.env.EMAIL_BOUNDARY_REPORT || 'evals/results/email-inquiries/boundaries.json';
assert(!existsSync(output), 'Preserve prior reports.');
const ai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
const report = { at: new Date().toISOString(), checks: [] };
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); };
await Promise.all([
  ['specified-documents', 'What evidence should I send for this account request?', 'Please send a copy of the original purchase receipt.', 'answered'],
  ['missing-second-item', 'Do I need to send both a purchase receipt and a photo for this account request?', 'A purchase receipt is required. The requirement for a photo is not yet determined.', 'partial'],
].map(async ([id, customer, agent, expected]) => {
  const store = new CaseStore(':memory:');
  try {
    const svc = new ReplyTrack(store, ai), c = svc.create({ channel: 'email', title: id, messages: [{ role: 'customer', text: customer }, { role: 'agent', text: agent }] });
    const result = await svc.analyze(c.id, c.version);
    const passed = expected === 'answered' ? result.questions.every(q => q.status === 'answered') : result.questions.some(q => q.status !== 'answered');
    report.checks.push({ id, expected, messages: c.messages, result, passed }); save(); console.log(`${id}: ${passed ? 'pass' : 'FAIL'}`);
  } finally { store.close(); }
}));
await Promise.all([
  ['object-modifier', 'Please send a copy of the original purchase receipt.', '원본 구매 영수증 사본 보내기', true],
  ['missing-real-condition', 'Only if you still have access to your account, send a screenshot of the settings page.', '설정 화면 캡처 보내기', false],
  ['company-condition-not-customer-condition', 'Once you confirm the receipt number, we will start the review.', '영수증 번호 확인', true],
].map(async ([id, quote, title, expected]) => {
  const messages = [{ id: 'agent-reply', role: 'agent', text: quote }];
  const items = [{ id: 'request', source: { messageId: 'agent-reply', quote }, title, state: 'requested', update: null, condition: '', dueText: '' }];
  const result = await ai.structured({ name: 'replytrack_actions_review', schema: actionsReviewSchema, instructions: ACTIONS_REVIEW_PROMPT + '\n' + EMAIL_ACTIONS_PROMPT, reasoningEffort: 'medium', data: { messages, items, existingItems: [] } });
  const passed = reviewPassed(result.data, actionChecks) === expected;
  report.checks.push({ id, expected, messages, items, result, passed }); save(); console.log(`${id}: ${passed ? 'pass' : 'FAIL'}`);
}));
if (report.checks.some(c => !c.passed)) process.exitCode = 1;
