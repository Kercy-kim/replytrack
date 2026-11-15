// Synthetic local records, real Chrome, no paid AI and no user database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const dir = '.artifacts/inquiry-workspace'; await mkdir(dir, { recursive: true });
let aiCalls = 0;
const app = createApp({ store: new CaseStore(':memory:'), ai: { async structured() { aiCalls++; throw Error('Unexpected AI call'); } } });
const refund = app.service.demo({ scenario: 'refund' });
const waiting = app.service.demo();
waiting.questions = waiting.questions.filter(q => q.status === 'waiting');
waiting.nextActions = { messageIds: waiting.messages.map(m => m.id), items: [] };
app.store.save(waiting, waiting.version);
const archived = app.service.demo(); archived.archivedAt = new Date().toISOString(); archived.title = '보관한 가상 문의'; app.store.save(archived, archived.version);
const pending = app.service.create({ title: '가상 계정 접근 문의', company: 'Example Support', channel: 'email', messages: [{ role: 'customer', text: '영수증의 거래번호로 본인 확인을 하고 싶어요. <img src=x onerror=alert(1)>' }] });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(10000); const errors = []; page.on('pageerror', e => errors.push(e.message));
const idle = () => page.waitForFunction(() => !document.querySelector('.busy-bar'));
const fits = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
try {
  await page.goto(`${origin}/?case=${refund.id}`); await page.locator('.inquiry-overview').waitFor();
  assert.match(await page.locator('.inquiry-overview').innerText(), /수행·확인할 요청 1개/);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await fits();
    await page.screenshot({ path: `${dir}/inquiry-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action=inquiry-section][data-value=questions]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#question-filter').inputValue(), 'followup'); assert.equal(await page.locator('.question-card').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'inquiry-questions');
  await page.locator('[data-action=inquiry-section][data-value=waiting]').click();
  assert.equal(await page.locator('#question-filter').inputValue(), 'waiting'); assert.equal(await page.locator('.question-card').count(), 1);
  assert.match(await page.locator('.question-card').innerText(), /답변 대기/);
  await page.locator('[data-action=inquiry-section][data-value=actions]').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'next-actions-title');
  // A summary shortcut is local to its inquiry, not a global filter for the next one.
  await page.locator('[data-action=inquiry-section][data-value=waiting]').click();
  await page.locator(`.sidebar [data-action=open][data-id="${waiting.id}"]`).click(); await idle();
  assert.equal(await page.locator('#question-filter').inputValue(), 'all', 'Another inquiry must start with all its questions');
  await page.locator(`.sidebar [data-action=open][data-id="${refund.id}"]`).click(); await idle();
  assert.equal(await page.locator('.question-card').count(), refund.questions.length);
  await page.locator('[data-action=inquiry-section][data-value=waiting]').click();
  await page.locator(`.sidebar [data-action=open][data-id="${refund.id}"]`).click(); await idle();
  assert.equal(await page.locator('#question-filter').inputValue(), 'waiting', 'Refreshing the same inquiry preserves its filter');
  await page.locator('[data-action=demo-next]').click(); await idle();
  assert.match(await page.locator('.inquiry-overview').innerText(), /추가로 확인할 질문 없음/);
  await page.locator('[data-action=inquiry-section][data-value=questions]').click();
  assert.equal(await page.locator('.question-card').count(), 0);
  assert.match(await page.locator('#inquiry-questions').innerText(), /재문의·확인할 질문이 없어요/);
  assert.doesNotMatch(await page.locator('#inquiry-questions').innerText(), /모든 질문에 답변을 받았어요/);
  await page.locator('.workspace-home').click(); await idle();
  assert.equal(await page.locator('.workspace-row').count(), 3);
  assert.equal(await page.locator('.inquiry-preview img').count(), 0, 'User text must be escaped');
  await page.locator('#case-search').fill('거래번호'); assert.equal(await page.locator('.workspace-row').count(), 1);
  assert.match(await page.locator('.workspace-row').innerText(), /가상 계정 접근 문의/);
  await page.locator('#case-search').fill('');
  await page.locator('[data-action=case-filter][data-value=waiting]').click(); assert.equal(await page.locator('.workspace-row').count(), 2);
  await page.locator('[data-action=case-filter][data-value=analysis]').click(); assert.equal(await page.locator('.workspace-row').count(), 1);
  await page.locator(`[data-action=open][data-id="${pending.id}"]`).last().click(); await idle();
  assert.match(await page.locator('.inquiry-overview').innerText(), /대화 정리 필요/);
  assert.doesNotMatch(await page.locator('.inquiry-overview').innerText(), /해결 완료/);
  await page.locator('.workspace-home').click(); await idle();
  await page.locator('[data-action=case-filter][data-value=archived]').click(); assert.equal(await page.locator('.workspace-row').count(), 1);
  await page.locator('[data-action=case-filter][data-value=active]').click();
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await fits();
    await page.screenshot({ path: `${dir}/inbox-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []); assert.equal(aiCalls, 0);
  await writeFile(`${dir}/result.json`, JSON.stringify({ passed: true, widths: [320, 390, 768, 1280], aiCalls, errors, checks: ['individual inquiry overview', 'keyboard focus and jumps', 'waiting versus followup', 'new reply update', 'empty filtered result is not all answered', 'inquiry content search', 'safe preview', 'archived isolation', 'unanalyzed source', 'responsive layout'] }, null, 2));
  console.log('Inquiry workspace passed: overview, navigation, reply update, search, filters, safety and 4 viewport widths.');
} finally { await browser.close(); await new Promise(r => app.server.close(r)); app.store.close(); }
