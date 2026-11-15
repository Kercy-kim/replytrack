import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { unsupportedDeadlineClear } from '../src/analysis-focus.mjs';

test('deadline clearing needs revision evidence; completion alone is not withdrawal', () => {
  const data = quote => ({ promises: [{ deadlineCleared: true, evidence: { quote } }] });
  assert(unsupportedDeadlineClear(data('요청하신 장소 확인을 마쳤습니다. 경비실입니다.')));
  assert(unsupportedDeadlineClear(data('We received your transaction ID.')));
  for (const quote of ['기한을 철회합니다.', '기한은 미정입니다.', 'The deadline is not yet set.', 'We withdraw the deadline.']) assert(!unsupportedDeadlineClear(data(quote)));
});

for (const repaired of [true, false]) test(`unsupported deadline clear ${repaired ? 'preserves prior deadline after scoped repair' : 'cannot be saved after a second unsupported result'}`, async () => {
  const store = new CaseStore(':memory:');
  try {
    const calls = [];
    const service = new ReplyTrack(store, { async structured(args) {
      calls.push(args);
      const qid = args.data.existingQuestions[0]?.id || 'new-q-1';
      const pid = args.data.existingPromises[0]?.id || 'new-p-1';
      const initial = calls.length === 1, message = args.data.messages.at(-1);
      const promise = { id: pid, title: '보관 위치 확인 및 안내', questionIds: [qid], state: initial ? 'promised' : 'reported', dueText: initial ? '내일' : '', deadlineCleared: !initial && (calls.length === 2 || !repaired), evidence: { messageId: message.id, quote: message.text } };
      if (calls.length === 3) {
        assert.equal(args.reasoningEffort, 'medium');
        assert(!args.schema.properties.questions);
        return { model: 'fixture', data: { summary: '위치 안내', promises: [promise] } };
      }
      const customer = args.data.messages[0];
      return { model: 'fixture', data: { summary: '위치 문의', questions: [{ id: qid, title: '택배 보관 위치', source: { messageId: customer.id, quote: customer.text }, status: initial ? 'waiting' : 'answered', reason: initial ? '내일 위치를 안내하겠다고 합니다.' : '경비실에 있다고 안내받았습니다.', evidence: [{ messageId: message.id, quote: message.text }] }], promises: [promise] } };
    } });
    let c = service.create({ title: '위치 확인', messages: [{ role: 'customer', text: '택배가 어디에 있나요?' }, { role: 'agent', text: '위치를 확인해서 내일 안내하겠습니다.' }] });
    c = await service.analyze(c.id, c.version);
    const prior = c.promises[0];
    c = service.append(c.id, { version: c.version, role: 'agent', text: '위치 확인을 마쳤습니다. 보관 장소는 경비실입니다.' });
    if (repaired) {
      const updated = await service.analyze(c.id, c.version);
      assert.equal(updated.promises[0].id, prior.id);
      assert.equal(updated.promises[0].state, 'reported');
      assert.equal(updated.promises[0].dueText, prior.dueText);
      assert.equal(updated.promises[0].dueAt, prior.dueAt);
      assert.equal(updated.questions[0].status, 'answered');
    } else {
      await assert.rejects(service.analyze(c.id, c.version), { code: 'AI_EVIDENCE' });
      assert.deepEqual(store.get(c.id), c);
    }
    assert.equal(calls.length, 3);
  } finally { store.close(); }
});
