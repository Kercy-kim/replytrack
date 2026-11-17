import test from 'node:test';
import assert from 'node:assert/strict';
import {CaseStore} from '../src/store.mjs';
import {ReplyTrack} from '../src/service.mjs';
import {prepareFirstInquiry,validateFirstPlan,firstInquiryInput,scopeFirstSources,omitUnsupportedGuidance} from '../src/first-inquiry.mjs';
import {firstInquiryPanel,firstInquiryMarkdown} from '../public/first-inquiry.js';
import {dirtyDraftKinds} from '../public/workspace.js';
const input={company:'Google',goal:'비밀번호를 잊어서 계정 복구가 필요합니다. 010-1234-5678',language:'ko',channel:'email'};
const source={id:'s1',url:'https://support.google.com/accounts/answer/7682439',title:'계정 복구 도움말',body:'조직 계정은 관리자에게 문의하세요. 비밀번호를 잊어버림 계정 복구 페이지에서 화면에 나오는 질문에 답하세요. 평소 사용하는 기기에서 시도하는 것이 좋습니다. 로그인할 때 사용하는 이메일 주소를 잊어버림 계정에 등록된 전체 이름을 준비하세요. 계정 및 비밀번호 복구 서비스에 주의하기 비밀번호를 공유하지 마세요.',checkedAt:'2026-11-17T01:00:00Z'};
const plan=()=>({title:'계정 복구 문의',routes:[{text:'공식 계정 복구 도움말에서 시작하세요.',sourceId:'s1',quote:'계정 복구 페이지에서 화면에 나오는 질문에 답하세요.'}],steps:[{text:'화면의 질문에 답하세요.',sourceId:'s1',quote:'화면에 나오는 질문에 답하세요.'}],preparations:[{text:'가능하면 평소 사용하는 기기를 사용하세요.',sourceId:'s1',quote:'평소 사용하는 기기에서 시도하는 것이 좋습니다.'}],clarifications:[],subject:'계정 복구 문의',body:'비밀번호를 잊어 로그인할 수 없습니다. 복구 방법을 안내해 주세요.'});
const review={officialGrounded:true,conditionsPreserved:true,draftFaithful:true,safe:true,feedback:''};
function setup(overrides={}){const store=new CaseStore(':memory:'),calls=[];const ai={configured:true,async structured(args){calls.push(args);return {data:args.name.endsWith('_review')?{...review,...overrides}:plan(),model:'fixture'};}};return {store,calls,service:new ReplyTrack(store,ai)};}
const options={loadSources:async()=>[source]};
test('first inquiry stays unsent, masked, saved, editable and visible in personal summaries',async()=>{
 const {service,store,calls}=setup();try{let c=await prepareFirstInquiry(service,input,{},options);assert.equal(c.messages.length,0);assert.equal(c.analysis,null);assert.equal(c.firstInquiry.state,'preparing');assert.equal(calls.length,2);assert(!JSON.stringify(calls).includes('010-1234-5678'));assert(store.list()[0].overview.preparing);assert(store.list()[0].preview.includes('계정 복구'));assert(!store.list()[0].pendingAnalysis);
 const edited='실제로 보내고 싶은 첫 문의입니다.';c=service.saveDraft(c.id,'first',{version:c.version,body:edited});assert.equal(c.drafts.first.editedBody,edited);assert.equal(c.messages.length,0);assert.deepEqual(dirtyDraftKinds(c.drafts,{first:edited}),[]);
 assert.throws(()=>service.append(c.id,{version:c.version,role:'agent',text:'답변'}),/보낸 첫 문의/);await assert.rejects(service.analyze(c.id,c.version),/보낸 첫 문의/);
 assert.throws(()=>service.metadata(c.id,{version:c.version,company:'다른 회사'}),/다시 준비/);
 assert(firstInquiryMarkdown(c).includes('아직 보내지 않은'));
 }finally{store.close();}
});
test('only confirmed sent text becomes source; duplicate confirmation and stale versions fail',async()=>{
 const {service,store}=setup();try{let c=await prepareFirstInquiry(service,input,{},options);const old=c.version;c=service.firstSent(c.id,{version:old,body:'실제로 보낸 내용만 기록합니다.',sentAt:null});assert.equal(c.messages.length,1);assert.equal(c.messages[0].role,'customer');assert.equal(c.firstInquiry.state,'sent');assert.equal(c.drafts.first,undefined);assert.equal(c.questions.length,0);assert.equal(c.analysis,null);
 assert.throws(()=>service.firstSent(c.id,{version:old,body:'중복'}),/변경/);assert.throws(()=>service.firstSent(c.id,{version:c.version,body:'중복'}),/이미/);
 c=service.appendEmail(c.id,{version:c.version,messages:[{role:'agent',text:'복구 절차를 알려 드립니다.'}]});assert.equal(c.messages.length,2);assert.equal(c.messages[0].text,'실제로 보낸 내용만 기록합니다.');assert(store.list()[0].pendingAnalysis);
 }finally{store.close();}
});
test('refining reuses the same inquiry and rejects a stale version before spending tokens',async()=>{
 const {service,store,calls}=setup();try{let c=await prepareFirstInquiry(service,input,{},options);const id=c.id;c=service.metadata(id,{version:c.version,archived:true});const archivedAt=c.archivedAt;c=await prepareFirstInquiry(service,{...input,goal:'추가 조건이 있습니다.',caseId:id,version:c.version},{},options);assert.equal(c.id,id);assert.equal(c.archivedAt,archivedAt);assert.equal(store.list().length,1);assert.equal(c.firstInquiry.goal,'추가 조건이 있습니다.');const n=calls.length;await assert.rejects(prepareFirstInquiry(service,{...input,caseId:id,version:1},{},options),/변경/);assert.equal(calls.length,n);}finally{store.close();}
});
test('unverified guidance and false draft claims do not get saved',async()=>{
 const {service,store,calls}=setup({draftFaithful:false,feedback:'없는 첨부를 만들지 마세요.'});try{await assert.rejects(prepareFirstInquiry(service,input,{},options),/확인하지 못했어요/);assert.equal(store.list().length,0);assert.equal(calls.length,4);}finally{store.close();}
 const bad=plan();bad.routes[0].quote='원문에 없는 말입니다.';assert.throws(()=>validateFirstPlan(bad,[source]),/근거/);const link=plan();link.body='https://phishing.invalid 에 제출';assert.throws(()=>validateFirstPlan(link,[source]),/외부 주소/);
});
test('no sources can yield an honest draft without invented official guidance',async()=>{
 const {service,store}=setup();service.ai.structured=async args=>({data:args.name.endsWith('_review')?review:{...plan(),routes:[],steps:[],preparations:[],clarifications:['정확한 서비스 이름을 알려 주세요.']}});
 try{const c=await prepareFirstInquiry(service,input,{}, {loadSources:async()=>[]});assert.equal(c.firstInquiry.routes.length,0);assert(c.drafts.first.body);assert.equal(c.messages.length,0);const html=firstInquiryPanel(c,{esc:String,button:()=>'',date:String,edits:{},busy:false,dirty:false,status:'저장됨'});assert(html.includes('확인된 공식 문의 경로가 없어요'));assert(html.includes('필요 없다는 뜻은 아니에요'));}finally{store.close();}
});
test('cancellation after retrieval or review cannot create a record',async()=>{
 const {service,store}=setup();try{const controller=new AbortController();await assert.rejects(prepareFirstInquiry(service,input,{signal:controller.signal},{loadSources:async()=>{controller.abort();return [source];}}));assert.equal(store.list().length,0);
 const controller2=new AbortController(),original=service.ai.structured;service.ai.structured=async args=>{const r=await original(args);if(args.name.endsWith('_review'))controller2.abort();return r;};await assert.rejects(prepareFirstInquiry(service,input,{signal:controller2.signal},options));assert.equal(store.list().length,0);
 }finally{store.close();}
});
test('input validation prevents empty and oversized or unsupported preparation requests',()=>{
 for(const patch of [{company:''},{goal:'x'.repeat(2001)},{language:'fr'},{channel:'social'}])assert.throws(()=>firstInquiryInput({...input,...patch}));
});
test('curated recovery article keeps only the applicable section with global exceptions and fails closed on layout drift',()=>{
 const c={messages:[{text:'비밀번호를 잊었어요.'}]};const [s]=scopeFirstSources(c,[source]);assert(s.body.includes('조직 계정'));assert(s.body.includes('화면에 나오는 질문'));assert(s.body.includes('비밀번호를 공유하지'));assert(!s.body.includes('전체 이름'));assert.deepEqual(scopeFirstSources(c,[{...source,body:'Changed headings'}]),[]);
 assert.equal(scopeFirstSources({messages:[{text:'비밀번호와 이메일 주소를 잊었어요.'}]},[source])[0].body,source.body);
});
test('unverifiable quotes are omitted without inventing replacements or losing the draft',()=>{
 const p=plan();p.preparations.push({text:'확인되지 않은 준비물',sourceId:'s1',quote:'원문에 없는 인용입니다.'});const clean=omitUnsupportedGuidance(p,[source]);assert.equal(clean.preparations.length,1);assert.equal(clean.body,p.body);assert.equal(p.preparations.length,2);validateFirstPlan(clean,[source]);
 const joined=plan();joined.routes[0].quote='계정 복구 페이지에서 화면에';const sliced={...source,body:joined.routes[0].quote};const original={...source,body:'다른 원문'};assert.equal(omitUnsupportedGuidance(joined,[sliced],[original]).routes.length,0);
});
