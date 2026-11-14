// Optional browser integration check. No production credentials or disk database.
// REPLYTRACK_PLAYWRIGHT_MODULE: installed playwright module path (defaults to 'playwright').
// REPLYTRACK_CHROMIUM: extension-capable Chromium executable; or set PLAYWRIGHT_BROWSERS_PATH.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { extensionOrigin } from '../src/extension-access.mjs';
import { ExtensionFixtureAI, fixtureText } from '../tests/helpers/extension-fixture.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const shots = resolve('.impeccable/review/extension');
await mkdir(shots, { recursive: true });
const ai = new ExtensionFixtureAI();
const app = createApp({ store: new CaseStore(':memory:'), ai });
const sourceServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>가상 고객센터 — 확장 검증</title><body><h1>검증용 가상 상담</h1><p>이 문장은 선택하지 않습니다.</p><article id="conversation" style="white-space:pre-wrap">${fixtureText}</article><input id="other" value="선택하지 않은 입력"><p>테스트 응답이며 실제 AI를 호출하지 않습니다.</p></body></html>`);
});
const listen = (server, port) => new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
let context, panel;
const errors = [], results = [];
try {
  await listen(app.server, 3100); await listen(sourceServer, 0);
  context = await chromium.launchPersistentContext(resolve('.artifacts/extension-browser-profile'), {
    channel: 'chromium', executablePath: process.env.REPLYTRACK_CHROMIUM || undefined, headless: true,
    args: [`--disable-extensions-except=${resolve('extension')}`, `--load-extension=${resolve('extension')}`, '--enable-unsafe-extension-debugging'],
  });
  context.setDefaultTimeout(10000);
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(worker.url(), extensionOrigin + '/background.js');
  const source = context.pages()[0];
  await source.goto(`http://127.0.0.1:${sourceServer.address().port}`);
  await source.locator('#conversation').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const cdp = await context.newCDPSession(source);
  const browserCdp = await context.browser().newBrowserCDPSession();
  const { targetInfos: tabs } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }, { exclude: true }] });
  const targetInfo = tabs.find(tab => tab.url === source.url()) || tabs[0];
  await browserCdp.send('Extensions.triggerAction', { id: extensionOrigin.split('://')[1], targetId: targetInfo.targetId });
  await source.waitForTimeout(400);
  const captures = await worker.evaluate(() => chrome.storage.session.get(null));
  const capture = Object.entries(captures).find(([key]) => key.startsWith('capture:'))?.[1];
  assert.equal(capture?.text, fixtureText);
  results.push('Real Chrome action → selected page text → extension session; unselected text excluded');

  // Load the same extension page in a tab to drive DOM controls and capture fixed widths.
  // The real sidePanel opening above is separately checked through its target.
  const targets = await cdp.send('Target.getTargets');
  assert(targets.targetInfos.some(t => t.url === extensionOrigin + '/sidepanel.html'));
  panel = await context.newPage();
  panel.on('pageerror', error => errors.push(error.message));
  panel.on('console', message => { if (message.type() === 'error') console.log('Panel console:', message.text()); });
  await panel.setViewportSize({ width: 390, height: 900 });
  await panel.goto(extensionOrigin + '/sidepanel.html');
  await panel.locator('#connection').filter({ hasText: 'AI 연결됨' }).waitFor();
  await panel.locator('#raw').waitFor();
  assert.equal(await panel.locator('#raw').inputValue(), fixtureText);
  await panel.screenshot({ path: resolve(shots, 'input-390.png'), fullPage: true });
  await panel.locator('#title').fill('무선 청소기 A/S 상담');
  await panel.locator('#company').fill('가상 고객센터');
  await panel.setViewportSize({ width: 320, height: 900 });
  await panel.getByRole('button', { name: '대화 읽기', exact: true }).scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: '대화 읽기', exact: true }).focus();
  await panel.keyboard.press('Enter');
  await panel.locator('#analyze-form').waitFor();
  assert.equal(await panel.evaluate(() => document.activeElement.tagName), 'H1');
  assert(await panel.locator('h1').evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom < innerHeight));
  await panel.screenshot({ path: resolve(shots, 'review-320.png'), fullPage: true });
  assert.equal(await panel.locator('[data-field="role"]').count(), 2);
  await panel.locator('#role-0').selectOption('unknown');
  await panel.getByRole('button', { name: '확인한 대화 분석하기' }).click();
  await panel.locator('#feedback').filter({ hasText: '발화자' }).waitFor();
  await panel.locator('#role-0').selectOption('customer');
  ai.failAnalysis = true;
  await panel.getByRole('button', { name: '확인한 대화 분석하기' }).click();
  await panel.getByRole('button', { name: '저장한 원문 다시 분석' }).waitFor();
  assert.equal(app.store.list().length, 1);
  ai.failAnalysis = false;
  await panel.getByRole('button', { name: '저장한 원문 다시 분석' }).click();
  await panel.locator('.question').nth(2).waitFor();
  assert.equal(await panel.evaluate(() => document.activeElement.tagName), 'H1');
  assert.deepEqual(await panel.locator('.badge').allTextContents(), ['답변 대기', '답변 받음', '미답변']);
  await panel.locator('.question').first().locator('summary').click();
  await panel.locator('.question').first().locator('blockquote').first().waitFor();
  await panel.setViewportSize({ width: 390, height: 900 });
  await panel.screenshot({ path: resolve(shots, 'analysis-390.png'), fullPage: true });
  results.push('Speaker review blocks unknown role; failed analysis preserves one case; retry creates grounded results');
  await panel.locator('[name="question"]').first().uncheck();
  await panel.setViewportSize({ width: 320, height: 900 });
  await panel.getByRole('button', { name: '재문의 초안 만들기' }).click();
  await panel.locator('#draft').waitFor();
  assert.equal(await panel.evaluate(() => document.activeElement.id), 'draft');
  assert(await panel.locator('#draft').evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().bottom <= innerHeight));
  const draft = await panel.locator('#draft').inputValue();
  assert.match(draft, /배송비/); assert.doesNotMatch(draft, /견적을 언제/);
  let edited = draft + '\n확인 후 답변 부탁드립니다.';
  await panel.locator('#draft').fill(edited);
  await panel.getByRole('button', { name: '초안 복사', exact: true }).click();
  await panel.locator('#copy-status').filter({ hasText: '복사했어요' }).waitFor();
  await panel.locator('#draft').fill('');
  await panel.locator('#draft').press('ControlOrMeta+V');
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  await panel.reload();
  await panel.locator('#draft').waitFor();
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  assert.equal(await panel.locator('[name="question"]:checked').count(), 1);
  results.push('Selected-question draft, edit, real clipboard copy and panel reopen recovery');
  await panel.setViewportSize({ width: 320, height: 900 });
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.screenshot({ path: resolve(shots, 'draft-320.png'), fullPage: true });
  await panel.setViewportSize({ width: 480, height: 900 });
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.screenshot({ path: resolve(shots, 'draft-480.png'), fullPage: true });

  // A web edit must not erase a user's local draft or reset surviving question selections.
  let record = app.store.get(app.store.list()[0].id);
  record = app.service.question(record.id, record.questions[0].id, { version: record.version, status: 'review' });
  await panel.getByRole('button', { name: '새로고침', exact: true }).click();
  await panel.locator('.warning').filter({ hasText: '직접 편집한 초안은 그대로' }).waitFor();
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  assert.equal(await panel.locator('[name="question"]:checked').count(), 1);
  assert.equal(await panel.evaluate(() => document.activeElement.dataset.action), 'reload');
  await panel.setViewportSize({ width: 320, height: 900 });
  await panel.screenshot({ path: resolve(shots, 'stale-draft-320.png'), fullPage: true });
  record = app.service.append(record.id, { version: record.version, role: 'agent', text: '왕복 배송비는 업체에서 부담하며, 내일까지 견적을 안내하겠습니다.' });
  await panel.reload();
  await panel.getByRole('button', { name: '저장한 원문 다시 분석' }).waitFor();
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  await panel.getByRole('button', { name: '저장한 원문 다시 분석' }).click();
  await panel.waitForFunction(() => document.querySelector('#progress').hidden && !document.querySelector('[data-action="retry-analysis"]'));
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  assert.equal(await panel.locator('[name="question"]:checked').count(), 0);
  await panel.locator('[name="question"]').check();
  await panel.getByRole('button', { name: '선택한 질문으로 다시 작성' }).click();
  await panel.waitForFunction(() => document.querySelector('#progress').hidden);
  assert.notEqual(await panel.locator('#draft').inputValue(), edited);
  assert.equal(await panel.locator('.warning').filter({ hasText: '직접 편집한 초안은 그대로' }).count(), 0);
  edited = (await panel.locator('#draft').inputValue()) + '\n추가로 편집한 내용입니다.';
  await panel.locator('#draft').fill(edited);
  results.push('Dirty draft survives web edits, refresh, reopen and reanalysis; selections reconcile; explicit regeneration replaces draft');
  results.push('Keyboard at scrolled 320px submit focuses next stage; generated editor is focused and visible; same-stage refresh retains focus');

  const recordUrl = await panel.getByRole('link', { name: '웹에서 기록·수정' }).getAttribute('href');
  const web = await context.newPage(); await web.goto(recordUrl);
  await web.getByRole('heading', { name: '무선 청소기 A/S 상담', exact: true }).waitFor();
  results.push('Saved extension case opens in unchanged web interface');
  await source.bringToFront();
  await source.locator('#conversation').evaluate(el => { el.textContent = '나: 새 대화입니다.'; const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  await browserCdp.send('Extensions.triggerAction', { id: extensionOrigin.split('://')[1], targetId: targetInfo.targetId });
  await panel.locator('#capture-notice').waitFor({ state: 'visible' });
  assert.equal(await panel.locator('#draft').inputValue(), edited);
  results.push('New capture does not overwrite edited draft');
  await panel.getByRole('button', { name: '선택한 대화로 바꾸기' }).click();
  assert.equal(await panel.locator('#raw').inputValue(), '나: 새 대화입니다.');
  await panel.setViewportSize({ width: 390, height: 900 });
  await new Promise(resolve => app.server.close(resolve));
  await panel.getByRole('button', { name: '연결 확인', exact: true }).click();
  await panel.locator('#feedback').filter({ hasText: 'node server.mjs' }).waitFor();
  await panel.screenshot({ path: resolve(shots, 'offline-390.png'), fullPage: true });
  results.push('Offline server gives recovery instructions without clearing selected text');
  assert.deepEqual(errors, []);
  await writeFile(resolve('.artifacts/extension-browser-results.json'), JSON.stringify({ date: '2026-11-14', actualAI: false, results, errors }, null, 2));
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  console.log('Failed step:', error.message);
  console.log('Panel state:', await panel?.locator('body').innerText().catch(() => 'unavailable'));
  console.log('Page errors:', errors);
  throw error;
} finally {
  await context?.close();
  if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
  if (sourceServer.listening) await new Promise(resolve => sourceServer.close(resolve));
  app.store.close();
}
