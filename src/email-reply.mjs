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

// A receipt alone cannot fulfill a previously promised verification/review.
// Route suspicious ID reuse to semantic review; never rewrite a state here.
export function receiptFulfillsDifferentAction(data, record) {
  return record.channel === 'email' && data.promises.some(p => {
    const old = record.promises.find(previous => previous.id === p.id && previous.state === 'promised');
    const quote = p.evidence?.quote || '';
    return old && p.state === 'reported'
      && /\b(?:will|shall|going to)\s+(?:(?:also|then)\s+)?(?:review|verify|assess)\b/i.test(old.evidence?.quote || '')
      && /\b(receiv\w*|receipt)\b/i.test(quote)
      && !/\b(review\w*|verif\w*|assess\w*)\b/i.test(quote);
  });
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
  const targetedEmail = c.channel === 'email' && shortContext && !emailCorrection && !revisesDatedPromise;
  if (targetedEmail) {
    const promises = schema.properties.promises;
    promises.description = '모든 업체 메시지의 개별 업무 확약·수행 통보를 각각 보존한다. 자료 수신, 자료 검증, 심사, 결과 이메일은 서로 다른 행동이다. 질문이 answered여도 별도의 We will email you after the review. 통지 약속을 누락하지 않는다.';
    promises.items.properties.id = { type: 'string', description: '기존 ID는 같은 행동에만 재사용한다. 자료 수신에 기존 심사·검토 약속 ID를 사용하지 말고 별도 새 ID를 만든다.' };
    promises.items.properties.state.description = 'reported는 이 약속의 행동 자체를 했다고 명시한 경우만. 자료를 받았다고 심사·검증을 수행한 것은 아니다. 선행조건 수행만으로 기존 약속을 완료시키지 않는다.';
    promises.items.properties.dueText = { type: 'string', description: '이 행동의 확약에 직접 붙은 기한만 원문 그대로. 일반 review will take 기간 설명을 기존 심사 확약의 새 기한으로 옮기지 않는다. will complete your review within 기간은 해당 행동 완료 확약의 기한이다.' };
    // Separate old-action updates from newly discovered actions in the output.
    // The model still decides whether an old action remains and all its semantics.
    if (c.promises.length) {
      schema.properties.existingPromiseUpdates = structuredClone(promises);
      schema.properties.existingPromiseUpdates.description = '기존 약속 중 여전히 유효하거나 수행된 동일 행동만 갱신한다. 행동을 바꾸지 않는다. 기존 심사 약속에 자료 수신이나 후속 통지를 합치지 않는다.';
      schema.properties.existingPromiseUpdates.items.properties.id = { type: 'string', enum: c.promises.map(p => p.id) };
      schema.properties.newPromises = promises;
      schema.properties.newPromises.description = '기존 약속과 다른 새 행동. 자료 수신 통보와 결과 이메일 약속처럼 각각의 업무를 따로 기록한다. 질문이 answered여도 행동을 누락하지 않는다. 기존 약속 ID를 쓰지 않는다.';
      delete schema.properties.promises;
      schema.required = schema.required.filter(k => k !== 'promises').concat('existingPromiseUpdates', 'newPromises');
      schema.properties = { existingPromiseUpdates: schema.properties.existingPromiseUpdates, newPromises: schema.properties.newPromises, questions: schema.properties.questions, summary: schema.properties.summary };
    }
  }
  return {
    schema,
    focused: shortContext && !conditional && c.channel !== 'email',
    emailActionScope: targetedEmail,
    parallel: targetedEmail && c.promises.length > 0,
    effort: !revisesDatedPromise && !emailCorrection && shortContext && !conditional ? 'low' : 'medium',
    instructions: '\n이번에는 고객의 새 질문 없이 업체 답변만 추가되었습니다. existingQuestions의 각 id를 정확히 한 번씩 반환하고 모든 원문을 검토해 상태·이유·근거와 약속을 갱신하세요. 기존 질문의 title/source는 서버가 원래 값 그대로 복원하므로 출력하지 않습니다. 질문을 합치거나 새 질문을 만들지 마세요. 이전 상태는 정답이 아니며 새 답변의 정정·조건·부정도 다시 판단하세요. 일반적인 심사·검토 소요 기간 설명은 그 자체로 특정 행동 약속이 아닙니다. 이미 수신·접수한 행동의 기한에 후속 심사·검토 기간을 붙이지 마세요.'
      + (targetedEmail ? '\n이메일 약속의 인용은 해당 행동·조건·기한을 뒷받침하는 구절만 선택합니다. 여러 행동이 있는 답장 전체를 한 약속의 근거로 복사하지 않습니다. 예: 이전 After we verify the transaction ID, we will review your recovery request. 약속 뒤 We received your transaction ID. The review will take 3 business days. Your account has not been restored yet. We will email you after the review.가 오면 기존 검토 약속은 원래 인용·ID·빈 기한을 보존하고, 자료 수신(reported)과 심사 후 이메일(promised)은 각각의 문장을 근거로 구분합니다. 3 business days는 기간 질문의 답이며 기존 검토 약속의 새 기한이 아닙니다. 반대로 We will complete your review within 3 business days.처럼 해당 행동의 완료 확약에 기간이 붙으면 같은 행동의 기존 ID에 그 기한을 반영합니다. 계정 미복구라는 부정을 복구 완료로 바꾸지 않습니다.' : ''),
    restore(data) {
      if (targetedEmail && c.promises.length) {
        if (!Array.isArray(data?.existingPromiseUpdates) || !Array.isArray(data?.newPromises)
          || data.existingPromiseUpdates.some(p => !c.promises.some(old => old.id === p.id))
          || data.newPromises.some(p => c.promises.some(old => old.id === p.id))) throw new AppError(502, '기존 약속과 새 행동의 연결이 맞지 않아 기존 기록을 유지합니다.', 'AI_EVIDENCE');
        const { existingPromiseUpdates, newPromises, ...rest } = data;
        data = { ...rest, promises: [...existingPromiseUpdates, ...newPromises] };
      }
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
