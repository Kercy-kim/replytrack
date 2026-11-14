import test from 'node:test';
import assert from 'node:assert/strict';
import { manualMessages, newOnboarding, hasOnboardingInput } from '../public/onboarding.js';
import { CaseNavigation } from '../public/workspace.js';

test('manual entry retains labelled, multiline and unlabelled conversation text without guessing speakers', () => {
  assert.deepEqual(manualMessages('나: 배송일을 알려 주세요.\n주문번호는 예제입니다.\n고객센터：내일 확인하겠습니다.'), [
    { role: 'customer', text: '배송일을 알려 주세요.\n주문번호는 예제입니다.', sentAt: null },
    { role: 'agent', text: '내일 확인하겠습니다.', sentAt: null },
  ]);
  assert.deepEqual(manualMessages('발신자를 알 수 없는 원문\n두 번째 줄'), [{ role: 'unknown', text: '발신자를 알 수 없는 원문\n두 번째 줄', sentAt: null }]);
  const long = '내용'.repeat(6500);
  const chunks = manualMessages(long);
  assert(chunks.every(m => m.text.length <= 6000 && m.role === 'unknown'));
  assert.equal(chunks.map(m => m.text).join(''), long);
  const many = Array.from({ length: 70 }, (_, i) => `나: 질문 ${i}`).join('\n');
  assert.equal(manualMessages(many).map(m => m.text).join(''), many);
  const draft = newOnboarding();
  assert.equal(hasOnboardingInput(draft), false);
  draft.messages = manualMessages('이 입력은 닫아도 유지되어야 합니다.');
  assert.equal(hasOnboardingInput(draft), true);
});

test('older reads cannot overwrite AI completion, and a later navigation wins', async () => {
  const views = new CaseNavigation();
  let finishA, finishB;
  const openingA = views.open('a', () => new Promise(resolve => { finishA = resolve; }));
  const openingB = views.open('b', () => new Promise(resolve => { finishB = resolve; }));
  const result = { id: 'a', version: 3, drafts: { handoff: 'new' } };
  views.remember(result);
  finishB({ id: 'b', version: 1 });
  assert.equal((await openingB).id, 'b');
  finishA({ id: 'a', version: 2 });
  assert.equal(await openingA, null);
  assert.deepEqual(await views.open('a', async () => ({ id: 'a', version: 2 })), result);
});

test('returning to the home screen invalidates an in-flight case navigation', async () => {
  const views = new CaseNavigation();
  let finish;
  const pending = views.open('a', () => new Promise(resolve => { finish = resolve; }));
  views.leave();
  finish({ id: 'a', version: 1 });
  assert.equal(await pending, null);
});
