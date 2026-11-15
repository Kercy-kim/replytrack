export function emailExplanationPanel(c, { esc, button, date }) {
  if (c.channel !== 'email') return '';
  const explanation = c.emailExplanation;
  const stale = explanation && explanation.messageCount !== c.messages.length;
  return `<section class="email-explanation panel" aria-label="이메일 한국어 설명"><div class="section-tools"><div><h2>이메일 답변, 한국어로 이해하기</h2><p>원문의 조건과 요청을 확인해요. 실제 제출·복구 완료는 직접 확인해 주세요.</p></div>${button('explain-email', explanation ? '한국어 설명 다시 확인' : '한국어 설명 보기', 'secondary compact', 'spark', c.messages.some(m => m.role === 'agent') ? '' : 'disabled')}</div>
    ${stale ? '<p class="warning-note">새 이메일이 있어요. 아래는 이전 답변 기준 설명이며, 다시 확인하면 새 답변도 반영돼요.</p>' : ''}
    ${explanation ? explanation.items.map((item, i) => `<article class="email-explanation-item"><h3>고객센터 답변 ${i + 1}</h3><p class="message-text">${esc(item.korean)}</p><details><summary>이 설명의 원문 보기</summary><blockquote class="message-text">${esc(item.quote)}</blockquote>${button('source', '대화에서 원문 보기', 'text', 'link', `data-id="${esc(item.messageId)}"`)}</details></article>`).join('') + `<p class="analysis-meta">${date(explanation.at)} · AI 설명은 원문과 대조해 주세요.</p>` : '<p class="quiet-empty">받은 답변을 등록한 뒤 한국어 설명을 확인할 수 있어요. 영어 원문은 그대로 보존해요.</p>'}</section>`;
}
