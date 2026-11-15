// Real Chrome, delayed synthetic official responses. No API key or user database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OfficialContext } from '../src/official-context.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE||'playwright');
const dir='.artifacts/official-context';await mkdir(dir,{recursive:true});
const source={id:'s',title:'계정 복구 안내',url:'https://support.google.com/accounts/answer/7682439?hl=ko',checkedAt:'2026-11-15',body:'계정 복구 절차를 따라 소유자임을 확인해야 합니다.'};
let release,calls=0;
const ai={configured:true,model:'fixture',async structured(args){calls++;return {data:args.name.endsWith('_review')?{applicable:true,answersQuestion:true,grounded:true,conditionsPreserved:true,noConflict:true}:{items:[{sourceId:'s',quote:source.body,text:'계정 복구 절차에서 소유자 확인이 필요해요.'}]}};}};
const official=new OfficialContext({ai});official.sources=()=>new Promise(r=>release=()=>r([source]));
const store=new CaseStore(':memory:'),app=createApp({store,ai,official});
let c=app.service.create({title:'계정 복구 문의',company:'Google',channel:'email',messages:[{role:'customer',text:'계정 복구가 필요합니다.'}]});
c.analysis={model:'fixture'};c.analyzedMessageCount=1;c.summary='계정 복구 절차를 확인하는 문의입니다.';c.drafts.followup={body:'Please help me recover my account.',language:'en',createdAt:new Date().toISOString(),sourceMessageIds:[c.messages[0].id]};c=store.save(c,c.version);
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.REPLYTRACK_CHROMIUM,headless:true}),page=await browser.newPage({viewport:{width:1280,height:850}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(`${origin}/?case=${c.id}`);await page.locator('.case-heading').waitFor();
  assert.equal(await page.locator('.busy-bar').count(),0);assert.equal(await page.locator('.official-context').count(),0);assert.equal(await page.locator('[data-action=guide]').count(),0);
  await page.locator('[data-action=tab][data-value=drafts]').click();await page.locator('#draft-followup').fill('My edited draft stays here.');
  while(!release) await new Promise(r=>setTimeout(r,10));release();await page.locator('.official-context').waitFor({timeout:10000});
  assert.equal(await page.locator('#draft-followup').inputValue(),'My edited draft stays here.');assert.equal(await page.locator('.official-context').evaluate(e=>e.open),false);
  await page.locator('.official-context summary').click();assert.equal(await page.locator('.official-context a').getAttribute('href'),source.url);
  for(const width of [320,390,1280]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('.official-context').scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/official-${width}.png`,fullPage:true});}
  // A new unanalysed source invalidates optional advice immediately on reopening.
  app.service.appendEmail(c.id,{version:c.version,messages:[{role:'agent',text:'The account information has changed.'}]});
  page.on('dialog',dialog=>dialog.accept());await page.reload();await page.locator('.pending-banner').waitFor();assert.equal(await page.locator('.official-context').count(),0);
  assert.equal(calls,2);assert.deepEqual(errors,[]);await writeFile(`${dir}/result.json`,JSON.stringify({passed:true,widths:[320,390,1280],checks:['nonblocking lookup','preserved draft edits','official source link','collapsed optional content','stale guidance hidden','retired wizard absent'],calls,errors},null,2));console.log('Official context browser checks passed.');
}finally{await browser.close();await new Promise(r=>app.server.close(r));store.close();}
