import test from 'node:test';
import assert from 'node:assert/strict';
import { maskPrivate, privacyEnvelope } from '../src/privacy.mjs';
import { OpenAIClient } from '../src/openai.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';

test('phone and Korean road/lot address masking preserves dates, prices, intent and order IDs', () => {
  const source = '전화 010-1234-5678 / +82 10 9876 5432 / 02-123-4567\n주소: 서울특별시 강남구 테헤란로 123, 101동 202호\n부산광역시 해운대구 우동 123-45 301호로 배송해 주세요.\n주문 AB20261114, 환불 12,300원, 2026-11-17까지 답변 부탁합니다.';
  const envelope = privacyEnvelope(source);
  assert.deepEqual(envelope.counts, { phone: 3, address: 2 });
  for (const value of ['010-1234-5678', '9876', '서울특별시', '101동', '부산광역시', '우동', '301호']) assert(!envelope.data.includes(value), value);
  for (const value of ['배송해 주세요', 'AB20261114', '12,300원', '2026-11-17']) assert(envelope.data.includes(value), value);
  assert.equal(envelope.decode(envelope.data), source);
  assert.equal(maskPrivate(envelope.data), envelope.data);
});

test('mask aliases do not collide with literal placeholders or other values and restore only local known mappings', () => {
  const source = { text: '[전화번호_B] 01012345678 / 01012345678 / 01098765432', id: '29c23256-9767-4f22-a0c1-38236b60225d' };
  const envelope = privacyEnvelope(source);
  assert.equal(envelope.counts.phone, 2);
  assert.equal(envelope.data.id, source.id);
  assert.deepEqual(envelope.decode(envelope.data), source);
  assert.equal(envelope.decode('[주소_ZZZ]'), '[주소_ZZZ]');
  assert(!envelope.data.text.includes('010'));
});

test('compact Korean addresses are hidden without masking amounts or promised dates as street numbers', () => {
  for (const address of ['서울 강남구 테헤란로123 101동 202호', '경기도 성남시 분당구 판교역로 166', '서울특별시 종로구 세종대로 175', '부산광역시 해운대구 우동123-45', '서울특별시 종로구 종로1가 23']) {
    assert.match(maskPrivate(address), /^\[주소_[A-Z]+\]$/);
  }
  const text = '추가로 3,000원입니다. 수리비로 30000원, 환불로 2만원, 다음 달로 17일에 안내하겠습니다. 원가 10000 (부가세 별도)';
  assert.equal(maskPrivate(text), text);
});

test('outbound Responses input and repair feedback are masked, legacy evidence restored locally, raw images blocked', async () => {
  let payload;
  const client = new OpenAIClient({ apiKey: 'sk-test-not-a-real-credential', fetchImpl: async (_, options) => {
    payload = JSON.parse(options.body);
    const data = JSON.parse(payload.input[0].content[0].text);
    return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ quote: data.text }) }] }] });
  } });
  const source = '주소는 서울특별시 강남구 테헤란로 123입니다. 연락처 010-1234-5678';
  const result = await client.structured({ name: 'test', instructions: `이 원문에서 정확히 인용: ${source}`, data: { text: source }, schema: { type: 'object' } });
  assert(!JSON.stringify(payload).includes('010-1234-5678'));
  assert(!JSON.stringify(payload).includes('테헤란로'));
  assert.equal(result.data.quote, source);
  await assert.rejects(client.structured({ image: 'data:image/png;base64,abc' }), { code: 'RAW_IMAGE_BLOCKED' });
});

test('text/locally read images, direct create and appended messages default to masking without deleting earlier drafts', async () => {
  const store = new CaseStore(':memory:'); const calls = [];
  const ai = { structured: async args => { calls.push(args); return { data: { messages: [{ role: 'customer', text: args.data.text }], notes: [] }, model: 'fixture' }; } };
  const service = new ReplyTrack(store, ai, { ocr: async () => '고객: 010-1234-5678, 서울특별시 강남구 테헤란로 123으로 보내 주세요.' });
  try {
    const result = await service.extract({ image: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.equal(calls.length, 1); assert.equal(calls[0].image, undefined);
    assert(!JSON.stringify(calls).includes('010-1234-5678')); assert(!JSON.stringify(calls).includes('테헤란로'));
    assert.match(result.messages[0].text, /\[전화번호_/);
    let record = service.create({ title: '배송', messages: [{ role: 'customer', text: '01012345678로 연락주세요.' }] });
    assert(!record.messages[0].text.includes('010'));
    record.drafts = { followup: { body: '기존 초안', editedBody: '내가 저장한 초안' } }; record = store.save(record, record.version);
    const next = service.append(record.id, { version: record.version, role: 'agent', text: '02-123-4567로 연락주세요.' });
    assert.deepEqual(next.drafts, record.drafts);
    assert(!next.messages.at(-1).text.includes('02-123'));
    assert.deepEqual(next.questions, record.questions);
  } finally { store.close(); }
});
