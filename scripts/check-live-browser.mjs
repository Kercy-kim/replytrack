// Opt-in real OpenAI + Chrome test. Synthetic input, isolated memory DB, no mailbox or user records.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OpenAIClient } from '../src/openai.mjs';

assert(process.argv.includes('--run'), 'Pass --run to authorize paid API calls with synthetic input.');
assert(process.env.OPENAI_API_KEY, 'Set the local OPENAI_API_KEY first.');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const dir = `.artifacts/live-browser/${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(dir, { recursive: true });
const analysisEffort = process.argv.find(arg => arg.startsWith('--analysis-effort='))?.split('=')[1] || 'product';
const coreOnly = process.argv.includes('--core-only');
assert(['product', 'low', 'medium'].includes(analysisEffort), 'Use product, low or medium analysis effort.');
const report = { at: new Date().toISOString(), analysisEffort, coreOnly, passed: false, cases: [], calls: [], browserErrors: [],
  hashes: Object.fromEntries(['src/service.mjs', 'src/email-reply.mjs', 'src/email.mjs', 'src/analysis-focus.mjs', 'src/official-context.mjs', 'src/prompts.mjs', 'src/schema.mjs', 'src/openai.mjs', 'src/ai-race.mjs', 'src/store.mjs', 'public/app.js', 'public/inquiry-overview.js', 'public/workspace.js', 'public/styles.css', 'scripts/check-live-browser.mjs'].map(f => [f, createHash('sha256').update(readFileSync(f)).digest('hex')])) };
const save = () => writeFile(`${dir}/result.json`, JSON.stringify(report, null, 2));
class MeasuredOpenAI extends OpenAIClient {
  async structured(args) {
    if (analysisEffort !== 'product' && args.name === 'replytrack_analysis' && !args.data.revisionFeedback) args = { ...args, reasoningEffort: analysisEffort };
    const started = Date.now();
    try {
      const result = await super.structured(args);
      report.calls.push({ name: args.name, reasoningEffort: args.reasoningEffort || 'low', model: result.model, elapsedMs: Date.now() - started, tokens: result.usage?.total_tokens || 0, usage: result.usage, transport: result.transport });
      console.log(`${args.name}: ${Date.now() - started} ms`);
      await save(); return result;
    } catch (error) {
      report.calls.push({ name: args.name, elapsedMs: Date.now() - started, error: error.code || 'ERROR', transport: error.transport });
      await save(); throw error;
    }
  }
}
const ai = new MeasuredOpenAI({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-5-mini' });
const app = createApp({ store: new CaseStore(':memory:'), ai });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM, headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage(); page.setDefaultTimeout(20000);
page.on('pageerror', e => report.browserErrors.push(e.message));
const fixtures = [
  { name: 'refund', channel: 'chat', title: '가상 환불 문의 — 실제 API 웹 검증', company: '가상 테스트 상점',
    text: '나: 반품한 이어폰의 환불 금액은 얼마인가요? 어떤 결제수단으로 환불되나요? 환불 예정일은 언제인가요?\n고객센터: 환불 금액은 79,000원입니다. 환불 예정일은 담당 부서 확인 후 11월 18일까지 안내하겠습니다.',
    reply: '환불은 원래 결제하신 카드로 진행됩니다. 환불 예정일은 아직 확인 중이며 11월 18일까지 안내하겠습니다.',
    initial: ['answered', 'unanswered', 'waiting'], updated: ['answered', 'answered', 'waiting'], draft: /환불.*(예정|날짜|일정|언제|시점)/ },
  { name: 'email', channel: 'email', title: '가상 계정 복구 — 실제 API 웹 검증', company: 'Example Support',
    text: 'From: me@example.test\nWhat documents do I need to recover my account? How long will the review take? What is my case reference number?\n\nFrom: support@example.test\nPlease provide the transaction ID from your purchase receipt. Do not send your password or verification codes.',
    reply: 'From: support@example.test\nWe received your transaction ID. The review will take 3 business days. Your account has not been restored yet.',
    initial: ['answered', 'unanswered', 'unanswered'], updated: ['answered', 'answered', 'unanswered'], draft: /reference|case.*number/i },
];
const requestedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
assert(!requestedCase || fixtures.some(f => f.name === requestedCase), 'Use --case=refund or --case=email.');
const idle = async () => {
  await page.waitForFunction(() => !document.querySelector('.busy-bar'), { }, { timeout: 330000 });
  const error = await page.locator('.error-banner, #modal-error').allTextContents();
  assert.equal(error.join('').trim(), '', `UI error: ${error.join(' ')}`);
};
const current = () => app.store.get(new URL(page.url()).searchParams.get('case'));
const grounded = c => {
  assert.equal(c.mode, 'live'); assert(c.analysis.usage.total_tokens > 0);
  assert.deepEqual(c.warnings, []);
  for (const q of c.questions) {
    assert(c.messages.some(m => m.id === q.source.messageId && m.role === 'customer' && m.text.includes(q.source.quote)));
    for (const e of q.evidence) assert(c.messages.some(m => m.id === e.messageId && m.role === 'agent' && m.text.includes(e.quote)));
  }
  assert(c.promises.every(p => !p.confirmedAt));
};
async function checkOverview(result, stage, expectedStatuses) {
  const c = current();
  const fresh = !!c.nextActions && c.nextActions.messageIds.length === c.messages.length && c.nextActions.messageIds.every((id, i) => id === c.messages[i].id);
  const expected = {
    followups: expectedStatuses.filter(s => ['unanswered', 'partial', 'review'].includes(s)).length,
    waitingAnswers: expectedStatuses.filter(s => s === 'waiting').length,
    waitingPromises: c.promises.filter(p => !p.confirmedAt && p.state === 'promised').length,
    confirmations: c.promises.filter(p => !p.confirmedAt && p.state === 'reported').length,
    requests: fresh ? c.nextActions.items.filter(a => !a.completedAt && ['requested', 'review'].includes(a.state)).length : null,
  };
  const cards = await page.locator('.inquiry-overview-items > div > p').allTextContents();
  assert.equal(cards.length, 3);
  assert(expected.followups ? cards[0].startsWith(`${expected.followups}개`) : cards[0].includes('질문 없음'));
  if (expected.waitingAnswers) assert(cards[1].includes(`답변 대기 질문 ${expected.waitingAnswers}개`));
  if (expected.waitingPromises) assert(cards[1].includes(`처리 약속 ${expected.waitingPromises}개`));
  if (!expected.waitingAnswers && !expected.waitingPromises) assert(cards[1].includes('대기 항목 없음'));
  if (fresh) assert(cards[2].includes(`수행·확인할 요청 ${expected.requests}개`));
  else assert(cards[2].includes('업체 요청은 별도로'));
  if (expected.confirmations) assert(cards[2].includes(`실제 처리 결과 확인 ${expected.confirmations}개`));
  result.overviews ??= []; result.overviews.push({ stage, expected, cards });
  const stored = app.store.list().find(r => r.id === c.id).overview;
  for (const [key, value] of Object.entries(expected)) if (value !== null) assert.equal(stored[key], value, `List/detail mismatch: ${key}`);
  await page.locator('[data-action=inquiry-section][data-value=questions]').click();
  assert.equal(await page.locator('.question-card').count(), expected.followups);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inquiry-questions');
  await page.locator('[data-action=inquiry-section][data-value=waiting]').click();
  assert.equal(await page.locator('.question-card').count(), expected.waitingAnswers);
  await page.locator('[data-action=inquiry-section][data-value=actions]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'next-actions-title');
  await page.locator('#question-filter').selectOption('all');
  await page.locator('.case-heading').scrollIntoViewIfNeeded();
}
try {
  await page.goto(base); await page.locator('.welcome').waitFor();
  for (const fixture of fixtures.filter(f => !requestedCase || f.name === requestedCase)) {
    const result = { name: fixture.name, steps: [], passed: false }; report.cases.push(result);
    const step = async (label, fn) => { const at = Date.now(); await fn(); result.steps.push({ label, elapsedMs: Date.now() - at }); console.log(`${fixture.name}: ${label} passed`); await save(); };
    await step('register-and-analyze', async () => {
      await page.locator('.sidebar [data-action=new]').click();
      await page.locator('[name=channel]').selectOption(fixture.channel);
      await page.locator('#import-form [name=title]').fill(fixture.title);
      await page.locator('#import-form [name=company]').fill(fixture.company);
      if (fixture.channel === 'email') await page.locator('[name=myAddress]').fill('me@example.test');
      await page.locator('#import-form [name=text]').fill(fixture.text);
      await page.locator('#import-form button[type=submit]').click(); await idle();
      await page.locator('#privacy-form button[type=submit]').click(); await idle();
      assert.equal(await page.locator('.review-row').count(), 2);
      result.initialExtractedRoles = await page.locator('.review-row [name=role]').evaluateAll(es => es.map(e => e.value));
      for (const [index, role] of ['customer', 'agent'].entries()) {
        const row = page.locator('.review-row').nth(index);
        assert(fixture.text.includes(await row.locator('textarea').inputValue()), 'Review text must come from the supplied source.');
        await row.locator('[name=role]').selectOption(role);
      }
      await page.locator('#review-form button[type=submit]').click(); await idle();
      const c = current(); result.initial = c; grounded(c);
      assert.deepEqual(c.questions.map(q => q.status).sort(), fixture.initial);
      if (fixture.channel === 'email') assert(c.questions.every(q => /[가-힣]/.test(q.title)), 'Email question titles must be understandable in Korean.');
      await checkOverview(result, 'initial', fixture.initial);
      await page.screenshot({ path: `${dir}/${fixture.name}-initial.png`, fullPage: true });
    });
    if (fixture.channel === 'email' && !coreOnly) await step('korean-explanation-and-actions', async () => {
      await page.locator('[data-action=explain-email]').click(); await idle();
      assert.match(await page.locator('.email-explanation').innerText(), /비밀번호/);
      await page.locator('[data-action=read-actions]').click(); await idle();
      const c = current(); assert.equal(c.nextActions.items.length, 1); assert(!c.nextActions.items[0].completedAt);
      result.initialWithExplanation = c;
      await checkOverview(result, 'requests-extracted', fixture.initial);
    });
    await step('append-and-compare', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.heading-actions [data-action=append]').click();
      if (fixture.channel === 'email') {
        await page.locator('#import-form [name=text]').fill(fixture.reply);
        await page.locator('#import-form button[type=submit]').click(); await idle();
        await page.locator('#privacy-form button[type=submit]').click(); await idle();
        assert.equal(await page.locator('.review-row').count(), 1);
        result.replyExtractedRole = await page.locator('.review-row [name=role]').inputValue();
        assert(fixture.reply.includes(await page.locator('.review-row textarea').inputValue()));
        await page.locator('.review-row [name=role]').selectOption('agent');
        await page.locator('#review-form button[type=submit]').click();
      } else {
        await page.locator('#append-form [name=text]').fill(fixture.reply);
        await page.locator('#append-form button[type=submit]').click();
      }
      await idle(); const c = current(); result.updated = c; grounded(c);
      assert.deepEqual(c.questions.map(q => q.id).sort(), result.initial.questions.map(q => q.id).sort());
      assert.deepEqual(c.questions.map(q => q.status).sort(), fixture.updated);
      if (fixture.channel === 'email') {
        assert.equal(c.promises.length, 1, 'General review duration must not create an extra promise.');
        assert.equal(c.promises[0].state, 'reported');
        assert.equal(c.promises[0].dueText, '');
        assert.match(c.promises[0].evidence.quote, /received your transaction ID/);
      }
      if (fixture.channel === 'email') assert(c.questions.every(q => /[가-힣]/.test(q.title)));
      assert(c.analysis.comparison.questions.some(q => q.before?.status !== q.after.status));
      assert(await page.locator('#analysis-changes').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (fixture.channel === 'email' && !coreOnly) assert.match(await page.locator('.email-explanation').innerText(), /이전 답변 기준/);
      await checkOverview(result, 'updated', fixture.updated);
      await page.screenshot({ path: `${dir}/${fixture.name}-updated-mobile.png`, fullPage: true });
    });
    await step('followup-edit-save-copy-reload', async () => {
      await page.locator('[data-action=tab][data-value=drafts]').click();
      assert.equal(await page.locator('[name=draft-question]:checked').count(), 1);
      await page.locator('[data-action=generate-draft][data-kind=followup]').click(); await idle();
      const c = current(); const draft = c.drafts.followup;
      assert(draft.review); assert.match(draft.body, fixture.draft);
      assert(report.calls.some(call => call.name === 'replytrack_draft' && call.tokens > 0));
      assert(draft.sourceMessageIds.every(id => c.messages.some(m => m.id === id)));
      assert(!/\b[0-9a-f]{8}-[0-9a-f-]{27}\b|_r\d+/.test(draft.body));
      result.generated = c;
      const edited = `${draft.body}\n${fixture.channel === 'email' ? 'Thank you for your help.' : '확인 부탁드립니다.'}`;
      await page.locator('#draft-followup').fill(edited);
      await page.locator('[data-action=save-draft][data-kind=followup]').click(); await idle();
      await page.locator('[data-action=copy][data-kind=followup]').click();
      // Windows clipboard uses CRLF; compare content after normalizing only line endings.
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n'), edited.replace(/\r\n/g, '\n'));
      await page.reload(); await page.locator('.case-heading').waitFor();
      await page.locator('[data-action=tab][data-value=drafts]').click();
      assert.equal(await page.locator('#draft-followup').inputValue(), edited);
      await page.screenshot({ path: `${dir}/${fixture.name}-draft-mobile.png`, fullPage: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `${dir}/${fixture.name}-draft-desktop.png`, fullPage: true });
      result.final = current();
    });
    result.passed = true; await save();
  }
  assert.deepEqual(report.browserErrors, []); report.passed = true;
} catch (error) { report.failure = error.message; console.error(error.message); process.exitCode = 1; }
finally {
  report.totalTokens = report.calls.reduce((sum, c) => sum + (c.tokens || 0), 0);
  await save(); console.log(`Report: ${dir}/result.json`);
  await browser.close(); await new Promise(r => app.server.close(r)); app.store.close();
}
