import { newCase, applyAnalysis, message, history } from './domain.mjs';

export const demoReplies = [
  '왕복 배송비는 업체에서 부담하며, 내일까지 견적을 안내하겠습니다.',
  '점검 결과 수리비는 25,000원입니다. 견적 안내를 완료했습니다. 수리 진행 여부를 알려 주세요.',
];
export function demoAnalysis(c) {
  const [customer, first, second, third] = c.messages;
  const ref = (m, quote) => ({ messageId: m.id, quote });
  const qid = i => c.questions[i]?.id ?? `q-${i}`;
  return {
    summary: third ? '수리비·기간·배송비 안내를 받았어요. 실제 견적 수신을 확인하고 수리 진행 여부를 답하면 됩니다.' : second ? '배송비는 업체 부담으로 확인됐어요. 내일까지 안내받기로 한 견적을 기다리고 있어요.' : '수리 기간은 확인됐어요. 수리비는 점검 후 안내 예정이며, 배송비는 아직 답변이 없어요.',
    questions: [
      { id: qid(0), title: '수리비는 얼마인가요?', source: ref(customer, '수리비는 얼마인가요?'), status: third ? 'answered' : 'waiting', reason: third ? '수리비가 25,000원으로 안내됐어요. 실제 견적을 받았는지는 별도로 확인해 주세요.' : '점검 후 금액을 안내하겠다는 답변으로, 구체적인 비용은 아직 미정이에요.', evidence: [ref(third ?? second ?? first, third ? '점검 결과 수리비는 25,000원입니다.' : second ? '내일까지 견적을 안내하겠습니다.' : '수리비는 점검 후 안내하겠습니다.')], followUp: third ? '' : '견적을 언제 안내받을 수 있을까요?' },
      { id: qid(1), title: '입고 후 수리는 며칠 걸리나요?', source: ref(customer, '입고 후 수리는 며칠 걸리나요?'), status: 'answered', reason: '입고 이후 예상 소요 기간을 안내받았어요. 실제 수리 완료를 뜻하지는 않아요.', evidence: [ref(first, '입고 후 수리는 3~5영업일 정도 소요되며')], followUp: '' },
      { id: qid(2), title: '왕복 배송비는 누가 부담하나요?', source: ref(customer, '왕복 배송비는 누가 부담하나요?'), status: second ? 'answered' : 'unanswered', reason: second ? '왕복 배송비의 부담 주체가 업체로 명시됐어요.' : '고객센터 답변에 왕복 배송비에 관한 안내가 없어요.', evidence: second ? [ref(second, '왕복 배송비는 업체에서 부담하며')] : [], followUp: second ? '' : '왕복 배송비는 누가 부담하나요?' },
    ],
    promises: [{ id: c.promises[0]?.id ?? 'p-0', title: '점검 후 수리 견적 안내', questionIds: [qid(0)], evidence: ref(third ?? second ?? first, third ? '견적 안내를 완료했습니다.' : second ? '내일까지 견적을 안내하겠습니다.' : '수리비는 점검 후 안내하겠습니다.'), dueText: third ? '' : second ? '내일까지' : '', state: third ? 'reported' : 'promised' }],
  };
}
export function createDemo() {
  const now = new Date().toISOString();
  const c = newCase({ title: '무선 청소기 A/S 문의', company: '클린홈 고객센터', messages: [
    { role: 'customer', text: '안녕하세요. 무선 청소기가 작동하지 않아서 수리를 맡기려고 합니다. 수리비는 얼마인가요? 입고 후 수리는 며칠 걸리나요? 왕복 배송비는 누가 부담하나요?', sentAt: now },
    { role: 'agent', text: '안녕하세요, 클린홈 고객센터입니다. 입고 후 수리는 3~5영업일 정도 소요되며, 수리비는 점검 후 안내하겠습니다.', sentAt: now },
  ] }, 'demo');
  c.demoStep = 0;
  return applyAnalysis(c, demoAnalysis(c), { model: '준비된 예제 · AI 호출 없음', usage: null });
}
export function advanceDemo(c) {
  if (c.demoStep >= demoReplies.length) return c;
  c.messages.push(message({ role: 'agent', text: demoReplies[c.demoStep++], sentAt: new Date().toISOString() }));
  history(c, 'message', '예제 답변을 추가했어요');
  return applyAnalysis(c, demoAnalysis(c), { model: '준비된 예제 · AI 호출 없음', usage: null });
}
export function demoDraft(c, kind, ids) {
  const questions = c.questions.filter(q => ids.includes(q.id) && q.status !== 'answered');
  return {
    body: kind === 'handoff'
      ? `무선 청소기 A/S 문의를 이어서 상담받고 싶습니다. ${c.summary} ${c.questions.map(q => `${q.title} — ${q.reason}`).join(' ')}${c.promises.some(p => p.confirmedAt) ? '견적 수신은 제가 확인했습니다.' : '견적 수신 여부는 아직 직접 확인하지 않았습니다.'}`
      : `안녕하세요. 앞서 문의한 무선 청소기 A/S 건으로 추가 확인 부탁드립니다. ${questions.map(q => q.followUp || q.title).join(' ')} 감사합니다.`,
    sourceMessageIds: c.messages.map(m => m.id),
  };
}
