import { emailCases } from '../../evals/email-cases.mjs';
export class EmailFixtureAI {
  configured = true;
  model = 'Fixture: no live AI';
  calls = [];
  async structured(args) {
    this.calls.push(args); const { name, data } = args, f = emailCases[0]; let result;
    if (name === 'replytrack_connection') result = { ok: true };
    else if (name === 'replytrack_transcript') result = { messages: data.existingMessages?.length ? [{ role: 'agent', text: f.reply, sentAt: null }] : [{ role: 'customer', text: f.customer, sentAt: null }, { role: 'agent', text: f.agent, sentAt: null }], notes: [] };
    else if (name === 'replytrack_analysis') {
      const first = data.messages[0], last = data.messages.at(-1), updated = last.text === f.reply;
      result = { summary: '계정 복구 자료와 검토 소요 기간을 문의했어요.', questions: [
        { id: data.existingQuestions[0]?.id || 'q-doc', title: '복구에 필요한 자료', source: { messageId: first.id, quote: 'What documents do you need to recover my account?' }, status: 'answered', reason: '거래 번호 제출을 요청했어요.', evidence: [{ messageId: data.messages[1].id, quote: f.agent }], followUp: '' },
        { id: data.existingQuestions[1]?.id || 'q-time', title: '검토 소요 기간', source: { messageId: first.id, quote: 'How long will the review take?' }, status: updated ? 'answered' : 'partial', reason: updated ? '3영업일 걸린다고 안내했어요.' : '거래 번호 확인 후 검토하지만 소요 기간은 안내하지 않았어요.', evidence: [{ messageId: last.id, quote: last.text }], followUp: updated ? '' : '검토 소요 기간을 알려 주세요.' },
      ], promises: [] };
    } else if (name === 'replytrack_email_explanation') result = { items: data.messages.map(m => ({ messageId: m.id, quote: m.text, korean: m.text === f.reply ? '거래 번호를 받았으며 검토에는 3영업일이 걸립니다. 계정은 아직 복구되지 않았고 검토 후 이메일로 안내합니다.' : '구매 영수증의 거래 번호를 보내 주세요. 비밀번호나 인증 코드는 보내지 마세요. 거래 번호 확인 후 복구 요청을 검토합니다.' })) };
    else if (name.endsWith('_review')) result = { valid: true, feedback: '' };
    else if (name === 'replytrack_draft') result = { body: 'How long will the review of my recovery request take?', sourceMessageIds: data.messages.map(m => m.id) };
    else throw new Error(`Unexpected fixture request: ${name}`);
    return { data: result, model: this.model };
  }
}
