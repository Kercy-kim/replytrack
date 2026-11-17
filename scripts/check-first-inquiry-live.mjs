import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {CaseStore} from '../src/store.mjs';
import {OpenAIClient} from '../src/openai.mjs';
assert(process.argv.includes('--run'));process.loadEnvFile('.env');
const dir=process.env.FIRST_WEB_REPORT||'.artifacts/first-inquiry-web';await mkdir(dir,{recursive:true});
const report={at:new Date().toISOString(),errors:[],calls:[],checks:{},measurements:{}};
const save=()=>writeFile(dir+'/result.json',JSON.stringify(report,null,2));
const store=new CaseStore(':memory:'),client=new OpenAIClient({apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL||'gpt-5-mini'});
const ai={configured:true,supportsWebSearch:true,model:client.model,async structured(args){const start=Date.now();const r=await client.structured(args);report.calls.push({name:args.name,ms:Date.now()-start,data:r.data,usage:r.usage});await save();return r;}};
const app=createApp({store,ai});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const require=createRequire(import.meta.url),{chromium}=require(process.env.REPLYTRACK_PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.REPLYTRACK_CHROMIUM,headless:true});const page=await browser.newPage({viewport:{width:1366,height:1000}});page.setDefaultTimeout(240000);page.on('pageerror',e=>report.errors.push(e.message));
const idle=()=>page.waitForFunction(()=>!document.querySelector('.busy-bar'),null,{timeout:300000});
const measured=async(name,fn)=>{const t=Date.now();await fn();report.measurements[name]=Date.now()-t;console.log(name,report.measurements[name]);await save();};
let failure;
try{
 await page.goto(base);await page.locator('[data-action=first-inquiry]').first().click();await page.locator('#first-inquiry-form [name=company]').fill('Google');await page.locator('#first-inquiry-form [name=goal]').fill('비밀번호를 잊어서 계정에 로그인할 수 없어요. 계정 복구 방법과 준비할 내용을 알고 싶어요.');
 await page.screenshot({path:dir+'/input-desktop.png',fullPage:true});
 await measured('prepare',async()=>{await page.locator('#first-inquiry-form button[type=submit]').click();await idle();assert.equal(await page.locator('.error-banner').count(),0,await page.locator('.error-banner').allTextContents());await page.locator('#draft-first').waitFor();});
 let list=await (await page.request.get(base+'/api/cases')).json();assert.equal(list.length,1);const id=list[0].id;let c=store.get(id);assert.equal(c.firstInquiry.state,'preparing');assert.equal(c.messages.length,0);assert(c.firstInquiry.routes.length);report.plan=c.firstInquiry;report.checks.officialRoutes=true;
 for(const width of [1366,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:dir+`/prepare-${width}.png`,fullPage:true});}report.checks.responsive=true;
 await page.setViewportSize({width:1366,height:1000});
 await page.locator('#draft-first').fill('비밀번호를 잊어 로그인할 수 없습니다. 복구 방법과 복구에 걸리는 기간을 알려 주세요.');await page.locator('[data-action=save-draft][data-kind=first]').click();await idle();
 await page.reload();await page.locator('#draft-first').waitFor();assert((await page.locator('#draft-first').inputValue()).includes('복구에 걸리는 기간'));report.checks.savedUnsent=true;
 await page.locator('[data-action=first-sent]').click();assert.equal(store.get(id).messages.length,0);await page.locator('#first-sent-form input[type=checkbox]').check();
 await measured('sentAnalysis',async()=>{await page.locator('#first-sent-form button[type=submit]').click();await idle();await page.locator('.question-card').first().waitFor();});c=store.get(id);assert.equal(c.firstInquiry.state,'sent');assert.equal(c.messages.length,1);assert(c.analysis);assert(!c.drafts.first);report.checks.sentTransition=true;
 await page.locator('[data-action=append]').first().click();await page.locator('#append-form [name=text]').fill('계정 복구 페이지에서 화면의 질문에 답해 주세요. 복구에 걸리는 기간은 확인 후 안내드리겠습니다.');
 await measured('replyAnalysis',async()=>{await page.locator('#append-form button[type=submit]').click();await idle();await page.locator('#analysis-changes').waitFor();});c=store.get(id);assert.equal(c.messages.length,2);assert(c.questions.some(q=>q.status==='answered'));assert(c.questions.some(q=>q.status==='waiting'));report.questions=c.questions;report.checks.replyContinuesSameRecord=true;
 await page.locator('[data-action=tab][data-value=drafts]').click();await measured('followup',async()=>{await page.locator('[data-action=generate-draft][data-kind=followup]').click();await idle();await page.locator('#draft-followup').waitFor();});report.followup=await page.locator('#draft-followup').inputValue();assert(report.followup.length>10);report.checks.followup=true;
 await page.screenshot({path:dir+'/followup-desktop.png',fullPage:true});assert.deepEqual(report.errors,[]);report.passed=true;
}catch(e){failure=e;report.passed=false;report.failure=e.message;await page.screenshot({path:dir+'/failure.png',fullPage:true}).catch(()=>{});}
finally{await save();await browser.close();await new Promise(r=>app.server.close(r));store.close();}
console.log(JSON.stringify({passed:report.passed,checks:report.checks,measurements:report.measurements,failure:report.failure}));if(failure)throw failure;
