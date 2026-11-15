import { createDemo, demoAnalysis, demoDraft } from '../../src/demo.mjs';
import { AppError } from '../../src/errors.mjs';

// Deterministic transport/UI fixture only. Never selected by the production server.
export class WebFixtureAI {
  configured = true;
  model = '검증용 응답 · 실제 AI 호출 없음';
  failAnalysis = false;
  calls = [];
  async structured({ name, data }) {
    this.calls.push({ name, data });
    let result;
    if (name === 'replytrack_connection') {
      result = { ok: true };
    } else if (name === 'replytrack_transcript') {
      result = { messages: createDemo().messages.map(({ role, text }) => ({ role, text, sentAt: null })), notes: [] };
    } else if (name === 'replytrack_analysis') {
      if (this.failAnalysis) throw new AppError(502, '검증용 일시 분석 오류');
      result = demoAnalysis({ messages: data.messages, questions: data.existingQuestions, promises: data.existingPromises });
    } else if (name === 'replytrack_draft_review') {
      result = { valid: true, feedback: '', checks: { consumerVoice: true, selectedQuestionsCovered: true, sourceFactsOnly: true, noExtraRequests: true, noAnsweredRequests: true } };
    } else {
      result = demoDraft({ messages: data.messages, questions: data.questions.map(q => ({ ...q, title: q.topicHint ?? q.title })), promises: data.promises }, data.kind, data.questions.map(q => q.id));
    }
    return { data: result, model: this.model, usage: null };
  }
}

export const fixtureText = createDemo().messages.map(m => `${m.role === 'customer' ? '나' : '고객센터'}: ${m.text}`).join('\n\n');
