const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fields = {
  order: { label: '주문 화면의 상태', options: { paid: '결제 완료', preparing: '상품 준비 중', shipped: '배송 중', received: '수령 완료', unknown: '모르겠어요' } },
  reason: { label: '반품·교환 이유', options: { mind: '사이즈·색상·단순 변심', defect: '불량·오배송·설명과 다름', other: '다른 이유', unknown: '모르겠어요' } },
  received: { label: '상품 수령 시점', options: { week: '7일 이내', older: '7일 초과', notyet: '아직 받지 않았어요', unknown: '모르겠어요' } },
  payment: { label: '결제수단', options: { card: '카드·체크카드', other: '그 밖의 결제수단', unknown: '모르겠어요' } },
  refundState: { label: '취소·반품 처리 상황', options: { requested: '요청만 했어요', approved: '취소·반품 완료 안내를 받았어요', unknown: '모르겠어요' } },
};
export const newGuide = () => ({ goal: '', answers: {}, question: null, message: '', result: null });
export function guideTranscript(input) {
  return [input.goal, ...Object.entries(input.answers).filter(([key]) => fields[key]).map(([key, value]) => `${fields[key].label}: ${fields[key].options[value]}`)].join('\n');
}
export function renderGuide(g, { busy, configured, hasDraft }) {
  const disabled = busy ? 'disabled' : '';
  const select = (key, label) => `<label class="field">${esc(label)}<select name="${key}" data-guide-answer="${key}" required ${disabled}><option value="">선택해 주세요</option>${Object.entries(fields[key].options).map(([value, text]) => `<option value="${value}" ${g.answers[key] === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
  const result = g.result;
  const changed = result && ((result.request || result.input).goal !== g.goal || JSON.stringify((result.request || result.input).answers) !== JSON.stringify(g.answers));
  const claim = item => `<li><p>${esc(item.text)}</p><details><summary>공식 근거 보기</summary><blockquote>${esc(item.quote)}</blockquote><a href="${esc(result.sources.find(s => s.id === item.sourceId)?.url)}" target="_blank" rel="noopener noreferrer">${esc(result.sources.find(s => s.id === item.sourceId)?.title)} · 원문 열기</a></details></li>`;
  return `<section class="guide-page" aria-labelledby="guide-heading"><div class="guide-heading"><h1 id="guide-heading">무엇을 도와드릴까요?</h1><p>SSG의 취소·반품·교환·환불 안내를 찾아, 지금 할 일을 정리해 드려요.</p></div>
    <form id="guide-form"><label class="field">쇼핑몰<select name="store" ${disabled}><option value="ssg">SSG.COM</option></select></label><p class="form-note">현재 SSG 일반 상품만 지원해요. 로그인이나 주문 조회 없이 공식 FAQ를 검색합니다.</p>
    <label class="field" for="guide-goal">원하는 일을 편하게 적어 주세요<textarea id="guide-goal" name="goal" rows="3" minlength="2" maxlength="2000" required ${disabled} placeholder="SSG에서 산 옷이 작아서 큰 사이즈로 바꾸고 싶어요.">${esc(g.goal)}</textarea></label>
    <p class="form-note">전화번호·주소는 자동으로 가린 뒤 AI에 전달해요. 이름·주문번호 등은 입력하지 마세요. 입력과 안내는 이 탭에만 유지돼요.</p>
    ${Object.keys(g.answers).filter(key => key !== g.question?.key).map(key => select(key, fields[key].label)).join('')}
    ${g.question ? `<div class="guide-question" role="status">${select(g.question.key, g.question.label)}</div>` : ''}
    ${g.message ? `<p class="warning-note" role="status">${esc(g.message)}</p>` : ''}
    <div class="guide-controls"><button class="btn primary" type="submit" ${disabled}>${g.question ? '이 상황으로 계속하기' : result ? '다시 검색하고 안내받기' : '공식 안내 찾아보기'}</button>${!configured ? `<button class="btn secondary" type="button" data-action="settings" ${disabled}>AI 연결 설정</button>` : ''}<button class="btn text" type="button" data-action="guide-back" ${disabled}>상담 화면으로 돌아가기</button></div></form>
    ${result ? `<section class="guide-result" aria-labelledby="guide-result-heading"><h2 id="guide-result-heading" tabindex="-1">지금은 이렇게 해보세요</h2>${changed ? '<p class="warning-note">아래는 이전 입력의 안내예요. 바뀐 상황으로 다시 검색해 주세요.</p>' : ''}<p class="guide-request">${esc(result.input.goal)}</p><p class="guide-provenance"><strong>${result.mode === 'live' ? '공식 FAQ 실시간 검색' : '검색 실패 · 확인된 자료 사용'}</strong><br>${result.mode === 'reviewed' ? esc(result.reason) : '요청 시 공식 검색 페이지의 답변 본문을 읽었어요. 검색 결과 전체나 개별 상품 정책을 모두 확인한 것은 아니에요.'}</p>
    <ol class="guide-steps">${result.steps.map(claim).join('')}</ol><h3>먼저 확인할 조건</h3><ul class="guide-conditions">${result.conditions.map(claim).join('')}</ul><h3>아직 확인이 필요해요</h3><ul>${result.unknowns.map(text => `<li>${esc(text)}</li>`).join('')}</ul>
    <details class="guide-sources"><summary>사용한 공식 자료와 확인 날짜</summary>${result.sources.map(s => `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><br><small>${result.mode === 'live' ? '본문 조회' : '요약 자료 확인'}: ${esc(s.checkedAt.slice(0, 10))}</small></p>`).join('')}</details>
    <p class="form-note">일반 안내이며 업체가 내 주문에 보낸 답변은 아니에요. 신청·환불을 대신 실행하거나 실제 처리 완료로 표시하지 않습니다. AI 안내는 원문과 함께 확인해 주세요.</p><div class="guide-controls"><button class="btn primary" data-action="guide-handoff" ${busy || changed || hasDraft ? 'disabled' : ''}>이 상황으로 상담 기록 시작하기</button></div>${hasDraft ? '<p class="form-note">작성 중인 새 상담이 있어요. ‘새 상담 시작하기’에서 먼저 등록하면 이 상황으로도 새 기록을 만들 수 있어요.</p>' : ''}</section>` : ''}</section>`;
}
