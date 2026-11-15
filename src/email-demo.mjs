import { newCase, applyAnalysis, history, message } from './domain.mjs';
import { applyActions } from './next-actions.mjs';

export const emailDemoText = {
  customer: 'What documents do you need to recover my account? How long will the review take?',
  agent: 'Please provide the transaction ID from your purchase receipt. Do not send your password or verification codes. After we verify the transaction ID, we will review your recovery request.',
  replies: [
    'We received your transaction ID. The review will take 3 business days. Your account has not been restored yet. We will email you after the review.',
  ],
};
const model = '준비된 가상 이메일 · AI 호출 없음';
const ref = (m, quote) => ({ messageId: m.id, quote });
export function emailDemoAnalysis(c) {
  const [customer, agent, reply] = c.messages;
  const qid = i => c.questions[i]?.id || `email-q-${i}`;
  return {
    summary: reply ? '거래 번호 수신과 검토 기간을 안내받았어요. 계정은 아직 복구 전이에요.' : '제출할 자료는 확인됐지만 검토 기간은 아직 몰라요. 거래 번호 확인 후 복구 요청을 검토한다고 해요.',
    questions: [
      { id: qid(0), title: '계정 복구에 필요한 자료', source: ref(customer, 'What documents do you need to recover my account?'), status: 'answered', reason: '구매 영수증의 거래 번호를 제출하라고 안내받았어요.', evidence: [ref(agent, 'Please provide the transaction ID from your purchase receipt.')], followUp: '' },
      { id: qid(1), title: '복구 검토 소요 기간', source: ref(customer, 'How long will the review take?'), status: reply ? 'answered' : 'partial', reason: reply ? '검토에는 3영업일이 걸린다고 안내받았어요.' : '거래 번호 확인 후 검토하지만 소요 기간은 안내되지 않았어요.', evidence: [ref(reply || agent, reply ? 'The review will take 3 business days.' : 'After we verify the transaction ID, we will review your recovery request.')], followUp: reply ? '' : '거래 번호 확인 후 검토에 얼마나 걸리나요?' },
    ],
    promises: [{ id: c.promises[0]?.id || 'email-review', title: '계정 복구 요청 검토', questionIds: [], evidence: ref(agent, 'After we verify the transaction ID, we will review your recovery request.'), dueText: '', deadlineCleared: false, state: 'promised' }],
  };
}
export function emailDemoActions(c) {
  return { items: [{ id: 'email-receipt', title: '구매 영수증의 거래 번호 보내기', source: ref(c.messages[1], 'Please provide the transaction ID from your purchase receipt.'), condition: '', dueText: '', state: c.demoStep ? 'reported_done' : 'requested', update: c.demoStep ? ref(c.messages[2], 'We received your transaction ID.') : null }] };
}
export function emailDemoExplanation(c) {
  const translations = [
    '구매 영수증의 거래 번호를 보내 주세요. 비밀번호나 인증 코드는 보내지 마세요. 거래 번호 확인 후 복구 요청을 검토합니다.',
    '거래 번호를 받았습니다. 검토에는 3영업일이 걸립니다. 계정은 아직 복구되지 않았으며 검토 후 이메일로 안내합니다.',
  ];
  return { items: c.messages.filter(m => m.role === 'agent').map((m, i) => ({ messageId: m.id, quote: m.text, korean: translations[i] })), messageCount: c.messages.length, at: new Date().toISOString(), model, usage: null };
}
export function emailDemoDraft(c, kind) {
  return kind === 'handoff'
    ? { body: c.demoStep ? '계정 복구에 필요한 자료와 검토 기간을 문의했습니다. 거래 번호를 받았고 검토에 3영업일이 걸리며 계정은 아직 복구되지 않았다고 안내받았습니다.' : '계정 복구에 필요한 자료와 검토 기간을 문의했습니다. 구매 영수증의 거래 번호를 보내 달라는 요청을 받았으며 검토 기간은 아직 안내받지 못했습니다.', sourceMessageIds: c.messages.map(m => m.id) }
    : { body: 'How long will the recovery review take after you verify the transaction ID?', sourceMessageIds: c.messages.slice(0, 2).map(m => m.id) };
}
export function createEmailDemo() {
  const c = newCase({ title: '해외 서비스 계정 복구 이메일', company: '가상 서비스 고객지원', channel: 'email', messages: [{ role: 'customer', text: emailDemoText.customer }, { role: 'agent', text: emailDemoText.agent }] }, 'demo');
  c.demoScenario = 'email'; c.demoStep = 0;
  applyAnalysis(c, emailDemoAnalysis(c), { model, usage: null });
  applyActions(c, emailDemoActions(c), { model, usage: null });
  c.emailExplanation = emailDemoExplanation(c);
  c.demoInitialDraft = emailDemoDraft(c, 'followup');
  return c;
}
export function advanceEmailDemo(c) {
  if (c.demoStep >= emailDemoText.replies.length) return c;
  c.messages.push(message({ role: 'agent', text: emailDemoText.replies[c.demoStep++] }));
  history(c, 'message', '준비된 새 이메일을 반영했어요');
  applyAnalysis(c, emailDemoAnalysis(c), { model, usage: null });
  applyActions(c, emailDemoActions(c), { model, usage: null });
  c.emailExplanation = emailDemoExplanation(c);
  return c;
}
