import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const dir = '.artifacts/email-demo'; await mkdir(dir, { recursive: true });
let calls = 0;
const app = createApp({ store: new CaseStore(':memory:'), ai: { async structured() { calls++; throw Error('Prepared demo must not call AI'); } } });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const idle = () => page.waitForFunction(() => !document.querySelector('.busy-bar'));
try {
  await page.goto(`http://127.0.0.1:${app.server.address().port}`);
  await page.locator('[data-action=email-demo]').click(); await idle();
  const started = performance.now();
  for (let step = 0; step < 4; step++) {
    assert.match(await page.locator('.demo-focus-disclosure').innerText(), /준비된 결과 · AI API 호출 없음/);
    await page.screenshot({ path: `${dir}/desktop-${step}.png`, fullPage: true });
    const footer = page.locator('.demo-focus footer');
    const box = await footer.boundingBox();
    assert(box.y >= 0 && box.y + box.height <= 900, `Stage ${step} footer must fit presentation viewport`);
    if (step === 0) await footer.locator('[data-action=email-demo-step]').click();
    if (step === 1) {
      assert.match(await page.locator('#email-demo-scene').innerText(), /거래번호|거래 번호/);
      assert.match(await page.locator('#email-demo-scene').innerText(), /비밀번호/);
      await footer.locator('[data-action=email-demo-step][data-step="2"]').click();
    }
    if (step === 2) {
      assert.match(await page.locator('#draft-followup').inputValue(), /How long/);
      await page.locator('[data-action=copy]').click();
      await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('복사'));
      await page.locator('[data-action=email-demo-reply]').click(); await idle();
    }
    if (step === 3) {
      assert.match(await page.locator('#analysis-changes').innerText(), /부분 답변/);
      assert.match(await page.locator('#analysis-changes').innerText(), /답변 받음/);
      assert.match(await page.locator('#email-demo-scene').innerText(), /아직 복구되지/);
      await page.locator('#analysis-changes [data-action=source]').first().click();
      assert.match(await page.locator('#modal').innerText(), /3 business days/);
      await page.locator('#modal [data-action=close-modal]').last().click();
    }
  }
  const traversalMs = Math.round(performance.now() - started);
  // Revisiting a scene must not append the prepared reply twice.
  await page.locator('.demo-focus-steps [data-step="2"]').click();
  await page.locator('[data-action=email-demo-reply]').click(); await idle();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  await page.locator('[data-action=email-demo-full]').click();
  assert.equal(await page.locator('[data-action=demo-next]').count(), 0);
  await page.reload(); await idle();
  assert.match(await page.locator('.demo-focus-disclosure').innerText(), /준비된 결과/);
  await page.locator('.demo-focus-steps [data-step="3"]').click();
  assert.match(await page.locator('#email-demo-scene').innerText(), /아직 복구되지/);
  assert.equal(calls, 0); assert.deepEqual(errors, []);
  await writeFile(`${dir}/result.json`, JSON.stringify({ passed: true, viewports: [1366, 390], scenes: 4, traversalMs, aiCalls: calls, errors, note: 'UI traversal only; not AI response time or narration duration' }, null, 2));
  console.log(`Four email demo scenes passed; UI traversal ${traversalMs} ms (not AI latency).`);
} finally { await browser.close(); await new Promise(r => app.server.close(r)); app.store.close(); }
