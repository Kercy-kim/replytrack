// Browser UX regression using synthetic cases only. No paid AI or user database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const dir = '.artifacts/ux-refinement'; await mkdir(dir, { recursive: true });
let calls = 0;
const app = createApp({ store: new CaseStore(':memory:'), ai: { async structured() { calls++; throw Error('Demo must not call AI'); } } });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(10000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const idle = () => page.waitForFunction(() => !document.querySelector('.busy-bar'));
const fits = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
const widths = [320, 390, 768, 1280, 1440];
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('.welcome').waitFor();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 }); await fits();
    if (width <= 390) {
      assert((await page.locator('.sidebar').boundingBox()).height < 190, 'Mobile navigation stays compact');
      assert((await page.locator('.welcome-actions').boundingBox()).y < 700, 'First action is in the initial viewport');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/home-mobile.png`, fullPage: true });
  const extras = page.locator('.sidebar-extras');
  assert.equal(await extras.evaluate(el => el.open), false);
  await extras.locator('summary').focus(); await page.keyboard.press('Enter');
  assert(await page.locator('[data-action=email-demo]').isVisible());
  assert.equal(await page.locator('[data-action=guide]').count(), 0);
  assert(await page.locator('a[href="/presentation"]').isVisible());
  await page.locator('.sidebar [data-action=demo]').click(); await idle();
  assert(await extras.evaluate(el => el.open), 'Menu state survives rerender');
  await extras.locator('summary').click();
  assert.equal(await page.locator('.heading-actions [data-action=delete]').count(), 0);
  assert.equal(await page.locator('.action-suggestions').evaluate(el => el.open), false);
  await page.locator('.action-suggestions > summary').click();
  await page.locator('#question-filter').selectOption('remaining');
  assert(await page.locator('.action-suggestions').evaluate(el => el.open), 'Expanded suggestions survive filtering');
  assert.equal(await page.locator('.question-card').count(), 2);
  await page.locator('#question-filter').selectOption('all');
  await page.locator('.action-suggestions > summary').click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 }); await fits();
    assert(Number(await page.locator('.reason').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 15);
    assert(Number(await page.locator('.question-card h3').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 16);
    await page.screenshot({ path: `${dir}/case-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action=mobile][data-value=source]').click();
  assert.equal(await page.locator('[data-action=mobile][data-value=source]').getAttribute('aria-pressed'), 'true');
  assert(Number(await page.locator('.message-text').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))) >= 15);
  await page.locator('[data-action=mobile][data-value=analysis]').click();
  await page.locator('[data-action=tab][data-value=drafts]').click();
  assert.equal(await page.locator('.handoff-section').count(), 0);
  await page.locator('[data-action=generate-draft][data-kind=followup]').click(); await idle();
  assert(await page.locator('#draft-followup').isVisible());
  await page.locator('#draft-followup').fill('직접 편집한 답장 내용 유지');
  assert.match(await page.locator('#draft-scope').innerText(), /초안 생성에 사용한 질문/);
  const choice=page.locator('[name=draft-question]').first();await choice.uncheck();
  assert.match(await page.locator('#draft-scope').innerText(), /달라요/);
  assert.equal(await page.locator('#draft-followup').inputValue(), '직접 편집한 답장 내용 유지');
  await page.screenshot({path:`${dir}/draft-scope-390.png`,fullPage:true});
  await choice.check();assert.equal(await page.locator('#draft-scope .warning-note').count(),0);
  await page.locator('[data-action=tab][data-value=questions]').click();
  await page.locator('[data-action=tab][data-value=drafts]').click();
  assert.equal(await page.locator('#draft-followup').inputValue(), '직접 편집한 답장 내용 유지');
  await page.locator('[data-action=save-draft][data-kind=followup]').click(); await idle();
  await page.locator('[data-action=case-settings]').click();
  await page.locator('#modal [data-action=delete]').click();
  assert(await page.locator('[data-action=delete-yes]').isVisible());
  await page.locator('#modal [data-action=close-modal]').last().click();
  assert.equal(app.store.list().length, 1, 'Cancel deletion retains case');
  await page.locator('[data-action=tab][data-value=questions]').click();
  for (let step = 0; step < 2; step++) {
    await page.locator('[data-action=demo-next]').click();
    if (step === 0) await page.locator('[data-action=guard-continue]').click();
    await idle();
  }
  assert.equal(app.store.get(app.store.list()[0].id).questions.filter(q => q.status !== 'answered').length, 0);
  assert.equal(await page.locator('.next-step').count(), 0, 'No unnecessary follow-up CTA after all answers');
  assert(await page.locator('.promise-section').isVisible(), 'Real outcome confirmation remains');
  await page.locator('.sidebar [data-action=new]').click();
  assert.equal(await page.locator('.capture-options').evaluate(el => el.open), false);
  await page.locator('[name=channel]').selectOption('email');
  assert.match(await page.locator('#import-form [name=text]').getAttribute('placeholder'), /From:/);
  await page.locator('#import-form [name=title]').fill('계정 복구 문의');
  await page.locator('#import-form [name=text]').fill('From: me@example.test\nPlease help recover my account.');
  await page.locator('.capture-options > summary').click();
  assert(await page.locator('[name=ocrLanguage]').isVisible());
  await page.locator('#modal [data-action=close-modal]').first().click();
  await page.locator('.sidebar [data-action=new]').click();
  assert.match(await page.locator('#import-form [name=text]').inputValue(), /recover my account/);
  await fits();
  await page.screenshot({ path: `${dir}/input-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${dir}/input-desktop.png`, fullPage: true });
  assert.equal(calls, 0); assert.deepEqual(errors, []);
  await writeFile(`${dir}/result.json`, JSON.stringify({ passed: true, widths, errors, paidApiCalls: calls, checks: ['compact navigation', 'keyboard disclosure', 'preserved disclosure state', 'readable questions and source', 'mobile view semantics', 'follow-up edits preserved; handoff generation removed', 'delete cancel', 'answered follow-up hidden', 'email input retained'] }, null, 2));
  console.log('UI refinement passed: 5 viewport widths, keyboard menus, preserved edits, optional tools, deletion cancel and answered-case actions.');
} finally { await browser.close(); await new Promise(r => app.server.close(r)); app.store.close(); }
