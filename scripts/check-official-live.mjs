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
const ai={configured:true,model:client.model,async structured(args){const start=Date.now();const r=await client.structured(args);active.calls.push({name:args.name,ms:Date.now()-start,data:r.data,usage:r.usage});save();return r;}};
const official=new OfficialContext({ai});const sources=official.sources.bind(official);
official.sources=async(...args)=>{const rows=await sources(...args);active.sources=rows.map(({body,...s})=>({...s,bodyHash:createHash('sha256').update(body).digest('hex'),bodyLength:body.length}));return rows;};
const store=new CaseStore(':memory:'), app=createApp({store,ai,official});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
const require=createRequire(import.meta.url),{chromium}=require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.REPLYTRACK_CHROMIUM,headless:true});const page=await browser.newPage({viewport:{width:1280,height:850}});page.on('pageerror',e=>report.errors.push(e.message));
const cases=[
  ['google-start','Google','개인 Google 계정 비밀번호를 잊어 로그인할 수 없습니다. 공식 복구 절차를 어디에서 시작하나요?','ready'],
  ['ms-personal','Microsoft','개인 Microsoft 계정 비밀번호를 잊었습니다. 계정 복구 양식에 어떤 정보를 준비해야 하나요?','ready'],
  ['apple-wait','Apple','Apple 계정 복구를 시작해 기다리고 있습니다. 고객센터에서 복구 대기 시간을 줄여줄 수 있나요?','ready'],
  ['ssg-card','SSG','SSG에서 신용카드로 결제한 일반 상품을 결제 다음 날 전체 취소했고 승인 완료입니다. 카드 환불 반영은 언제인가요?','ready'],
  ['unknown','Unknown Support','계정 복구에 어떤 자료가 필요한가요?','omitted'],
  ['wrong-topic','Google','Google Workspace 회사 계정의 이번 달 청구 금액이 잘못됐습니다. 청구 금액만 알고 싶습니다.','omitted'],
  ['personal-result','Apple','제 Apple 계정 복구가 11월 18일 오전 9시까지 끝나는지 확정해 주세요. 일반 복구 방법이나 대기 시간 단축은 묻지 않습니다.','omitted'],
  ['missing-conditions','SSG','취소한 주문의 환불이 내일 입금되는지 확정해 주세요. 결제수단, 취소 완료 여부, 상품 종류는 기억나지 않습니다.','omitted'],
  ['conflicting-answer','Apple','Apple 계정 복구 대기 중입니다. 고객센터가 대기 시간을 단축해 줄 수 있나요?','omitted','이 계정은 제가 오늘 대기 시간을 단축해 드릴 수 있다고 확답드립니다.'],
  ['wrong-account','Microsoft','회사 관리자가 소유한 조직 계정입니다. 개인 Microsoft 계정이 아닙니다. 회사 보안 정책에 따라 요구되는 복구 서류가 정확히 무엇인가요?','omitted'],
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
      const deadline=Date.now()+70000;
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
