import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const dir = '.artifacts/presentation'; await mkdir(dir, { recursive: true });
let calls = 0;
const app = createApp({ store: new CaseStore(':memory:'), ai: { async structured() { calls++; throw Error('Replay must not call AI'); } } });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base);
  await page.locator('.welcome').waitFor();
  assert.equal(await page.locator('a[href="/presentation"]').count(), 0);
  await page.goto(base + '/presentation'); await page.locator('#scene').waitFor();
  for (let step = 0; step < 4; step++) {
    await page.locator(`[data-action=step][data-step="${step}"]`).click();
    assert.match(await page.locator('.result-disclosure').innerText(), /실제 OpenAI.*지금 API를 호출하지 않음/);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${dir}/desktop-${step}.png`, fullPage: true });
    const box = await page.locator('.result-controls').boundingBox(); assert(box.y + box.height <= 720, `Scene ${step} controls outside 720p viewport`);
    if (step === 1) { await page.locator('summary').first().click(); assert.match(await page.locator('blockquote').first().innerText(), /transaction ID/); await page.locator('summary').first().click(); }
    if (step === 2) { assert((await page.locator('#replay-draft').inputValue()).length > 20); await page.locator('[data-action=copy]').click(); await page.waitForFunction(() => document.querySelector('#presentation-status').textContent.includes('복사')); }
    if (step === 3) assert.match(await page.locator('.result-scene').innerText(), /부분 답변[\s\S]*답변 받음[\s\S]*업체 수신 안내/);
    await page.screenshot({ path: `${dir}/desktop-${step}.png`, fullPage: true });
  }
  await page.locator('[data-action=start]').click(); await page.keyboard.press('ArrowRight'); assert.equal(await page.locator('[aria-current=step]').getAttribute('data-step'), '1');
  await page.locator('.result-proof summary').click(); assert.match(await page.locator('.result-proof').innerText(), /SHA-256/);
  await page.reload(); await page.locator('#scene').waitFor(); assert.equal(await page.locator('[aria-current=step]').getAttribute('data-step'), '0');
  await page.setViewportSize({ width: 390, height: 844 });
  for (let step = 0; step < 4; step++) { await page.locator(`[data-step="${step}"]`).click(); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  // A failed result download must expose a retry, with no fabricated substitute.
  await page.route('**/presentation-data.json', route => route.fulfill({ status: 503, body: '{}' }));
  await page.reload(); await page.getByRole('button', { name: '다시 불러오기' }).waitFor();
  assert.equal(await page.locator('#scene').count(), 0);
  await page.unroute('**/presentation-data.json'); await page.getByRole('button', { name: '다시 불러오기' }).click(); await page.locator('#scene').waitFor();
  assert.equal(calls, 0); assert.deepEqual(app.store.list(), []); assert.deepEqual(errors, []);
  await writeFile(`${dir}/result.json`, JSON.stringify({ passed: true, viewports: [1280, 390], scenes: 4, aiCalls: calls, recordsCreated: 0, errors }, null, 2));
  console.log('Actual-result replay passed: provenance, four scenes, 720p, mobile, copy, keyboard, retry; zero AI calls and writes.');
} finally { await browser.close(); await new Promise(r => app.server.close(r)); app.store.close(); }
