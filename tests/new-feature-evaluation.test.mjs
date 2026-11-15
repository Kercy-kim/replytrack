import test from 'node:test';
import assert from 'node:assert/strict';
import { actionCases, guideCases, newFeatureCases } from '../evals/new-feature-cases.mjs';
import { gradeActions, gradeGuide } from '../evals/new-feature-grade.mjs';

test('new feature evaluation freezes 20 action and 20 guide cases including lifecycle and failures', () => {
  assert.equal(actionCases.length,20); assert.equal(guideCases.length,20);
  assert.equal(new Set(newFeatureCases.map(c=>c.id)).size,40);
  assert.equal(actionCases.filter(c=>c.followup).length,2);
  assert.equal(guideCases.filter(c=>c.fallback).length,4);
  assert.equal(guideCases.filter(c=>c.expected.status==='unsupported').length,2);
});

test('action evaluation catches fabricated completion, wrong dates, omitted conditions and wrong sources', () => {
  const c=actionCases[1];
  const record={messages:c.messages.map((m,i)=>({...m,id:`m${i}`})),nextActions:{items:[{title:'작동 동영상 보내기',source:{messageId:'m1'},state:'requested',dueAt:null,dueText:'',condition:'충전한 뒤에도 전원이 켜지지 않으면',update:null,completedAt:null}]}};
  assert(gradeActions(record,c.expected).pass);
  for(const bad of [{state:'reported_done'},{completedAt:'2026-11-15'},{dueAt:'2026-11-16'},{condition:''},{source:{messageId:'m0'}}]) {
    const copy=structuredClone(record);Object.assign(copy.nextActions.items[0],bad);
    assert(!gradeActions(copy,c.expected).pass);
  }
});

test('guide evaluation catches missing uncertainty, wrong source mode and invented periods', () => {
  const c=guideCases.find(c=>c.id==='G05');
  const result={status:'ready',intent:'exchange',mode:'reviewed',steps:[{text:'수령 날짜를 확인해 주세요.'}],conditions:[{text:'7일 이내 신청 조건을 확인하세요.'}],unknowns:['받은 날짜를 확인해야 합니다.'],sources:[{checkedAt:'2026-11-15'}]};
  assert(gradeGuide(result,c).pass);
  assert(!gradeGuide({...result,mode:'live'},c).pass);
  assert(!gradeGuide({...result,unknowns:['신청 가능 여부는 미정입니다.']},c).pass);
  const injected=guideCases.find(c=>c.id==='G16');
  assert(!gradeGuide({...result,intent:'return',mode:'live',steps:[{text:'100일 안에는 무조건 가능합니다.'}]},injected).pass);
});

test('receipt confirmation can cite either the customer submission or the later company acknowledgement', () => {
  const record={messages:[{id:'request'},{id:'sent'},{id:'received'}],nextActions:{items:[{title:'사진 제출',source:{messageId:'request'},state:'reported_done',dueAt:null,completedAt:null,update:{messageId:'sent'}}]}};
  const expected=[{title:'사진',source:0,state:'reported_done',dueAt:null,update:[1,2]}];
  assert(gradeActions(record,expected).pass);
  record.nextActions.items[0].update.messageId='received'; assert(gradeActions(record,expected).pass);
  record.nextActions.items[0].update.messageId='request'; assert(!gradeActions(record,expected).pass);
});

test('a seven-day conditional policy is not a guarantee for a twelve-day-old return', () => {
  const c=guideCases.find(c=>c.id==='G03');
  const result={status:'ready',intent:'return',mode:'live',sources:[],steps:[{text:'12일이 지나 일반 신청 기간을 초과했습니다. 상품별 조건은 확인이 필요합니다.'}],conditions:[{text:'단순 변심은 7일 이내에만 반품 가능합니다.'}],unknowns:['상품별 예외 확인이 필요합니다.']};
  assert(gradeGuide(result,c).pass);
  result.steps[0].text='7일 이내에만 반품 가능합니다. 수령 12일이면 일반 기간을 초과하므로 상품별 조건 확인이 필요합니다.';
  assert(gradeGuide(result,c).pass);
  result.steps.push({text:'고객님은 반품 가능합니다.'});assert(!gradeGuide(result,c).pass);
  result.steps.pop();result.conditions=[{text:'현재 고객님은 7일 이내이므로 반품 가능합니다.'}];assert(!gradeGuide(result,c).pass);
});

test('a corrected receipt-date conflict accepts the Korean past-tense expression for exceeding seven days', () => {
  const c=guideCases.find(c=>c.id==='G13');
  const result={status:'ready',intent:'exchange',mode:'live',sources:[],steps:[{text:'받으신 지 7일이 지났으니 단순변심으로는 교환이 불가합니다.'}],conditions:[{text:'단순변심 교환은 7일 이내에 가능합니다.'}],unknowns:['상품별 조건 확인이 필요합니다.']};
  assert(gradeGuide(result,c,['received']).pass);
  assert(!gradeGuide(result,c,[]).pass);
  result.steps[0].text='7일 이내이므로 교환 가능합니다.';assert(!gradeGuide(result,c,['received']).pass);
});
