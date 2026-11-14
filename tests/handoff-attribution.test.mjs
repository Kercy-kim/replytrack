import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeHandoffAttribution } from '../src/handoff.mjs';
import { validateDraft } from '../src/domain.mjs';
import { CaseStore } from '../src/store.mjs';
import { ReplyTrack } from '../src/service.mjs';

const record = JSON.parse(readFileSync(new URL('../evals/handoff-tail-cases.json',import.meta.url))).cases.find(c=>c.id==='U06').record;
const raw = JSON.parse(readFileSync(new URL('../evals/results/handoff-tail/full.json',import.meta.url))).results.find(r=>r.caseId==='U06'&&r.variant==='after').calls[0].data;

test('source-grounded quoted attribution removes invented people, not content or chronology',()=>{
  const before=structuredClone(raw), normalized=normalizeHandoffAttribution(raw,record);
  assert.throws(()=>validateDraft(raw,record),{code:'DRAFT_ACTOR'});
  assert.equal(normalized.body,raw.body.replace('한 상담원은','한 답변에서는').replace('다른 상담원은','다른 답변에서는'));
  assert.deepEqual(normalized.sourceMessageIds,raw.sourceMessageIds);
  assert.deepEqual(raw,before);
  assert.equal(validateDraft(normalized,record).body,normalized.body);
  assert.equal(normalizeHandoffAttribution(normalized,record),normalized);
  for(const role of ['상담사','담당자']) {
    const candidate={...raw,body:raw.body.replaceAll('상담원',role).replaceAll('‘','"').replaceAll('’','"')};
    assert(!normalizeHandoffAttribution(candidate,record).body.includes(role));
  }
});

test('actual agent references and unsupported or uncited quotes are not normalized',()=>{
  for(const text of ['다른 상담원이 담당했습니다.','상담사 김민수입니다.','담당자가 바뀌었습니다.','다른 분이 안내했습니다.']) {
    const c=structuredClone(record); c.messages[0].text+=text;
    assert.equal(normalizeHandoffAttribution(raw,c),raw);
  }
  for(const candidate of [
    {...raw,body:raw.body.replace('다음 달 청구가 없습니다','이미 입금이 완료됐습니다')},
    {...raw,sourceMessageIds:raw.sourceMessageIds.slice(0,2)},
    {...raw,sourceMessageIds:['missing']},
    {...raw,sourceMessageIds:null},null,
  ]) assert.equal(normalizeHandoffAttribution(candidate,record),candidate);
  const c=structuredClone(record); c.messages[2].role='customer';
  assert.equal(normalizeHandoffAttribution(raw,c),raw);
  const single=structuredClone(record);
  single.messages[1].text+=' 다음 달 요금은 청구됩니다.';
  single.messages[2].text='확인 중입니다.';
  assert.equal(normalizeHandoffAttribution(raw,single),raw);
});

test('unquoted claims, actions, requests, unsupported actor forms and a single attribution keep the repair path',()=>{
  for(const body of [
    '한 상담원은 청구가 없다고 안내했고 다른 상담원은 청구된다고 안내했습니다.',
    '한 상담원은 환불했고 다른 상담원은 결제를 취소했습니다.',
    '다른 상담원에게 다시 확인해 주세요.',
    raw.body.replace('다른 상담원은','같은 상담원은'),
    raw.body.replace('다른 상담원은','두 상담원은'),
    raw.body.replace('한 상담원은','안내에서는'),
    raw.body.replace('안내받아','처리해'),
    raw.body.replace('‘','“'),
    raw.body.replace('한 상담원은','다른 상담원은'),
    raw.body+' 다른 상담원은 ‘다음 달 청구가 없습니다’라고 안내했습니다.',
  ]) {const candidate={...raw,body};assert.equal(normalizeHandoffAttribution(candidate,record),candidate);}
});

test('normalization cannot bypass number, reference or remaining actor guards',()=>{
  for(const [extra,code] of [[' 환불은 999999원입니다.','DRAFT_FACT'],[' 근거 _r999','DRAFT_REFERENCE'],[' 같은 상담원이 처리했습니다.','DRAFT_ACTOR']]) {
    const candidate={...raw,body:raw.body+extra};
    assert.throws(()=>validateDraft(normalizeHandoffAttribution(candidate,record),record),{code});
  }
});

test('indirect received guidance and quoted plural attribution drop only unsupported person distinctions',()=>{
  const paired={...raw,body:'한 상담원에게는 다음 달 청구가 없다고 안내받았고 다른 상담원에게는 다음 달 요금이 청구된다고 안내받아 안내가 상충하여 확인이 필요합니다.'};
  assert.equal(normalizeHandoffAttribution(paired,record).body,paired.body.replace('한 상담원에게는','한 답변에서는').replace('다른 상담원에게는','다른 답변에서는'));
  for(const role of ['상담원','상담사','담당자']) {
    const plural={...raw,body:`${role}들로부터 '청구 없음'과 '청구됨'이라는 상충된 안내를 받아 확인이 필요합니다.`};
    assert.equal(normalizeHandoffAttribution(plural,record).body,plural.body.replace('들로부터','으로부터'));
    assert.equal(validateDraft(normalizeHandoffAttribution(plural,record),record).body,plural.body.replace('들로부터','으로부터'));
  }
});

test('indirect attribution does not rewrite an action, another actor clause, source-backed plurality or unsupported facts',()=>{
  for(const body of ['한 상담원에게는 송금했고 다른 상담원에게는 청구가 없다고 안내받았습니다.', '다른 상담원에게는 다시 문의해 주세요.', '상담원들로부터 돈을 받았습니다.']) {
    const candidate={...raw,body}; assert.equal(normalizeHandoffAttribution(candidate,record),candidate);
  }
  const plural={...raw,body:"상담원들로부터 '청구됨'이라는 안내를 받았습니다. 금액은 999999원입니다."};
  assert.throws(()=>validateDraft(normalizeHandoffAttribution(plural,record),record),{code:'DRAFT_FACT'});
  const c=structuredClone(record); c.messages[0].text+=' 상담원들이 답변했습니다.';
  assert.equal(normalizeHandoffAttribution(plural,c),plural);
});

test('paired side attribution removes invented staff identities while preserving the guidance and guards',()=>{
  const body='해지한 제 계정의 다음 달 청구 여부를 문의했습니다. 상담원 중 한 쪽은 다음 달 청구가 없다고 안내했고 다른 쪽은 청구된다고 안내하여 안내가 상충하므로 확인이 필요합니다.';
  const candidate={...raw,body};
  assert.throws(()=>validateDraft(candidate,record),{code:'DRAFT_ACTOR'});
  const normalized=normalizeHandoffAttribution(candidate,record);
  assert.equal(normalized.body,body.replace('상담원 중 한 쪽은','한 답변에서는').replace('다른 쪽은','다른 답변에서는'));
  assert.deepEqual(normalized.sourceMessageIds,candidate.sourceMessageIds);
  assert.equal(validateDraft(normalized,record).body,normalized.body);
  const actualAgents=structuredClone(record); actualAgents.messages[0].text+=' 상담원 중 한 쪽이 먼저 답변했습니다.';
  assert.equal(normalizeHandoffAttribution(candidate,actualAgents),candidate);
  for(const unsafe of [
    {...candidate,sourceMessageIds:raw.sourceMessageIds.slice(0,2)},
    {...candidate,sourceMessageIds:['missing']},
    {...candidate,body:'상담원 중 한 쪽은 환불했고 다른 쪽은 결제를 취소했습니다.'},
    {...candidate,body:'상담원 중 한 분에게 다시 확인해 주세요.'},
  ]) assert.equal(normalizeHandoffAttribution(unsafe,record),unsafe);
  assert.throws(()=>validateDraft({...candidate,body:'상담원 중 한 분에게 다시 확인해 주세요.'},record),{code:'DRAFT_ACTOR'});
  assert.throws(()=>validateDraft(normalizeHandoffAttribution({...candidate,body:body+' 금액은 999999원입니다.'},record),record),{code:'DRAFT_FACT'});
});

test('handoff attribution uses the original full-context medium review without a regeneration',async()=>{
  const store=new CaseStore(':memory:'), c=store.create({...structuredClone(record),drafts:{}}), calls=[];
  const service=new ReplyTrack(store,{async structured(input){calls.push(input);return {data:input.name==='replytrack_draft'?structuredClone(raw):{valid:true,feedback:''},model:'fixture'};}});
  try {
    const saved=await service.draft(c.id,{kind:'handoff',version:c.version});
    assert.deepEqual(calls.map(c=>c.reasoningEffort),['low','medium']);
    assert.deepEqual(calls[1].data.messages,calls[0].data.messages);
    assert.deepEqual(calls[1].data.questions,calls[0].data.questions);
    assert.deepEqual(calls[1].data.promises,calls[0].data.promises);
    assert.equal(saved.drafts.handoff.body,normalizeHandoffAttribution(raw,record).body);
    assert.equal(calls[1].data.draft.body,saved.drafts.handoff.body);
  } finally {store.close();}
});

test('failed reviews after normalization preserve an edited handoff and followup still repairs normally',async()=>{
  for(const kind of ['handoff','followup']) {
    const store=new CaseStore(':memory:'), c=store.create({...structuredClone(record),drafts:{handoff:{body:'직접 편집한 내용',edited:true}}}), calls=[];
    const service=new ReplyTrack(store,{async structured(input){calls.push(input);return {data:input.name==='replytrack_draft'?structuredClone(raw):{valid:false,feedback:'원문과 다름'},model:'fixture'};}});
    try {
      await assert.rejects(()=>service.draft(c.id,{kind,version:c.version,questionIds:[c.questions[0].id]}),{code:kind==='handoff'?'DRAFT_REVIEW':'DRAFT_ACTOR'});
      assert.equal(store.get(c.id).drafts.handoff.body,'직접 편집한 내용');
      assert.equal(store.get(c.id).version,c.version);
      assert.deepEqual(calls.map(c=>c.reasoningEffort),kind==='handoff'?['low','medium','medium','medium']:['low','medium']);
    } finally {store.close();}
  }
});
