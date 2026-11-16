// Real browser and local OCR; deterministic provider fixtures, no paid API calls.
// REPLYTRACK_PLAYWRIGHT_MODULE and REPLYTRACK_CHROMIUM can point to existing installs.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { WebFixtureAI, fixtureText } from '../tests/helpers/web-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const artifacts = resolve('.artifacts/web-operations'); await mkdir(artifacts, { recursive: true });
class BrowserAI extends WebFixtureAI {
  model = 'gpt-5-mini';
  configure({ model }) { this.model = model; }
  hold(name) { this.heldName = name; this.gate = new Promise(resolve => { this.release = () => { this.heldName = ''; resolve(); }; }); }
  async structured(args) {
    if (args.name === this.heldName) await this.gate;
    return super.structured(args);
  }
}
const ai = new BrowserAI();
const app = createApp({ store: new CaseStore(':memory:'), ai });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const results = [], errors = [], outbound = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(origin)) outbound.push(request.url()); });
  page.setDefaultTimeout(15000);
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy-bar'));
  const modal = page.locator('#modal');
  const clickCancel = async () => { await (await modal.isVisible() ? modal : page.locator('#app')).locator('[data-action="cancel-operation"]').click(); await idle(); };
  await page.goto(origin);
  await page.locator('.connection').filter({ hasText: '첫 분석 시 연결 확인' }).waitFor();
  await page.locator('.avatar').click();
  ai.hold('replytrack_connection');
  await page.locator('#settings-form button[type=submit]').click();
  await modal.locator('[data-progress]').filter({ hasText: 'AI 연결 확인 중' }).waitFor();
  await page.waitForTimeout(1200);
  assert.match(await modal.locator('[data-elapsed]').innerText(), /경과 0분 0[1-9]초/);
  await page.screenshot({ path: resolve(artifacts, 'connection-desktop.png'), fullPage: true });
  await clickCancel(); assert.equal(app.service.config().connection.state, 'unchecked');
  assert.equal(await page.locator('#api-model').inputValue(), 'gpt-5-mini'); ai.release();
  await page.locator('#settings-form button[type=submit]').click(); await idle();
  assert.match(await page.locator('.connection-result').innerText(), /AI 연결됨/);
  results.push('Actual preflight lifecycle, elapsed time, cancellation and verified-versus-configured distinction');
  await modal.locator('[data-action="close-modal"]').first().click();

  await page.locator('.sidebar [data-action="new"]').click();
  assert.equal(await page.locator('.onboarding-connection').count(), 0, 'Verified connection should not repeat setup in registration');
  const source = `${fixtureText}\n연락처 010-1234-5678\n주소: 서울특별시 강남구 테헤란로 123, 101동 202호`;
  await page.locator('#import-form [name=title]').fill('개인정보 가림과 취소 검증');
  await page.locator('#import-form [name=text]').fill(source);
  const beforeRead = ai.calls.length;
  await page.locator('#import-form button[type=submit]').click(); await idle();
  const masked = await page.locator('#privacy-form [name=text]').inputValue();
  assert(!masked.includes('010-1234')); assert(!masked.includes('테헤란로')); assert.match(masked, /전화번호_/);
  assert.equal(ai.calls.length, beforeRead);
  ai.hold('replytrack_transcript');
  await page.locator('#privacy-form button[type=submit]').click();
  await modal.locator('[data-progress]').filter({ hasText: '보낸 사람과 답변 정리 중' }).waitFor();
  await clickCancel(); assert.equal(await page.locator('#privacy-form [name=text]').inputValue(), masked);
  assert.equal(app.store.list().length, 0); ai.release();
  await page.locator('#privacy-form button[type=submit]').click(); await idle();
  const transcriptCalls = ai.calls.filter(c => c.name === 'replytrack_transcript');
  assert(transcriptCalls.every(c => !JSON.stringify(c.data).includes('010-1234')));
  ai.hold('replytrack_analysis');
  await page.locator('#review-form button[type=submit]').click();
  await page.locator('#app [data-progress]').filter({ hasText: '질문·답변·약속 분석 중' }).waitFor();
  await clickCancel(); ai.release();
  assert.equal(app.store.list().length, 1);
  let record = app.store.get(app.store.list()[0].id);
  assert(record.messages.length > 0); assert.equal(record.questions.length, 0);
  await page.locator('[data-action="analyze"]').first().click(); await idle();
  record = app.store.get(record.id); assert(record.questions.length > 0);
  results.push('Masking preview before any AI call; read cancellation preserves text; cancelled first analysis preserves saved messages; retry succeeds');

  await page.locator('[data-action="tab"][data-value="drafts"]').click();
  await page.locator('[data-action="generate-draft"][data-kind="followup"]').click(); await idle();
  await page.locator('#draft-followup').fill('내가 수정하고 저장한 재문의 초안');
  await page.locator('[data-action="save-draft"][data-kind="followup"]').click(); await idle();
  const prior = app.store.get(record.id);
  await page.locator('#draft-followup').fill('저장 전 편집 중인 재문의 초안도 유지');
  ai.hold('replytrack_draft_review');
  await page.locator('[data-action="generate-draft"][data-kind="followup"]').click();
  await modal.locator('[data-action="guard-continue"]').click();
  await page.locator('#app [data-progress]').filter({ hasText: '초안 의미·누락 검토 중' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, 'draft-progress-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await clickCancel(); ai.release();
  assert.equal(await page.locator('#draft-followup').inputValue(), '저장 전 편집 중인 재문의 초안도 유지');
  assert.deepEqual(app.store.get(record.id), prior);
  results.push('Draft semantic-review cancellation preserves DB, saved draft and unsaved editor text; 390px layout has no horizontal overflow');

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: '새 답변 추가', exact: true }).click(); await modal.locator('[data-action="guard-continue"]').click();
  await page.locator('#append-form [name=text]').fill('전화번호 010-8765-4321로 배송 관련 안내를 드리겠습니다.');
  ai.hold('replytrack_analysis');
  await page.locator('#append-form button[type=submit]').click();
  await page.locator('#app [data-progress]').filter({ hasText: '질문·답변·약속 분석 중' }).waitFor();
  await clickCancel(); ai.release();
  const appended = app.store.get(record.id);
  assert.equal(appended.messages.length, prior.messages.length + 1);
  assert.deepEqual(appended.questions, prior.questions); assert.deepEqual(appended.promises, prior.promises); assert.deepEqual(appended.drafts, prior.drafts);
  assert(!appended.messages.at(-1).text.includes('010-8765'));
  assert.equal(await page.locator('#draft-followup').inputValue(), '저장 전 편집 중인 재문의 초안도 유지');
  assert.match(await page.locator('#draft-status-followup').innerText(), /이전 분석 기준/);
  results.push('Appended input persists masked; cancellation preserves previous questions, promises, drafts and unsaved editor text');

  // Render a synthetic image locally, then exercise the real bundled Korean/English OCR.
  const imagePage = await browser.newPage({ viewport: { width: 1200, height: 350 } });
  await imagePage.setContent('<html lang="ko"><meta charset="UTF-8"><body style="font:32px Malgun Gothic,sans-serif;background:white;color:black;padding:25px"><p>고객: 배송은 언제 되나요?</p><p>전화: 010-1234-5678</p><p>주소: 서울특별시 강남구 테헤란로 123</p></body></html>');
  const imagePath = resolve(artifacts, 'synthetic-private-chat.png'); await imagePage.screenshot({ path: imagePath }); await imagePage.close();
  await page.locator('.sidebar [data-action="new"]').click(); await modal.locator('[data-action="guard-continue"]').click();
  await page.locator('#import-form [name=title]').fill('로컬 캡처 테스트');
  await page.locator('.capture-options > summary').click();
  await page.locator('#import-form [name=image]').setInputFiles(imagePath);
  await page.locator('#import-form [name=text]').fill('추가 입력도 취소 후 보존');
  await page.locator('#import-form button[type=submit]').click();
  await modal.locator('[data-action="cancel-operation"]').waitFor();
  await clickCancel();
  assert.equal(await page.locator('#import-form [name=text]').inputValue(), '추가 입력도 취소 후 보존');
  assert.equal(await page.locator('#import-form [name=image]').evaluate(input => input.files.length), 1);
  const beforeOcr = ai.calls.length;
  await page.locator('#import-form button[type=submit]').click(); await idle();
  const ocrText = await page.locator('#privacy-form [name=text]').inputValue();
  assert.match(ocrText, /전화번호_/); assert.match(ocrText, /주소_/);
  assert(!ocrText.includes('010-1234')); assert(!ocrText.includes('테헤란로'));
  assert.equal(ai.calls.length, beforeOcr);
  await page.screenshot({ path: resolve(artifacts, 'privacy-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, 'privacy-mobile.png'), fullPage: true });
  assert(await modal.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth));
  results.push('Real local Korean/English OCR masks synthetic phone/address; cancelling OCR preserves text and selected file; no external browser requests');
  assert.deepEqual(outbound, []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts, 'results.json'), JSON.stringify({ results, errors, outbound }, null, 2));
  console.log(JSON.stringify({ checks: results.length, results, errors }, null, 2));
} finally {
  ai.release?.(); app.operations.close(); await browser?.close();
  await new Promise(resolve => app.server.close(resolve)); app.store.close();
}
