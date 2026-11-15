import test from 'node:test';
import assert from 'node:assert/strict';
import { followupFocusCases, gradeFollowup } from '../evals/followup-focus-cases.mjs';
import { createDemo, createRefundDemo, advanceDemo, demoDraft } from '../src/demo.mjs';

test('follow-up contrast rules preserve genuine requests and catch duplicate or widened requests', () => {
  assert.equal(new Set(followupFocusCases.map(f => f.id)).size, 12);
  assert(gradeFollowup('심사 결과의 안내 예정일을 알려주세요.', followupFocusCases.find(f => f.id === 'F05')).passed);
  assert(gradeFollowup('Please confirm whether a photo of my ID card is required in addition to the receipt ID.', followupFocusCases.find(f => f.id === 'F11')).passed);
  assert(gradeFollowup('Please confirm whether you require a photo of my ID card in addition to the receipt ID.', followupFocusCases.find(f => f.id === 'F11')).passed);
  assert(gradeFollowup('Please provide the complete list of required documents in addition to the receipt ID.', followupFocusCases.find(f => f.id === 'F12')).passed);
  for (const fixture of followupFocusCases) {
    assert(gradeFollowup(fixture.good,fixture).passed, fixture.id);
    assert(!gradeFollowup(fixture.bad,fixture).passed, fixture.id);
    if (fixture.otherBad) assert(!gradeFollowup(fixture.otherBad,fixture).passed);
  }
});

test('prepared examples ask the missing amount after a notification deadline was already given', () => {
  for (const create of [createDemo, createRefundDemo]) {
    const c = advanceDemo(create());
    const selected = c.questions.filter(q => q.status !== 'answered');
    const draft = demoDraft(c,'followup',selected.map(q => q.id));
    assert.match(draft.body,/수리비|환불 금액/);
    assert.doesNotMatch(draft.body,/언제|안내받|배송비|안녕하세요/);
  }
});
