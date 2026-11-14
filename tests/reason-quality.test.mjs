import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeReasons } from '../evals/reason-quality.mjs';
const record = (reason, message = 0) => ({ messages: [{ id: 'm0' }, { id: 'm1' }], questions: [{ id: 'q', source: { messageId: `m${message}` }, reason }] });
test('reason controls reject unasked caveats but accept the direct answer', () => {
  assert.equal(gradeReasons(record('설정에서 스위치를 끄라고 안내했으나 경로나 플랫폼 정보는 없다.'), 'B06').pass, false);
  assert.equal(gradeReasons(record('설정에서 갱신 스위치를 끄는 방법을 안내받았습니다.'), 'B06').pass, true);
  assert.equal(gradeReasons(record('입금 여부와 시점을 알 수 없습니다.', 1), 'NR06').pass, false);
  assert.equal(gradeReasons(record('실제 입금 여부를 확인할 수 없다고 안내했습니다.', 1), 'NR06').pass, true);
});
test('reason controls require details and conditions when actually relevant', () => {
  assert.equal(gradeReasons(record('설정에서 스위치를 끄는 방법만 안내받아 상세 경로는 알 수 없습니다.'), 'Q01').pass, true);
  assert.equal(gradeReasons(record('설정에서 스위치를 끄는 방법을 안내받았습니다.'), 'Q01').pass, false);
  assert.equal(gradeReasons(record('입금 시각을 알 수 없다고 안내했습니다.'), 'Q02').pass, true);
  assert.equal(gradeReasons(record('입금 여부를 알 수 없습니다.'), 'Q02').pass, false);
  assert.equal(gradeReasons(record('제품 불량이 확인되면 환불 가능하다고 안내했습니다.'), 'Q03').pass, true);
  assert.equal(gradeReasons(record('환불 가능하다고 안내했습니다.'), 'Q03').pass, false);
});
test('reason checks fail closed on missing or ambiguous matches and empty prose', () => {
  assert.equal(gradeReasons({ messages: [], questions: [] }, 'B06').pass, false);
  const duplicate = record('설정에서 스위치를 끄라고 안내했습니다.');
  duplicate.questions.push({ ...duplicate.questions[0], id: 'q2' });
  assert.equal(gradeReasons(duplicate, 'B06').pass, false);
  assert.equal(gradeReasons(record(''), 'unknown').pass, false);
  assert.equal(gradeReasons(record('질문이 충족되었습니다.'), 'unknown').pass, false);
  assert.equal(gradeReasons(record('설정에서 스위치를 끄는 방법은 받았지만 상세 경로는 알 수 없으므로 부분 응답으로 분류합니다.'), 'Q01').pass, false);
});
test('a correct short reason cannot conceal lost partial-answer evidence', () => {
  const r = record('다음 달 9,900원은 안내받았지만 이번 달 금액은 미정입니다.');
  r.questions[0].evidence = [{ quote: '이번 달 청구액은 아직 확인하지 못했습니다.' }];
  assert.equal(gradeReasons(r, 'U03').pass, false);
  r.questions[0].evidence = [{ quote: '다음 달부터는 할인되어 월 9,900원입니다. 이번 달 청구액은 아직 확인하지 못했습니다.' }];
  assert.equal(gradeReasons(r, 'U03').pass, true);
});
test('an already-asked condition need not be repeated; an answer-only exception must remain', () => {
  const r = { messages: [{ id: 'm0' }, { id: 'm1' }], questions: [
    { id: 'q0', source: { messageId: 'm0', quote: '불량일 때 반품비는 누가 내나요?' }, reason: '업체가 부담한다고 안내받았습니다.' },
    { id: 'q1', source: { messageId: 'm1', quote: '단순 변심이면 반품비는 누가 내나요?' }, reason: '고객이 부담한다고 안내받았습니다.' },
  ] };
  assert.equal(gradeReasons(r, 'R06').pass, true);
  r.questions[0].source.quote = '반품비는 누가 내나요?';
  assert.equal(gradeReasons(r, 'R06').pass, false);
  assert.equal(gradeReasons(record('환불 가능하다고 안내받았습니다.'), 'Q03').pass, false);
});
