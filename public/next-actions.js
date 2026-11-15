// Pure presentation decisions; suggestions never become company requests or facts.
export const actionsFresh = c => !!c.nextActions && c.nextActions.messageIds.length === c.messages.length && c.nextActions.messageIds.every((id, i) => id === c.messages[i].id);
export function actionPlan(c) {
  const analysisFresh = !!c.analysis && c.analyzedMessageCount === c.messages.length;
  const requestsFresh = actionsFresh(c);
  const requests = c.nextActions?.items || [];
  return {
    analysisFresh, requestsFresh,
    requests: requests.filter(a => !a.completedAt && ['requested', 'review'].includes(a.state)),
    history: requests.filter(a => a.completedAt || ['reported_done', 'withdrawn'].includes(a.state)),
    suggestions: analysisFresh ? c.questions.filter(q => ['unanswered', 'partial', 'review'].includes(q.status)) : [],
    confirmations: analysisFresh ? c.promises.filter(p => p.state === 'reported' && !p.confirmedAt) : [],
    waiting: analysisFresh ? c.promises.filter(p => p.state === 'promised' && !p.confirmedAt) : [],
  };
}

export function actionsMarkdown(c) {
  const plan = actionPlan(c);
  const requests = (c.nextActions?.items || []).map(a => `- [업체 요청 / ${a.completedAt ? '사용자 수행 확인' : a.state === 'withdrawn' ? '철회 안내' : a.state === 'reported_done' ? '대화에서 수행 안내 / 직접 확인 전' : a.state === 'review' ? '다시 확인 필요' : '수행 전'}] ${a.title}\n  - 근거: ${a.source.quote}${a.condition ? `\n  - 조건: ${a.condition}` : ''}\n  - 기한: ${a.dueAt || '미정'}${a.dueText ? ` (${a.dueText})` : ''}${a.update ? `\n  - 이후 안내: ${a.update.quote}` : ''}`);
  return `## 지금 내가 할 일\n\n${!plan.requestsFresh ? '업체 요청은 최신 원문으로 확인하지 않았습니다. 아래 이전 기록을 현재 지시로 단정하지 마세요.\n\n' : ''}${requests.join('\n') || '확인된 업체 요청 목록 없음'}\n\n${plan.suggestions.map(q => `- [AI 제안 / 업체 요청 아님] 다음 질문의 남은 내용 재문의: ${q.title}`).join('\n')}\n${plan.confirmations.map(p => `- [AI 제안 / 직접 확인 전] 실제 처리 결과 확인: ${p.title}`).join('\n')}\n${plan.waiting.map(p => `- [업체 약속 / 대기] ${p.title} · ${p.dueAt || '기한 미정'}`).join('\n')}\n`;
}

export function renderActionPlan(c, { esc, button, date }) {
  const p = actionPlan(c);
  const source = ref => `<button class="action-source" data-action="source" data-id="${esc(ref.messageId)}">원문: “${esc(ref.quote)}”</button>`;
  const request = a => `<li class="action-row"><div><h4>${esc(a.title)}</h4><p class="action-status">${!p.requestsFresh ? '이전 원문 기준 · 다시 확인 필요' : a.completedAt ? `${date(a.completedAt)} 직접 수행 확인` : { requested: '업체 요청 · 수행 전', review: '이전 요청이 새 결과에서 빠졌어요 · 원문 재확인 필요', reported_done: '대화에서 수행 안내 · 직접 확인 전', withdrawn: '업체가 철회한 요청' }[a.state]}</p>${a.condition ? `<p>조건: ${esc(a.condition)}</p>` : ''}<p>수행 기한: ${a.dueAt ? `${esc(a.dueAt)}까지` : '날짜 미정'}${a.dueText ? ` (${esc(a.dueText)}${!a.dueAt ? ' · 기준 확인 필요' : ''})` : ''}</p>${source(a.source)}${a.update ? `<p class="action-update">이후 안내</p>${source(a.update)}` : ''}</div>${button('complete-action', a.completedAt ? '수행 표시 취소' : '수행했어요', 'secondary compact', '', `data-id="${esc(a.id)}" ${!p.requestsFresh || (!a.completedAt && !['requested','reported_done'].includes(a.state)) ? 'disabled' : ''}`)}</li>`;
  return `<section class="next-actions-section" id="next-actions" aria-labelledby="next-actions-title"><div class="actions-heading"><div><h2 id="next-actions-title">지금 내가 할 일</h2><p>업체의 요청과 AI 제안을 구분해 확인하세요.</p></div>${button('read-actions', c.nextActions ? '업체 요청 다시 확인' : '업체 요청 확인하기', 'secondary compact', '', c.messages.some(m => m.role === 'agent') ? '' : 'disabled')}</div>
    ${!c.nextActions ? '<p class="action-notice">업체 요청 확인하기를 누르면 사진 제출·반품 준비 등 원문에 있는 행동을 찾아요. 새 AI 분석이 필요해요.</p>' : !p.requestsFresh ? '<p class="action-notice" role="status">새 대화가 있어요. 아래 업체 요청은 이전 기록이에요. 다시 확인한 뒤 수행 표시를 해 주세요.</p>' : ''}
    <h3>업체가 요청한 행동</h3><ul class="action-list">${p.requests.map(request).join('')}</ul>${!p.requests.length ? `<p class="action-empty">${p.requestsFresh ? '현재 수행 전으로 분류된 업체 요청이 없어요. 아래 이후 안내와 실제 처리 결과도 확인하세요.' : '최신 원문으로 업체 요청을 확인해 주세요.'}</p>` : ''}
    ${p.history.length ? `<details class="action-history" data-disclosure="actions-history-${esc(c.id)}"><summary>수행·철회 안내와 직접 완료 기록 ${p.history.length}건</summary><ul class="action-list">${p.history.map(request).join('')}</ul></details>` : ''}
    ${!p.analysisFresh ? '<p class="action-notice">질문 분석을 마치면 남은 질문과 실제 처리 확인을 위한 제안도 표시해요.</p>' : `<h3>다음 확인 <span class="action-kind">AI 제안 · 업체 요청 아님</span></h3><ul class="action-list">${p.confirmations.map(a => `<li class="action-row"><div><h4>실제 결과 확인: ${esc(a.title)}</h4><p>업체의 처리 안내와 실제 입금·수신 여부는 따로 확인해요.</p>${source(a.evidence)}</div>${button('confirm-promise','처리 결과 확인','secondary compact','',`data-id="${esc(a.id)}"`)}</li>`).join('')}</ul>${p.suggestions.length ? `<details class="action-suggestions" data-disclosure="suggestions-${esc(c.id)}"><summary>남은 질문 재문의 제안 ${p.suggestions.length}건</summary><ul class="action-list">${p.suggestions.map(q => `<li class="action-row"><div><h4>남은 내용 재문의: ${esc(q.title)}</h4><p>${esc(q.reason)}</p>${source(q.evidence[0] || q.source)}</div>${button('action-followup','이 질문 재문의','text','',`data-id="${esc(q.id)}"`)}</li>`).join('')}</ul></details>` : ''}${!p.confirmations.length && !p.suggestions.length ? '<p class="action-empty">현재 질문·약속 상태에서 추가 확인 제안이 없어요.</p>' : ''}
    ${p.waiting.length ? `<details class="action-waiting" data-disclosure="waiting-${esc(c.id)}"><summary>업체 안내를 기다리는 항목 ${p.waiting.length}건</summary><ul>${p.waiting.map(a => `<li><strong>${esc(a.title)}</strong><p>${a.dueAt ? `${esc(a.dueAt)}까지 예정` : '기한 미정'}${a.dueText ? ` · ${esc(a.dueText)}` : ''}</p>${source(a.evidence)}</li>`).join('')}</ul></details>` : ''}`}
    <p class="actions-footnote">수행 표시는 내가 요청받은 행동을 했다는 뜻이에요. 환불·교환 완료로 바뀌지 않아요.${c.nextActions ? ` · ${date(c.nextActions.at)} 요청 확인` : ''}</p></section>`;
}
