import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE||'playwright');
const dir='.artifacts/reading-flow';await mkdir(dir,{recursive:true});
let calls=0;const app=createApp({store:new CaseStore(':memory:'),ai:{configured:false,async structured(){calls++;throw Error('Unexpected AI');}}});
const demo=app.service.demo({scenario:'refund'});
let empty=app.service.create({title:'질문 없는 분석 결과',company:'가상 업체',messages:[{role:'customer',text:'안녕하세요.'}]});
empty.analysis={model:'fixture'};empty.analyzedMessageCount=1;empty=app.store.save(empty,empty.version);
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.REPLYTRACK_CHROMIUM,headless:true});const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const idle=()=>page.waitForFunction(()=>!document.querySelector('.busy-bar'));
const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
try {
  await page.goto(`${base}/?case=${demo.id}`);await page.locator('.question-card').first().waitFor();
  // A shortcut from the bottom of a long inquiry must land on the reply form.
  await page.locator('[data-action=draft-tab]').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'panel-drafts');
  const draftTop=await page.locator('#panel-drafts').evaluate(el=>el.getBoundingClientRect().top);
  await page.screenshot({path:`${dir}/reply-shortcut-390.png`});
  const draftBottom=await page.locator('#panel-drafts').evaluate(el=>el.getBoundingClientRect().bottom);
  assert(draftTop>=0&&(draftTop<150||draftBottom<=844),`Reply form must be visible; a short form may stop at the document bottom: ${draftTop}, ${draftBottom}`);
  await page.locator('[data-action=tab][data-value=questions]').click();
  await page.locator('.action-suggestions > summary').click();
  const shortcut=page.locator('[data-action=action-followup]').first(),selected=await shortcut.getAttribute('data-id');
  await shortcut.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'panel-drafts');
  assert.deepEqual(await page.locator('[name=draft-question]:checked').evaluateAll(es=>es.map(e=>e.value)),[selected]);
  await page.locator('[data-action=tab][data-value=questions]').click();
  // Same message can support several questions. Return to the exact clicked button.
  const quote=page.locator('.question-card .quote').nth(1),text=await quote.innerText();await quote.focus();await page.keyboard.press('Enter');
  assert.match(await page.evaluate(()=>document.activeElement.id),/^message-/);
  await page.locator('[data-action=source-return]').click();assert.equal(await page.evaluate(()=>document.activeElement.innerText),text);
  assert.equal(await page.locator('[data-action=mobile][data-value=analysis]').getAttribute('aria-pressed'),'true');
  await page.locator('#question-filter').selectOption('waiting');await page.locator('.question-card .quote').first().click();
  await page.screenshot({path:`${dir}/source-390.png`,fullPage:true});
  await page.locator('[data-action=source-return]').click();assert.equal(await page.locator('#question-filter').inputValue(),'waiting');
  await page.locator('[data-action=tab][data-value=drafts]').click();await page.locator('[data-action=generate-draft]').click();await idle();
  await page.locator('#draft-followup').fill('작성 중인 답장 보존');
  await page.locator('.draft-sources summary').first().click();await page.locator('.draft-sources [data-action=source]').last().click();
  await page.locator('[data-action=source-return]').click();assert.equal(await page.locator('#draft-followup').inputValue(),'작성 중인 답장 보존');
  assert.equal(await page.locator('.draft-sources').first().evaluate(e=>e.open),true);assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'source');
  await page.locator('[data-action=save-draft]').click();await idle();
  // No claims of all questions answered when there were no extracted questions.
  await page.goto(`${base}/?case=${empty.id}`);await page.locator('.empty-panel').waitFor();assert.match(await page.locator('.empty-panel').innerText(),/찾지 못했어요/);assert.equal(await page.locator('[data-action=analyze]').count(),0);
  await page.locator('[data-action=tab][data-value=drafts]').click();assert.match(await page.locator('.question-choices').innerText(),/분석된 질문이 없어요/);assert.doesNotMatch(await page.locator('.question-choices').innerText(),/모든 질문에 답변/);
  assert.equal(await page.locator('[data-action=source-return]').count(),0);
  await page.locator('.sidebar [data-action=new]').click();await page.locator('.capture-options summary').click();
  const reading=await page.locator('.modal .form-note').first().evaluate(e=>{const s=getComputedStyle(e);return {font:parseFloat(s.fontSize),color:s.color,background:getComputedStyle(e.closest('.modal')).backgroundColor};});assert(reading.font>=14);
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});assert(await fits());assert(await page.locator('#modal').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.locator('#modal').evaluate(e=>e.scrollTop=0);await page.screenshot({path:`${dir}/input-${width}.png`});}
  // Text enlargement at a narrow viewport must not hide the form actions.
  await page.setViewportSize({width:390,height:844});
  await page.route('**/styles.css',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\np, label, button, input, select, textarea { font-size: 28px !important; }'});});
  await page.reload();await page.locator('.sidebar [data-action=new]').click();await page.locator('.capture-options summary').click();assert(await fits());assert(await page.locator('#modal').evaluate(e=>e.scrollWidth<=e.clientWidth));
  await page.locator('.modal-actions').scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/input-large-text.png`});
  assert.equal(calls,0);assert.deepEqual(errors,[]);await writeFile(`${dir}/result.json`,JSON.stringify({passed:true,checks:['exact source round trip','keyboard and reduced motion','filter preservation','edited draft and disclosure preservation','empty analyzed state','input readability','320–1280px layouts','28px text stress with reachable actions'],reading,errors,paidCalls:calls},null,2));console.log('Reading-flow checks passed.');
}finally{await browser.close();await new Promise(r=>app.server.close(r));app.store.close();}
