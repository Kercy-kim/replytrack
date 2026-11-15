import { analysisSchemaFor } from './schema.mjs';
import { AppError } from './errors.mjs';

// Models sometimes join two verbatim sentences separated by another sentence.
// Split only exact, uniquely located sentences in source order; never repair words.
export function splitEmailEvidence(data, messages) {
  if (!Array.isArray(data?.questions)) return data;
  return { ...data, questions: data.questions.map(q => ({ ...q, evidence: Array.isArray(q.evidence) ? q.evidence.flatMap(e => {
    const m = messages.find(m => m.id === e.messageId && m.role === 'agent');
    if (!m || typeof e.quote !== 'string' || m.text.includes(e.quote)) return [e];
    const pieces = e.quote.split(/(?<=[.!?])\s+/);
    if (pieces.length < 2 || pieces.some(s => s.length < 8 || !/[.!?]$/.test(s))) return [e];
    let end = 0;
    for (const piece of pieces) {
      const at = m.text.indexOf(piece);
      if (at < end || at !== m.text.lastIndexOf(piece)) return [e];
      end = at + piece.length;
    }
    return pieces.map(quote => ({ ...e, quote }));
  }) : q.evidence })) };
}

// Only agent additions: the customer's existing question identities cannot change.
// Keep every source message and all semantic decisions in the model's context.
export function emailReplyPlan(c) {
  return c.channel === 'email' ? replyAnalysisPlan(c) : null;
}

export function replyAnalysisPlan(c) {
  const count = c.analyzedMessageCount;
  if ((c.channel !== undefined && !['email', 'chat'].includes(c.channel)) || !c.analysis || !Number.isInteger(count) || count < 1 || count >= c.messages.length || !c.questions.length
    || c.messages.slice(count).some(m => m.role !== 'agent')
    || c.questions.some(q => !/[가-힣]/.test(q.title) || !c.messages.slice(0, count).some(m => m.role === 'customer' && m.id === q.source?.messageId && m.text.includes(q.source.quote)))) return null;
  const schema = analysisSchemaFor(c.messages, c.channel);
  const question = schema.properties.questions.items;
  delete question.properties.title; delete question.properties.source; delete question.properties.followUp;
  question.required = question.required.filter(k => !['title', 'source', 'followUp'].includes(k));
  question.properties.id = { type: 'string', enum: c.questions.map(q => q.id) };
  schema.properties.questions.minItems = c.questions.length;
  schema.properties.questions.maxItems = c.questions.length;
  // Deadline revisions must preserve the existing promise identity, not create
  // a cleared old promise plus a second promise with the replacement date.
  const revisesDatedPromise = c.promises?.some(p => p.dueAt || p.dueText)
    && c.messages.slice(count).some(m => /정정|수정|변경|취소|철회|번복|아니|않|\b(correct\w*|revis\w*|chang\w*|cancel\w*|retract\w*|withdraw\w*|instead|not|wrong|incorrect)\b/i.test(m.text));
  const shortContext = c.questions.length <= 4 && c.messages.length <= 6 && c.messages.reduce((n, m) => n + m.text.length, 0) <= 2500;
  const conditional = c.messages.some(m => m.role === 'agent' && /조건|경우|예외|원칙|다만|하지만|면|\b(if|unless|only|except|provided|after|before|once|when|until|however)\b/i.test(m.text));
  const emailCorrection = c.channel === 'email' && c.messages.some(m => m.role === 'agent' && /정정|철회|번복|변경|잘못|앞서|앞선|\b(correct\w*|incorrect|revis\w*|retract\w*|supersed\w*|previous\w*|chang\w*|disregard|instead)\b/i.test(m.text));
  return {
    schema,
    focused: shortContext && !conditional && c.channel !== 'email',
    effort: !revisesDatedPromise && !emailCorrection && shortContext && !conditional ? 'low' : 'medium',
    instructions: '\n이번에는 고객의 새 질문 없이 업체 답변만 추가되었습니다. existingQuestions의 각 id를 정확히 한 번씩 반환하고 모든 원문을 검토해 상태·이유·근거와 약속을 갱신하세요. 기존 질문의 title/source는 서버가 원래 값 그대로 복원하므로 출력하지 않습니다. 질문을 합치거나 새 질문을 만들지 마세요. 이전 상태는 정답이 아니며 새 답변의 정정·조건·부정도 다시 판단하세요. 일반적인 심사·검토 소요 기간 설명은 그 자체로 특정 행동 약속이 아닙니다. 이미 수신·접수한 행동의 기한에 후속 심사·검토 기간을 붙이지 마세요.',
    restore(data) {
      const rows = data?.questions;
      if (!Array.isArray(rows) || rows.length !== c.questions.length || new Set(rows.map(q => q?.id)).size !== rows.length
        || rows.some(q => !c.questions.some(old => old.id === q?.id))) throw new AppError(502, '질문 연결을 확인하지 못했어요. 기존 기록은 유지됩니다.', 'AI_EVIDENCE');
      return { ...data, questions: rows.map(q => {
        const old = c.questions.find(old => old.id === q.id);
        return { ...q, title: old.title, source: structuredClone(old.source) };
      }) };
    },
  };
}
