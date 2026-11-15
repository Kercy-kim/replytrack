import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { OfficialFaq, parseFaq, guideInput, validateGuide, reviewedSources, contextFields, guideEvidence, guideSchemaFor, resolveGuideEvidence, sourcesForSituation, evidenceForSituation, guideUnknowns, cardRefundEvidence } from '../src/official-guide.mjs';
import { ReplyTrack } from '../src/service.mjs';
import { CaseStore } from '../src/store.mjs';
import { createApp } from '../server.mjs';
import { guideChecks } from '../src/feature-review.mjs';
const reviewResult=(valid,feedback='')=>({checks:Object.fromEntries(Object.keys(guideChecks).map(key=>[key,valid])),valid,feedback});

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
    if (p.name === 'replytrack_guide_review') return { data: reviewResult(options.valid ?? true) };
    if (options.generate) return options.generate(p);
    const sample = sampleGuide(p.data.sources.map(s=>({...s,body:p.data.evidence.find(e=>e.sourceId===s.id)?.quote||'확인된 원문 근거'})));
    return { data: { ...sample, steps: sample.steps.map(({text}) => ({text,evidenceId:p.data.evidence[0].id})), conditions: sample.conditions.map(({text}) => ({text,evidenceId:p.data.evidence[0].id})) }, model: 'test-fixture' };
  } };
  const faq = options.faq || new OfficialFaq({ fetchImpl: async () => response(html) });
  const service = new ReplyTrack(store, ai, { faq });
  return { calls, store, service, ai, faq };
}
test('unconfirmed facts come from selected context and cannot introduce unrelated policy questions', () => {
  const missing=guideUnknowns({...input,answers:{reason:'unknown',received:'unknown'}},'return');
  assert.equal(missing.length,3);assert(missing.some(t=>/받은 날짜/.test(t)));assert(missing.some(t=>/사유/.test(t)));
  const known=guideUnknowns(input,'exchange');assert.equal(known.length,1);assert(!known.some(t=>/날짜|사유/.test(t)));
  const shipped=guideUnknowns({answers:{order:'shipped'}},'cancel').join(' ');
  assert(!/수취 거부|설치상품|주문 더하기/.test(shipped));
  const refund=guideUnknowns({answers:{payment:'unknown',refundState:'unknown'}},'refund').join(' ');
  assert.match(refund,/결제수단/);assert.match(refund,/승인.*처리/);
  assert.match(guideUnknowns({answers:{order:'unknown'}},'cancel').join(' '),/주문.*상태/);
});

test('card table excerpts preserve timing labels and do not carry neighboring payment methods', () => {
  const body='카드 신용카드 당일 취소 전체취소 : 당일 승인 취소(환불) 부분취소 : 영업일 기준 3~5일 소요 당일 이후 취소 영업일 기준 3~7일 소요 체크카드 당일 취소 전체취소 : 당일 승인 취소(환불) 부분취소 : 영업일 기준 3~5일 소요 당일 이후 취소 영업일 기준 3~7일 소요 Alipay 계정으로 영업일 기준 3일 후에 환불. ※ 신용카드 환불은 카드사 정책에 따라 차이가 있으니 해당 카드사로 문의바랍니다.';
  const sources=[{id:'card',title:'결제수단별 환불',body}];
  const evidence=cardRefundEvidence(sources);
  assert.equal(evidence.length,4);assert(evidence.every(e=>body.includes(e.quote)&&e.quote.length<=180));
  const partial=evidence.find(e=>e.quote.includes('부분취소'));assert.match(partial.quote,/당일 취소.*3~5/);assert(!/3~7|Alipay/.test(partial.quote));
  assert(evidence.some(e=>/당일 이후 취소.*3~7/.test(e.quote)));
  assert(cardRefundEvidence([{...sources[0],body:body.replaceAll('3~5','4~6')}]).some(e=>/부분취소.*4~6/.test(e.quote)));
  assert(cardRefundEvidence(reviewedSources.filter(s=>s.id==='saved-refund')).some(e=>/당일 부분 취소.*3~5/.test(e.quote)));
  const scoped=evidenceForSituation(guideEvidence(sources),{answers:{payment:'card'}},'refund',sources);
  assert(scoped.every(e=>!e.quote.includes('Alipay')));
});

test('change-of-mind guidance uses self-service failure evidence only for an actual reported failure', () => {
  const sources=reviewedSources.filter(s=>s.topics.includes('return'));
  const simple={goal:'신선식품을 단순 변심으로 반품하고 싶어요.',answers:{reason:'mind',received:'week'}};
  assert(!sourcesForSituation(sources,simple,'return').some(s=>s.id==='saved-contact'));
  const blocked={...simple,goal:'교환 접수 버튼이 없어요.'};
  assert(sourcesForSituation(sources,blocked,'exchange').some(s=>s.id==='saved-contact'));
});

test('required pending-approval evidence survives generated condition choices', () => {
  const evidence=[{id:'pending',sourceId:'p',quote:'취소 요청 시 취소 승인 또는 거절로 진행됩니다.'},{id:'card',sourceId:'c',quote:'당일 전체 취소는 당일 승인 취소.'}];
  const resolved=resolveGuideEvidence({steps:[{text:'실제 승인 확인',evidenceId:'pending'}],conditions:[{evidenceId:'card'}]},evidence,['실제 승인 확인 필요'],['pending']);
  assert.equal(resolved.conditions[0].quote,evidence[0].quote);assert.equal(resolved.conditions[0].text,evidence[0].quote);
  assert.equal(resolved.conditions.length,2);
});

test('a requested refund retains the official cancellation refusal condition even without an approval sentence', async t => {
  const sources=[{id:'cancel',title:'주문한 상품 주문취소가 가능한가요?',body:'상품 준비중: 취소요청 가능 (상품 출고 단계일 경우, 취소 거부처리되며 상품 출고 진행)',url,checkedAt:'2026-11-15'}, {id:'card',title:'결제 수단 별 환불 확인',body:'당일 취소 전체취소 : 당일 승인 취소(환불) 부분취소 : 영업일 기준 3~5일 소요 당일 이후 취소 영업일 기준 3~7일 소요',url,checkedAt:'2026-11-15'}];
  sources[1].body+=' 신용카드 환불은 카드사 정책에 따라 다르니 해당 카드사로 문의바랍니다.';
  sources.push({...sources[1],id:'card-copy',title:'카드 환불 반영 기간'});
  const f=fixture({intent:'refund',faq:{search:async()=>({mode:'live',sources})},generate:async()=>{throw Error('Pending card timing must not be invented by generation');}});t.after(()=>f.store.close());
  const result=await f.service.guide({store:'ssg',goal:'취소 요청했는데 카드 환불은 언제인가요?',answers:{payment:'card',refundState:'requested'}});
  assert.equal(result.status,'ready');assert.match(result.conditions[0].quote,/취소요청.*취소 거부/);
  assert.equal(result.conditions[0].text,result.conditions[0].quote);
  assert(result.conditions.some(c=>/부분취소.*3~5/.test(c.quote)));assert(result.conditions.some(c=>/이후 취소.*3~7/.test(c.quote)));
  assert(!f.calls.some(c=>c.name==='replytrack_guide'));assert(f.calls.some(c=>c.name==='replytrack_guide_review'));
  assert(result.steps.every(s=>!/3~7|3~5/.test(s.text)));
});

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
});
test('clarification asks one missing situation at a time; unknown is a real answer', async t => {
  const f = fixture(); t.after(() => f.store.close());
  const first = await f.service.guide({ ...input, answers: {} }); assert.equal(first.question.key, 'reason');
  const second = await f.service.guide({ ...input, answers: { reason: 'unknown' } }); assert.equal(second.question.key, 'received');
  assert(!f.calls.some(p => p.name === 'replytrack_guide'));
  const ready = await f.service.guide({ ...input, answers: { reason: 'unknown', received: 'unknown' } }); assert.equal(ready.status, 'ready');
});

test('contradictory supplied facts ask for correction before searching or generating guidance', async t => {
  const f=fixture();t.after(()=>f.store.close());const original=f.ai.structured;
  f.ai.structured=async p=>{const result=await original(p);if(p.name==='replytrack_guide_intent')result.data.conflictingField=p.data.answers.received==='week'?'received':null;return result;};
  const contradictory={...input,goal:'SSG 옷을 받은 지 20일인데 교환하고 싶어요.'};
  const first=await f.service.guide(contradictory);
  assert.equal(first.status,'question');assert.equal(first.question.key,'received');assert.match(first.question.label,/설명과 선택한 상황이 달라/);
  assert(!f.calls.some(p=>p.name==='replytrack_guide'));
  assert.equal((await f.service.guide({...contradictory,answers:{reason:'mind',received:'older'}})).status,'ready');
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
  const unknowns=guideUnknowns(input,'exchange');
  const result = resolveGuideEvidence(raw,evidence,unknowns); assert.equal(result.steps[0].quote,evidence[0].quote); validateGuide(result,reviewedSources);
  assert.deepEqual(result.unknowns,unknowns);assert(!Object.hasOwn(schema.properties,'unknowns'));
  assert.equal(result.conditions[0].text,evidence[1].quote);
  assert.deepEqual(schema.properties.conditions.items.required,['evidenceId']);
  raw.conditions[0].text='설치 전후에 상관없이 반품 불가';
  assert.equal(resolveGuideEvidence(raw,evidence,unknowns).conditions[0].text,evidence[1].quote);
  raw.steps[0].evidenceId='invented'; assert.throws(()=>resolveGuideEvidence(raw,evidence,unknowns));
});
test('card refund timing does not retrieve unrelated return-inspection or extra-payment policies', () => {
  const sources=[{id:'payment',title:'결제 수단 별 환불 확인은 언제 가능한가요?'},{id:'inspection',title:'판매처에 도착했는데 환불은 언제 되나요?'},{id:'extra',title:'환불 금액이 왜 다른가요?'}];
  const timing={...input,goal:'카드 취소 완료인데 카드 내역은 그대로예요. 언제 돌아오나요?',answers:{payment:'card'}};
  assert.deepEqual(sourcesForSituation(sources,timing,'refund').map(s=>s.id),['payment']);
  assert.deepEqual(sourcesForSituation(sources,{...timing,goal:'환불 금액이 달라요'},'refund').map(s=>s.id),['payment','extra']);
  assert(sourcesForSituation(sources,{...timing,goal:'1만원 결제했는데 8천원만 돌려받았어요'},'refund').some(s=>s.id==='extra'));
  assert.deepEqual(sourcesForSituation(sources,input,'exchange').map(s=>s.id),['payment','inspection']);
});

test('ordinary cancellation and exchange omit unrelated extra-payment and conversion FAQs', () => {
  const sources=[{id:'normal',title:'반품 / 교환 주의사항'},{id:'extra',title:'주문 취소한 상품의 환불금액과 실제 환불된 금액이 상이합니다'},{id:'convert',title:'교환 접수하였으나 반품으로 변경하고 싶어요'}];
  assert.deepEqual(sourcesForSituation(sources,input,'exchange').map(s=>s.id),['normal']);
  assert.deepEqual(sourcesForSituation(sources,{...input,goal:'교환 접수했는데 반품으로 변경하고 싶어요'},'return').map(s=>s.id),['normal','convert']);
  assert.deepEqual(sourcesForSituation(sources,{...input,goal:'환불 금액이 달라요'},'refund').map(s=>s.id),['normal','extra']);
});

test('digital voucher FAQs found in live search cannot become generic product refund evidence', async () => {
  const document=`<ul>${item('일반 상품 주문 취소', '출고 전 상품은 주문 내역에서 취소를 요청할 수 있습니다.')}${item('[쓱콘] 유효기간 만료 후 환불', '만료 후 결제금액의 95%만 환불 가능합니다.', '456')}</ul>`;
  const sources=parseFaq(document,url,'2026-11-15');
  assert.equal(sources.length,2);
  const filtered=sourcesForSituation(sources,{...input,answers:{}},'refund');
  assert.equal(filtered.length,1);assert(!filtered[0].title.includes('쓱콘'));
  const found=await new OfficialFaq({fetchImpl:async()=>response(document)}).search('cancel');
  assert.equal(found.mode,'live');assert.equal(found.sources.length,1);
});

test('known delivery state and return reason select applicable exact excerpts', () => {
  const sources=[{id:'a',body:'출고 전에는 주문을 취소할 수 있습니다. 출고되면 수령 후 반품으로 진행해야 합니다. 급하면 고객센터로 문의하세요.'}];
  const evidence=guideEvidence(sources);
  const shipped=evidenceForSituation(evidence,{answers:{order:'shipped'}},'cancel');
  assert.equal(shipped.length,1);assert(shipped[0].quote.includes('수령 후 반품'));
  const policy=guideEvidence(reviewedSources.filter(s=>s.id==='saved-conditions'));
  const mind=evidenceForSituation(policy,{answers:{reason:'mind'}},'return');
  assert(!mind.some(e=>/3개월|30일/.test(e.quote)));assert(mind.some(e=>e.quote.includes('7일')));
  assert(mind.some(e=>e.quote.includes('세탁')));
  const defect=evidenceForSituation(policy,{answers:{reason:'defect'}},'return');
  assert(defect.some(e=>e.quote.includes('3개월')));assert(!defect.some(e=>e.quote.includes('단순 변심')));
  assert(evidenceForSituation(policy,{answers:{reason:'unknown'}},'return').length===policy.length);
});

test('pending refund searches cancellation evidence without mixing fallback with live sources', async () => {
  const seen=[];
  const faq=new OfficialFaq({fetchImpl:async url=>{seen.push(new URL(url).searchParams.get('keyword'));return response(`<ul>${item('주문한 상품을 전체 또는 일부 상품 주문취소가 가능한가요?','상품 준비중에는 취소 요청 후 출고 여부에 따라 승인 또는 거절됩니다.')}${item('결제 수단 별 환불 확인','카드 취소의 실제 반영 시점과 처리 결과는 해당 카드사에서 확인하세요.','234')}</ul>`);}});
  const found=await faq.search('refund',{}, {includeCancellation:true});
  assert.deepEqual(seen,['환불','주문취소']);
  const selected=sourcesForSituation(found.sources,{goal:'환불 언제 들어오나요?',answers:{payment:'card',refundState:'requested'}},'refund');
  assert(selected.some(s=>/주문.*취소/.test(s.title)));assert(selected.some(s=>/결제 수단/.test(s.title)));
  const fallback=await new OfficialFaq({fetchImpl:async()=>{throw Error('offline');}}).search('refund',{}, {includeCancellation:true});
  assert.equal(fallback.mode,'reviewed');assert(fallback.sources.some(s=>s.id==='saved-cancel'));assert(fallback.sources.every(s=>s.checkedAt==='2026-11-15'));
});

test('generation sees only scoped excerpts, while the reviewer retains full source context', async t => {
  const f=fixture({intent:'return',faq:{search:async()=>({mode:'reviewed',sources:reviewedSources.filter(s=>s.topics.includes('return'))})}});t.after(()=>f.store.close());
  await f.service.guide({...input,answers:{reason:'mind',received:'week'}});
  const writing=f.calls.find(c=>c.name==='replytrack_guide').data;
  const reviewing=f.calls.find(c=>c.name==='replytrack_guide_review').data;
  assert(writing.sources.every(s=>!Object.hasOwn(s,'body')));assert(!writing.evidence.some(e=>e.quote.includes('3개월')));
  assert(reviewing.sources.some(s=>s.body.includes('3개월')));
});

test('shipping-fee excerpts preserve their cause and inspection exception together', () => {
  const body='배송비는 상품마다 다릅니다. ■ 변심에 의한 반품 변심 반품은 고객 부담입니다. ■ 불량/오배송 당사 귀책 반품 고객 비용은 없고 판매자가 부담합니다. (단, 검수 시 고객 귀책이면 배송비가 부과될 수 있습니다.)';
  const evidence=guideEvidence([{id:'fees',body}]);
  const fault=evidence.find(e=>e.quote.includes('판매자가 부담'));
  assert(fault.quote.includes('불량/오배송'));assert(fault.quote.includes('검수 시 고객 귀책'));
  assert(body.includes(fault.quote));assert(fault.quote.length<=180);
  assert(!evidenceForSituation(evidence,{answers:{reason:'mind'}},'return').some(e=>e.quote.includes('판매자가 부담')));
});

test('adjacent seven-day and defect periods never erase each other during evidence selection',()=>{
  const body='단순변심은 배송완료 후 7일 이내 신청 가능합니다. 단, 표시·광고와 다른 상품은 받은 날부터 3개월 이내 또는 알게 된 날부터 30일 이내 신청 가능합니다. ■ 교환/반품 시 유의사항 - 상품 상태를 확인하세요.';
  const evidence=guideEvidence([{id:'period',body}]);
  const defect=evidenceForSituation(evidence,{answers:{reason:'defect'}},'return');
  const mind=evidenceForSituation(evidence,{answers:{reason:'mind'}},'return');
  assert(defect.some(e=>e.quote.includes('3개월') && e.quote.includes('30일')));assert(!defect.some(e=>e.quote.includes('7일')));
  assert(mind.some(e=>e.quote.includes('7일')));assert(!mind.some(e=>e.quote.includes('3개월')));
});

test('one semantic repair is reviewed again, and repeated rejection never publishes a result', async t => {
  const f=fixture();t.after(()=>f.store.close());let reviews=0;
  const original=f.ai.structured;
  f.ai.structured=async p=>{const result=await original(p);if(p.name==='replytrack_guide_review')result.data=reviewResult(++reviews>1,'첫 안내의 조건을 확인하세요.');return result;};
  const result=await f.service.guide(input);
  assert.equal(result.reviewAttempts,2);assert.equal(reviews,2);
  const generated=f.calls.filter(p=>p.name==='replytrack_guide');
  assert.equal(generated.length,2);assert(generated[1].data.previousGuide);assert.match(generated[1].data.revisionFeedback,/조건/);
  const bad=fixture({valid:false});t.after(()=>bad.store.close());
  await assert.rejects(bad.service.guide(input),e=>e.code==='GUIDE_REVIEW');
  assert.equal(bad.calls.filter(p=>p.name==='replytrack_guide').length,2);
  assert.equal(bad.calls.filter(p=>p.name==='replytrack_guide_review').length,2);
  assert.equal(bad.store.list().length,0);
});

test('cancellation at review and provider failures never trigger semantic repair calls', async t => {
  const controller=new AbortController(),f=fixture({valid:false});t.after(()=>f.store.close());
  const original=f.ai.structured;
  f.ai.structured=async p=>{const result=await original(p);if(p.name==='replytrack_guide_review')controller.abort();return result;};
  await assert.rejects(f.service.guide(input,{signal:controller.signal}));
  assert.equal(f.calls.filter(p=>p.name==='replytrack_guide').length,1);
  const failed=fixture({generate:async()=>{throw Error('provider unavailable');}});t.after(()=>failed.store.close());
  await assert.rejects(failed.service.guide(input));assert.equal(failed.calls.filter(p=>p.name==='replytrack_guide').length,1);
});
test('semantic review rejection preserves records', async t => {
  const f = fixture({ valid: false }); t.after(() => f.store.close());
  await assert.rejects(f.service.guide(input), e => e.code === 'GUIDE_REVIEW'); assert.equal(f.store.list().length, 0);
});
test('cancel after generation prevents review and result publication', async t => {
  const controller = new AbortController();
  const f = fixture({ generate: async () => { controller.abort(); return { data: {} }; } }); t.after(() => f.store.close());
  await assert.rejects(f.service.guide(input, { signal: controller.signal }), e => e.code === 'OPERATION_CANCELLED');
  assert(!f.calls.some(p => p.name === 'replytrack_guide_review'));
});
test('retired SSG wizard is no longer exposed through HTTP', async t => {
  const f = fixture(); const app = createApp({ store: f.store, ai: f.ai, faq: f.faq });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => { app.operations.close(); await new Promise(r => app.server.close(r)); f.store.close(); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = body => fetch(`${base}/api/operations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ id: randomUUID(), kind: 'guide', input: { ...input, store: 'other' } })).status, 400); assert.equal(f.calls.length, 0);
  assert.equal((await post({ id: randomUUID(), kind: 'guide', input })).status, 400);
  assert.equal((await fetch(`${base}/official-guide.js`)).status, 404);
});
