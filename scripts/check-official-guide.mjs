// Browser acceptance: fake model responses, isolated DB, no API credentials or real customer data.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OfficialFaq } from '../src/official-guide.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE || 'playwright');
const out = resolve('.artifacts/official-guide'); await mkdir(out, { recursive: true });
let offline = false, valid = true, hold = false, generated = 0;
const checks = [], errors = [];
const ai = { configured: true, model: 'browser-fixture', structured: async p => {
  if (p.name === 'replytrack_connection') return { data: { ok: true } };
  if (p.name === 'replytrack_guide_intent') return { data: { intent: 'exchange' } };
  if (p.name === 'replytrack_guide_review') return { data: { valid, feedback: '' } };
  if (p.name === 'replytrack_guide') {
    generated++;
    if (hold) await new Promise((resolve, reject) => { p.signal.addEventListener('abort', () => reject(p.signal.reason), { once: true }); });
    const ref = p.data.evidence[0].id;
    return { data: { steps: [{ text: '상품 상세 페이지의 교환 조건을 확인해 주세요.', evidenceId: ref }], conditions: [{ text: '상품의 수령 시점과 상태에 따라 조건이 달라요.', evidenceId: ref }], unknowns: ['개별 주문의 교환 가능 여부는 고객센터에 확인해 주세요.'] }, model: 'browser-fixture' };
  }
  // Intentionally fail analysis after saving to verify the handoff source is still preserved.
  throw new Error('Fixture: analysis unavailable');
} };
const html = '<ul><li><a class="subject">질문 반품 / 교환 신청 시 주의사항이 있나요?</a><div class="content"><div class="answer">답변 상품을 받은 시점과 상품 상태에 따라 교환 조건이 달라집니다. 상품 상세 페이지의 조건과 예외를 먼저 확인해 주세요.</div></div></li></ul>';
const faq = new OfficialFaq({ fetchImpl: async () => { if (offline) throw Error('fixture offline'); return new Response(html, { headers: { 'Content-Type': 'text/html' } }); } });
const app = createApp({ store: new CaseStore(':memory:'), ai, faq });
await new Promise(r => app.server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${app.server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.REPLYTRACK_CHROMIUM || undefined, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(12000);
  const idle = () => page.waitForFunction(() => !document.querySelector('.busy-bar'));
  const submit = async () => { await page.locator('#guide-form button[type=submit]').click(); await idle(); };
  await page.goto(origin);
  await page.getByRole('button', { name: 'SSG 공식 안내 찾기', exact: true }).click();
  const goal = 'SSG에서 산 옷이 작아서 큰 사이즈로 바꾸고 싶어요.';
  await page.locator('#guide-goal').fill(goal); await submit();
  await page.locator('[data-guide-answer=reason]').selectOption('mind'); await submit();
  await page.locator('[data-guide-answer=received]').selectOption('week'); await submit();
  assert.match(await page.locator('.guide-result').innerText(), /공식 FAQ 실시간 검색/);
  assert.equal(await page.locator('#guide-goal').inputValue(), goal);
  await page.locator('.guide-steps summary').first().click();
  assert.match(await page.locator('.guide-steps blockquote').first().innerText(), /상품/);
  assert((await page.locator('.guide-steps a').first().getAttribute('href')).startsWith('https://www.ssg.com/'));
  await page.screenshot({ path: resolve(out, 'desktop.png'), fullPage: true });
  checks.push('Natural language input, two clarification steps, live provenance, source expansion');
  offline = true; await submit(); assert.match(await page.locator('.guide-result').innerText(), /검색 실패 · 확인된 자료 사용/);
  await page.locator('.guide-sources summary').click(); assert.match(await page.locator('.guide-sources').innerText(), /2026-11-15/);
  const prior = await page.locator('.guide-request').innerText();
  valid = false; await submit(); assert.match(await page.locator('.error-banner').innerText(), /검증하지 못했어요/); assert.equal(await page.locator('.guide-request').innerText(), prior);
  valid = true; hold = true;
  await page.locator('#guide-form button[type=submit]').click();
  await page.getByText('내 상황에 맞는 안내 작성 중', { exact: true }).waitFor();
  assert.match(await page.locator('[data-elapsed]').innerText(), /경과/);
  await page.getByRole('button', { name: '작업 취소', exact: true }).click(); await idle(); hold = false;
  assert.equal(await page.locator('#guide-goal').inputValue(), goal); assert.equal(await page.locator('.guide-request').innerText(), prior);
  checks.push('Search failure fallback/date, failed review retains result, elapsed/stages, cancellation preserves inputs/result');
  await page.locator('#guide-goal').fill(`${goal} 라벨은 있어요.`);
  assert.match(await page.locator('.guide-result').innerText(), /이전 입력/); assert(await page.locator('[data-action=guide-handoff]').isDisabled());
  await submit(); await page.locator('[data-guide-answer=reason]').selectOption('mind'); await submit(); await page.locator('[data-guide-answer=received]').selectOption('unknown'); await submit();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#guide-result-heading').scrollIntoViewIfNeeded(); await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
  await page.locator('[data-action=guide-handoff]').click();
  assert.equal(await page.locator('#review-rows .review-row').count(), 1);
  assert.equal(await page.locator('#review-rows [name=role]').inputValue(), 'customer');
  assert.match(await page.locator('#review-rows textarea').inputValue(), /모르겠어요/);
  assert(!(await page.locator('#review-rows textarea').inputValue()).includes('상품 상세 페이지'));
  await page.locator('#modal [data-action=close-modal]').click();
  assert(await page.locator('[data-action=guide-handoff]').isDisabled());
  await page.locator('.sidebar [data-action=new]').click();
  await page.locator('#review-form button[type=submit]').click(); await idle();
  const records = app.store.list(); assert.equal(records.length, 1);
  const saved = app.store.get(records[0].id); assert.equal(saved.messages.length, 1); assert.equal(saved.messages[0].role, 'customer'); assert.equal(saved.promises.length, 0);
  assert.equal(await page.locator('.guide-page').count(), 0);
  checks.push('Edited goal invalidates old result, mobile no overflow, handoff saves only user statement, pending onboarding protected');
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ mode: 'mock AI + mock FAQ, real browser/HTTP', checks, generated, errors }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks, artifacts: out }));
} finally {
  app.operations.close(); await browser?.close(); await new Promise(r => app.server.close(r)); app.store.close();
}
