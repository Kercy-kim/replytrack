// Opt-in integration check. Requires a running server with an API key configured.
// Uses synthetic conversations only and incurs provider API usage.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const base = process.env.REPLYTRACK_URL || 'http://127.0.0.1:3100';
const request = async (path, data) => {
  const res = await fetch(base + path, {method:data ? 'POST' : 'GET',headers:{'Content-Type':'application/json'},body:data ? JSON.stringify(data) : undefined});
  const result = await res.json();
  if (!res.ok) throw new Error(`${path}: ${result.code} ${result.error}`);
  return result;
};
const customer='안녕하세요. 무선 청소기가 고장났습니다. 수리비는 얼마인가요? 입고 후 수리는 며칠 걸리나요? 왕복 배송비는 누가 부담하나요?';
const agent='입고 후 수리는 3~5영업일 정도 소요되며, 수리비는 점검 후 안내하겠습니다.';
const results={at:new Date().toISOString(),checks:[]};
try {
  const config=await request('/api/config'); assert(config.configured,'Configure API key in the running server first.');
  results.model=config.model;
  const input=process.argv.includes('--image')
    ? {image:`data:image/png;base64,${readFileSync('.artifacts/synthetic-chat.png').toString('base64')}`}
    : {text:`나: ${customer}\n고객센터: ${agent}`};
  const transcript=await request('/api/extract',input);
  assert(transcript.messages.some(m=>m.role==='customer')); assert(transcript.messages.some(m=>m.role==='agent'));
  results.checks.push({name:input.image?'vision transcription':'text transcription',messages:transcript.messages.length});
  console.log('PASS transcription:',transcript.messages.length,'messages');
  if (input.image) {
    assert(transcript.messages.some(m=>m.text.includes('배송비'))); assert(transcript.messages.some(m=>m.text.includes('점검')));
    results.transcript=transcript;
  } else {
    let c=await request('/api/cases',{title:'실제 AI 검증 · 무선 청소기 A/S',company:'가상 고객센터',messages:[{role:'customer',text:customer,sentAt:null},{role:'agent',text:agent,sentAt:'2026-11-14T10:00:00+09:00'}]});
    results.caseId=c.id;
    c=await request(`/api/cases/${c.id}/analyze`,{version:c.version});
    results.initial=c; console.log('Analysis:',c.questions.map(q=>({title:q.title,status:q.status})));
    assert.equal(c.questions.length,3); assert.deepEqual(c.questions.map(q=>q.status).sort(),['answered','unanswered','waiting']);
    assert.equal(c.promises.some(p=>p.confirmedAt),false); assert.equal(c.warnings.length,0);
    results.checks.push({name:'three grounded question states',passed:true});
    c=await request(`/api/cases/${c.id}/drafts`,{version:c.version,kind:'followup',questionIds:c.questions.filter(q=>q.status!=='answered').map(q=>q.id)});
    assert(c.drafts.followup.body.includes('배송')); results.followup=c.drafts.followup;
    console.log('PASS follow-up draft');
    const questionIds=c.questions.map(q=>q.id);
    c=await request(`/api/cases/${c.id}/messages`,{version:c.version,role:'agent',text:'왕복 배송비는 업체에서 부담하며, 내일까지 견적을 안내하겠습니다.',sentAt:'2026-11-14T11:00:00+09:00'});
    c=await request(`/api/cases/${c.id}/analyze`,{version:c.version});
    results.updated=c;
    assert.deepEqual(c.questions.map(q=>q.id),questionIds);
    assert.deepEqual(c.questions.map(q=>q.status).sort(),['answered','answered','waiting']);
    assert(c.promises.some(p=>p.dueAt==='2026-11-15')); assert(c.promises.every(p=>!p.confirmedAt));
    results.checks.push({name:'new reply updates existing questions and deadline',passed:true});
    console.log('PASS additional reply and deadline');
    c=await request(`/api/cases/${c.id}/drafts`,{version:c.version,kind:'handoff'});
    assert(c.drafts.handoff.body.length>30); results.handoff=c.drafts.handoff;
    results.checks.push({name:'handoff summary',passed:true}); console.log('PASS handoff summary');
  }
} catch(error) { results.failure=error.message;console.error(error.message);process.exitCode=1; }
finally { mkdirSync('.artifacts',{recursive:true});writeFileSync(`.artifacts/live-${process.argv.includes('--image')?'vision':'text'}-result.json`,JSON.stringify(results,null,2)); }
