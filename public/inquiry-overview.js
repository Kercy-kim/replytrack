import { actionsFresh } from './next-actions.js';

// Read the saved state only. Never infer resolution from an answer or a promise.
export function inquiryOverview(c) {
  const fresh = !!c.analysis && c.analyzedMessageCount === c.messages.length;
  const requestsFresh = actionsFresh(c);
  const questions = fresh ? c.questions : [];
  const promises = fresh ? c.promises.filter(p => !p.confirmedAt) : [];
  return {
    fresh,
    requestsFresh,
    followups: questions.filter(q => ['unanswered', 'partial', 'review'].includes(q.status)).length,
    waitingAnswers: questions.filter(q => q.status === 'waiting').length,
    waitingPromises: promises.filter(p => p.state === 'promised').length,
    confirmations: promises.filter(p => p.state === 'reported').length,
    requests: requestsFresh ? c.nextActions.items.filter(a => !a.completedAt && ['requested', 'review'].includes(a.state)).length : 0,
    hasAgent: c.messages.some(m => m.role === 'agent'),
  };
}

export const needsAttention = o => !!o && !!(o.followups || o.confirmations || o.requests);
export const isWaiting = o => !!o && !!(o.waitingAnswers || o.waitingPromises);

export function inquiryLabel(o) {
  if (!o?.fresh) return '대화 정리 필요';
  if (needsAttention(o)) return '내가 확인할 항목 있음';
  if (isWaiting(o)) return '업체 답변·처리 대기';
  if (o.hasAgent && !o.requestsFresh) return '업체 요청 확인 전';
  return '기록된 확인 항목 없음';
}

export function inquiryOverviewPanel(c, { esc, button }) {
  const o = inquiryOverview(c);
  const waiting = [o.waitingAnswers ? `답변 대기 질문 ${o.waitingAnswers}개` : '', o.waitingPromises ? `처리 약속 ${o.waitingPromises}개` : ''].filter(Boolean).join(' · ');
  return `<section class="inquiry-overview" aria-labelledby="inquiry-overview-title"><div class="inquiry-overview-heading"><h2 id="inquiry-overview-title">문의 진행 요약</h2><span>${esc(inquiryLabel(o))}</span></div>
    <div class="inquiry-overview-items">
      <div><h3>내가 확인할 질문</h3><p>${o.fresh ? o.followups ? `${o.followups}개 · 답변이 부족하거나 확인이 필요해요` : '추가로 확인할 질문 없음' : '새 대화를 정리하면 표시해요'}</p>${button('inquiry-section', '질문 보기', 'text', 'arrow', 'data-value="questions"')}</div>
      <div><h3>업체 답변·처리 대기</h3><p>${o.fresh ? waiting || '기록된 대기 항목 없음' : '이전 분석은 아래에서 확인할 수 있어요'}</p>${button('inquiry-section', '대기 보기', 'text', 'arrow', 'data-value="waiting"')}</div>
      <div><h3>내가 할 일·결과 확인</h3><p>${o.requestsFresh ? `수행·확인할 요청 ${o.requests}개` : o.hasAgent ? '업체 요청은 별도로 확인할 수 있어요' : '아직 업체 답변이 없어요'}${o.confirmations ? `<br>실제 처리 결과 확인 ${o.confirmations}개` : ''}</p>${button('inquiry-section', '할 일 보기', 'text', 'arrow', 'data-value="actions"')}</div>
    </div></section>`;
}
