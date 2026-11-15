import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OfficialFaq, parseFaq, guideInput, validateGuide, reviewedSources, contextFields, guideEvidence, guideSchemaFor, resolveGuideEvidence, sourcesForSituation } from '../src/official-guide.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { createApp } from '../server.mjs';
import { fields, guideTranscript, renderGuide, newGuide } from '../public/official-guide.js';

const url = 'https://www.ssg.com/customer/faqKeywordList.ssg?keyword=교환';
const item = (title, body, id = '123') => `<li><a onclick="faqHitCount(this, '3', '${id}');" class="subject"><span>질문</span>${title}</a><div class="content"><div class="answer"><span>답변</span><p>${body}</p></div></div></li>`;
const html = `<ul>${item('반품 / 교환 신청 시 주의사항이 있나요?', '<strong>일반 상품은 신청 시점과 상품 상태를 확인해야 합니다.</strong><br>설치 이후와 특수 상품의 예외 조건도 확인하세요.')}${item('교환 접수가 되지 않아요', '상품에 따라 직접 교환을 접수하지 못할 수 있으므로 고객센터에 문의해 주세요.', '124')}</ul>`;
const response = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const input = { store: 'ssg', goal: 'SSG에서 산 옷을 바꾸고 싶어요', answers: { reason: 'mind', received: 'week' } };
export const sampleGuide = sources => ({ steps: [{ text: '상품의 조건을 먼저 확인해 주세요.', sourceId: sources[0].id, quote: sources[0].body.slice(0, 40) }], conditions: [{ text: '개별 상품의 예외를 확인해야 해요.', sourceId: sources[0].id, quote: sources[0].body.slice(0, 40) }], unknowns: ['내 주문의 접수 가능 여부는 고객센터에서 확인해 주세요.'] });
function fixture(options = {}) {
  const calls = [], store = new CaseStore(':memory:');
  const ai = { configured: true, model: 'test-fixture', structured: async p => {
    calls.push(p);
    if (p.name === 'replytrack_connection') return { data: { ok: true } };
    if (p.name === 'replytrack_guide_intent') return { data: { intent: options.intent || 'exchange' } };
    if (p.name === 'replytrack_guide_review') return { data: { valid: options.valid ?? true, feedback: '' } };
    if (options.generate) return options.generate(p);
    const sample = sampleGuide(p.data.sources);
    return { data: { ...sample, steps: sample.steps.map(({text}) => ({text,evidenceId:p.data.evidence[0].id})), conditions: sample.conditions.map(({text}) => ({text,evidenceId:p.data.evidence[0].id})) }, model: 'test-fixture' };
  } };
  const faq = options.faq || new OfficialFaq({ fetchImpl: async () => response(html) });
  const service = new ReplyTrack(store, ai, { faq });
  return { calls, store, service, ai, faq };
}
test('official parser reads complete answer bodies including nested markup, not titles or scripts', () => {
  const sources = parseFaq(html.replace('</p>', '<script>steal()</script></p>'), url, '2026-11-15');
  assert.equal(sources.length, 2); assert.match(sources[0].body, /특수 상품/); assert(!sources[0].body.includes('steal')); assert(!sources[0].body.includes('답변'));
  assert.equal(parseFaq('<h1>교환 안내</h1><p>검색 결과 요약</p>', url, '').length, 0);
});
test('official search uses only fixed official URLs and category keywords; no user data', async () => {
  const seen = [];
  const faq = new OfficialFaq({ fetchImpl: async (u, init) => { seen.push([u, init]); return response(html); } });
  const found = await faq.search('exchange');
  assert.equal(found.mode, 'live'); assert.equal(found.sources.length, 2);
  assert.equal(seen.length, 3); for (const [u, init] of seen) { assert.equal(new URL(u).origin, 'https://www.ssg.com'); assert.equal(init.redirect, 'error'); }
  assert.deepEqual(seen.map(([u]) => new URL(u).searchParams.get('keyword')), ['교환', '주의사항', '바로톡']);
});
test('the final FAQ retains exceptions after a nested list and excludes the page footer', () => {
  const document = `<ul>${item('반품 / 교환 주의사항', '<div>일반 상품의 교환 안내입니다.<ul><li>조건을 확인하세요.</li></ul></div><div>단, 설치 이후의 상품은 단순 변심 교환이 제한됩니다.</div>')}</ul><footer>회원정보와 다른 상품 광고</footer>`;
  const found = parseFaq(document, url, '2026-11-15');
  assert.equal(found.length, 1); assert.match(found[0].body, /설치 이후/); assert(!found[0].body.includes('회원정보'));
  assert.equal(parseFaq(document.replace('class="answer"', 'class="missing"'), url, '').length, 0);
});
test('special-delivery and membership conditions are not offered as generic shopping rules', async () => {
  const document = html.replace('</ul>', `${item('주문 취소 추가 안내', '바로퀵 라이더가 픽업한 이후에는 별도의 반품 요금이 발생하는 안내입니다.', '998')}${item('해지 후 환불 규정', '멤버십 전용 환불 정책이며 신세계 유니버스 클럽 가입자에 한해 적용됩니다.', '999')}</ul>`);
  const found = await new OfficialFaq({ fetchImpl: async () => response(document) }).search('exchange');
  assert.equal(found.mode, 'live'); assert.equal(found.sources.length, 2); assert(!found.sources.some(s => /라이더|멤버십/.test(s.body)));
});
for (const [name, fetchImpl] of [
  ['HTTP failure', async () => new Response('', { status: 403 })],
  ['non-HTML response', async () => new Response('{}', { headers: { 'content-type': 'application/json' } })],
  ['empty titles-only response', async () => response('<h1>교환 관련 검색결과</h1>')],
  ['changed markup', async () => response(html.replaceAll('class="answer"', 'class="changed"'))],
  ['oversized response', async () => response('x'.repeat(1500001))],
  ['network failure', async () => { throw new TypeError('network'); }],
]) test(`${name} falls back with original checked dates and explicit provenance`, async () => {
  const found = await new OfficialFaq({ fetchImpl }).search('exchange');
  assert.equal(found.mode, 'reviewed'); assert(found.reason); assert(found.sources.every(s => s.checkedAt === '2026-11-15')); assert(found.sources.some(s => s.id === 'saved-conditions'));
});
test('a timeout falls back, but an explicit cancellation never becomes fallback', async () => {
  const fetchImpl = async (_, { signal }) => { await new Promise((resolve, reject) => { const timer = setTimeout(resolve, 1000); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); return response(html); };
  assert.equal((await new OfficialFaq({ fetchImpl, timeoutMs: 10 }).search('cancel')).mode, 'reviewed');
  const controller = new AbortController(); const pending = new OfficialFaq({ fetchImpl }).search('cancel', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, e => e.code === 'OPERATION_CANCELLED');
});
test('exception page absence triggers complete reviewed fallback, without mixing provenance', async () => {
  const faq = new OfficialFaq({ fetchImpl: async () => response(`<ul>${item('교환 신청', '교환 신청을 위해 상품 상태와 신청 내용을 먼저 고객센터에 알려 주세요.')}</ul>`) });
  assert.equal((await faq.search('exchange')).mode, 'reviewed');
});
test('input rejects unsupported stores, arbitrary URLs, invalid answers and oversized text', () => {
  for (const raw of [{ ...input, store: 'http://localhost' }, { ...input, goal: 'x'.repeat(2001) }, { ...input, answers: { received: 'tomorrow' } }, { ...input, answers: { url: 'http://localhost' } }]) assert.throws(() => guideInput(raw));
  assert.deepEqual(Object.keys(fields), Object.keys(contextFields));
  for (const key of Object.keys(fields)) assert.deepEqual(fields[key].options, contextFields[key].options);
});
test('clarification asks one missing situation at a time; unknown is a real answer', async t => {
  const f = fixture(); t.after(() => f.store.close());
  const first = await f.service.guide({ ...input, answers: {} }); assert.equal(first.question.key, 'reason');
  const second = await f.service.guide({ ...input, answers: { reason: 'unknown' } }); assert.equal(second.question.key, 'received');
  assert(!f.calls.some(p => p.name === 'replytrack_guide'));
  const ready = await f.service.guide({ ...input, answers: { reason: 'unknown', received: 'unknown' } }); assert.equal(ready.status, 'ready');
});
test('unsupported intent performs no search or generation', async t => {
  const f = fixture({ intent: 'unsupported', faq: { search() { throw Error('should not search'); } } }); t.after(() => f.store.close());
  assert.equal((await f.service.guide(input)).status, 'unsupported'); assert.equal(f.calls.length, 2);
});
test('guided result masks data before AI and leaves existing case records untouched', async t => {
  const f = fixture(); t.after(() => f.store.close());
  const c = f.service.create({ title: '기존 기록', company: 'SSG', messages: [{ role: 'customer', text: '교환 문의' }] });
  const before = f.store.get(c.id);
  const result = await f.service.guide({ ...input, goal: `${input.goal} 010-1234-5678 서울시 강남구 테헤란로 123` });
  assert.equal(result.mode, 'live'); assert(result.reviewed); assert(!JSON.stringify(f.calls).includes('010-1234-5678')); assert(!result.input.goal.includes('테헤란로'));
  assert.deepEqual(f.store.get(c.id), before); assert.equal(f.store.list().length, 1);
  assert.deepEqual(f.calls.map(c => c.name), ['replytrack_connection', 'replytrack_guide_intent', 'replytrack_guide', 'replytrack_guide_review']);
});
test('invalid source IDs, non-exact quotes and model-authored URLs fail closed', () => {
  const sources = reviewedSources;
  for (const changes of [{ sourceId: 'evil' }, { quote: '원문에는 없는 문장입니다' }, { text: 'https://evil.example' }, { quote: ' ' }]) {
    const data = sampleGuide(sources); Object.assign(data.steps[0], changes); assert.throws(() => validateGuide(data, sources));
  }
});
test('model selects evidence IDs; quotes are restored exactly without model ellipses or alterations', () => {
  const evidence = guideEvidence(reviewedSources);
  assert(evidence.every(e => e.quote.length <= 180 && reviewedSources.find(s => s.id === e.sourceId).body.includes(e.quote)));
  const schema = guideSchemaFor(evidence);
  assert.deepEqual(schema.properties.steps.items.properties.evidenceId.enum, evidence.map(e => e.id));
  const raw = { steps: [{text:'조건 확인',evidenceId:evidence[0].id,quote:'원문...변형'}],conditions:[{text:'예외 확인',evidenceId:evidence[1].id}],unknowns:['개별 주문 확인 필요'] };
  const result = resolveGuideEvidence(raw,evidence); assert.equal(result.steps[0].quote,evidence[0].quote); validateGuide(result,reviewedSources);
  raw.steps[0].evidenceId='invented'; assert.throws(()=>resolveGuideEvidence(raw,evidence));
});
test('card refund timing does not retrieve unrelated return-inspection or extra-payment policies', () => {
  const sources=[{id:'payment',title:'결제 수단 별 환불 확인은 언제 가능한가요?'},{id:'inspection',title:'판매처에 도착했는데 환불은 언제 되나요?'},{id:'extra',title:'환불 금액이 왜 다른가요?'}];
  const timing={...input,goal:'카드 취소 완료인데 카드 내역은 그대로예요. 언제 돌아오나요?',answers:{payment:'card'}};
  assert.deepEqual(sourcesForSituation(sources,timing,'refund').map(s=>s.id),['payment']);
  assert.equal(sourcesForSituation(sources,{...timing,goal:'환불 금액이 달라요'},'refund').length,3);
  assert.equal(sourcesForSituation(sources,input,'exchange').length,3);
});
test('semantic review rejection preserves records', async t => {
  const f = fixture({ valid: false }); t.after(() => f.store.close());
  await assert.rejects(f.service.guide(input), e => e.code === 'GUIDE_REVIEW'); assert.equal(f.store.list().length, 0);
});
test('cancel after generation prevents review and result publication', async t => {
  const controller = new AbortController();
  const f = fixture({ generate: async p => { controller.abort(); return { data: sampleGuide(p.data.sources) }; } }); t.after(() => f.store.close());
  await assert.rejects(f.service.guide(input, { signal: controller.signal }), e => e.code === 'OPERATION_CANCELLED');
  assert(!f.calls.some(p => p.name === 'replytrack_guide_review'));
});
test('UI escapes user/provider data, marks old results, and transfers only user context', () => {
  const g = newGuide(); g.goal = '<img src=x onerror=alert(1)>'; g.result = { input, request: input, ...sampleGuide(reviewedSources), sources: reviewedSources, mode: 'reviewed', reason: '검색 실패' };
  const rendered = renderGuide(g, { busy: false, configured: true, hasDraft: false });
  assert(!rendered.includes('<img')); assert.match(rendered, /이전 입력/); assert.match(rendered, /data-action="guide-handoff" disabled/);
  const transcript = guideTranscript(input); assert.match(transcript, /사이즈/); assert(!transcript.includes('일반 상품의 예외')); assert(!transcript.includes('FAQ'));
});
test('HTTP guide validates before AI calls and exposes completed asynchronous results', async t => {
  const f = fixture(); const app = createApp({ store: f.store, ai: f.ai, faq: f.faq });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { app.operations.close(); await new Promise(r => app.server.close(r)); f.store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = body => fetch(`${base}/api/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ id: randomUUID(), kind: 'guide', input: { ...input, store: 'other' } })).status, 400); assert.equal(f.calls.length, 0);
  const id = randomUUID(); assert.equal((await post({ id, kind: 'guide', input })).status, 202);
  let job;
  for (let i = 0; i < 50; i++) { job = await (await fetch(`${base}/api/operations/${id}`)).json(); if (job.state !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal(job.state, 'completed'); assert.equal(job.result.status, 'ready');
  assert.equal((await fetch(`${base}/official-guide.js`)).status, 200);
});
