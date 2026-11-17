// Real Chrome + live first-party pages + real OpenAI. Synthetic inquiries only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApp } from '../server.mjs';
import { CaseStore } from '../src/store.mjs';
import { OfficialContext, officialKey } from '../src/official-context.mjs';
import { OpenAIClient } from '../src/openai.mjs';
assert(process.argv.includes('--run')); process.loadEnvFile('.env');
const out=process.env.OFFICIAL_WEB_REPORT; assert(out && !existsSync(out), 'Use a new OFFICIAL_WEB_REPORT path');
const artifact='.artifacts/official-live/'+new Date().toISOString().replace(/[:.]/g,'-'); mkdirSync(artifact,{recursive:true});
const report={at:new Date().toISOString(),artifact,scope:'Official guidance in actual Chrome. Saved inquiry analyses are fixtures; all official retrieval/generation/reviews are live.',cases:[],errors:[],hashes:Object.fromEntries(['src/official-context.mjs','public/official-context.js','public/app.js', 'scripts/check-official-live.mjs'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
const save=()=>writeFileSync(out,JSON.stringify(report,null,2));
let active;
const client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:'gpt-5-mini-2025-08-07'});
const ai={configured:true,supportsWebSearch:true,model:client.model,async structured(args){const start=Date.now();const r=await client.structured(args);active.calls.push({name:args.name,ms:Date.now()-start,data:r.data,usage:r.usage});save();return r;}};
const official=new OfficialContext({ai});const sources=official.sources.bind(official);
official.sources=async(...args)=>{const rows=await sources(...args);active.sources=rows.map(({body,...s})=>({...s,bodyHash:createHash('sha256').update(body).digest('hex'),bodyLength:body.length}));return rows;};
const store=new CaseStore(':memory:'), app=createApp({store,ai,official});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
const require=createRequire(import.meta.url),{chromium}=require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.REPLYTRACK_CHROMIUM,headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',e=>report.errors.push(e.message));
const cases=[
 ['searched-netflix','Netflix','넷플릭스를 해지하면 결제한 기간이 끝날 때까지 계속 시청할 수 있나요?','ready'],
 ['searched-unknown','구름토끼픽셀상점XYZ','구독 해지 후 남은 기간을 사용할 수 있나요?','omitted'],
];
const only=process.argv.find(x=>x.startsWith('--case='))?.slice(7);
const repeats=Number(process.argv.find(x=>x.startsWith('--repeat='))?.slice(9)||1);
assert(!only||cases.some(c=>c[0]===only));assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=3);
try {
  for(let iteration=1;iteration<=repeats;iteration++)for(const [name,company,text,expected,answer] of cases.filter(c=>!only||c[0]===only)){
    const id=repeats===1?name:`${name}-${iteration}`;
    active={id,company,text,answer,expected,calls:[],sources:[]};report.cases.push(active);const start=Date.now();
    let c=app.service.create({title:id,company,channel:'email',messages:[{role:'customer',text},...(answer?[{role:'agent',text:answer}]:[])]});
    c.analysis={model:'fixture'};c.analyzedMessageCount=c.messages.length;c.summary=text;c.drafts.followup={body:'My draft must stay unchanged.',language:'en',sourceMessageIds:[c.messages[0].id],createdAt:new Date().toISOString()};c=store.save(c,c.version);const before=structuredClone(c);
    try {
      const requested=page.waitForResponse(r=>r.url().endsWith(`/api/cases/${c.id}/official-context`) && r.request().method()==='POST');
      await page.goto(`${origin}/?case=${c.id}`);await page.locator('.case-heading').waitFor();await requested;
      assert.equal(await page.locator('.busy-bar').count(),0);
      await page.locator('[data-action=tab][data-value=drafts]').click();await page.locator('#draft-followup').fill('My unsaved edit is preserved.');
      const deadline=Date.now()+100000;
      while(!official.entries.get(officialKey(c)) && Date.now()<deadline && expected==='ready')await new Promise(r=>setTimeout(r,100));
      // Wait for browser POST even when the provider is unknown (no cache entry).
      await page.waitForFunction(()=>document.querySelector('#draft-followup')?.value==='My unsaved edit is preserved.');
      await official.entries.get(officialKey(c))?.done;
      active.result=official.start(c);active.ms=Date.now()-start;
      if(active.result.state==='loading'){await official.entries.get(officialKey(c)).done;active.result=official.start(c);}
      if(active.result.state==='ready'){
        await page.locator('.official-context').waitFor({timeout:10000});await page.locator('.official-context summary').click();
        active.display=await page.locator('.official-context').innerText();
        assert.equal(await page.locator('.official-context a').getAttribute('href'),active.result.items[0].url);
      }else assert.equal(await page.locator('.official-context').count(),0);
      assert.equal(await page.locator('#draft-followup').inputValue(),'My unsaved edit is preserved.');assert.deepEqual(store.get(c.id),before);
      for(const width of [390,1280]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${artifact}/${id}-${width}.png`,fullPage:true});}
      assert.equal(active.result.state,expected);active.passed=true;
    }catch(e){active.passed=false;active.error=e.message;}
    save();console.log(`${id}: ${active.result?.state} expected ${expected} ${active.passed?'PASS':'FAIL'} (${active.ms}ms)`);
    page.once('dialog',d=>d.accept());
  }
  report.passed=report.cases.every(c=>c.passed)&&report.errors.length===0;save();if(!report.passed)process.exitCode=1;
}finally{await browser.close();await new Promise(r=>app.server.close(r));store.close();}
