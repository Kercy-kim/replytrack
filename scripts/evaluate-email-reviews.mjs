import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { OpenAIClient } from '../src/openai.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { EMAIL_EXPLANATION_REVIEW_PROMPT, emailReviewSchema } from '../src/email.mjs';
import { emailCases } from '../evals/email-cases.mjs';
assert(process.argv.includes('--run'), 'Pass --run to authorize paid synthetic checks.');
process.loadEnvFile('.env');
const output = process.env.EMAIL_REVIEW_REPORT || 'evals/results/email-inquiries/review-controls.json';
assert(!existsSync(output), 'Preserve prior evaluation reports.');
const ai = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
const report = { at: new Date().toISOString(), controls: [] };
const save = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); };
const messages = [{ id: 'reply', role: 'agent', text: emailCases[0].agent }];
const controls = [
  ['valid', true, '구매 영수증의 거래 번호를 제공해 주세요. 비밀번호나 인증 코드는 보내지 마세요. 거래 번호 확인 후 복구 요청을 검토합니다.'],
  ['negation-reversed', false, '구매 영수증의 거래 번호와 비밀번호, 인증 코드를 보내 주세요. 확인 후 복구 요청을 검토합니다.'],
  ['invented-completion', false, '계정 복구가 완료되었습니다. 추가 자료는 필요하지 않습니다.'],
  ['invented-deadline', false, '구매 영수증의 거래 번호를 오늘까지 보내 주세요. 비밀번호나 인증 코드는 보내지 마세요. 거래 번호 확인 후 복구 요청을 검토합니다.'],
];
for (let i = 0; i < controls.length; i += 2) await Promise.all(controls.slice(i, i + 2).map(async ([id, expected, korean]) => {
  const start = Date.now();
  const result = await ai.structured({ name: 'replytrack_email_review', schema: emailReviewSchema, instructions: EMAIL_EXPLANATION_REVIEW_PROMPT, reasoningEffort: 'medium', data: { messages, explanation: { items: [{ messageId: 'reply', quote: messages[0].text, korean }] } } });
  report.controls.push({ id, expected, result, ms: Date.now() - start, passed: result.data.valid === expected }); save();
  console.log(`${id}: ${result.data.valid === expected ? 'pass' : 'FAIL'}`);
}));
const store = new CaseStore(':memory:');
try {
  const service = new ReplyTrack(store, ai);
  const image = 'data:image/png;base64,' + readFileSync('.artifacts/email-browser/email-capture.png').toString('base64');
  const prepared = await service.prepare({ image, ocrLanguage: 'eng' });
  assert.match(prepared.text, /transaction ID/);
  const read = await service.extract({ channel: 'email', myAddress: 'me@example.test', text: prepared.text });
  assert.deepEqual(read.messages.map(m => m.role), ['customer', 'agent']);
  assert.match(read.messages[1].text, /Do not send your password/);
  report.capture = { prepared, read, passed: true }; save();
  console.log('Actual local OCR + real AI email extraction: pass');
} finally { store.close(); }
if (report.controls.some(c => !c.passed)) process.exitCode = 1;
