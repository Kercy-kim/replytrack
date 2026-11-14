const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const names = { unanswered: '미답변', partial: '부분 답변', waiting: '답변 대기', answered: '답변 받음', review: '확인 필요' };
const icons = {
  plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chat: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  file: '<path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  edit: '<path d="m14 4 6 6M4 20l5-1L21 7l-6-6L3 13l1 7Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chat}</svg>`;
const state = { cases: [], current: null, config: { configured: false, model: 'gpt-5-mini' }, busy: '', tab: 'questions', mobile: 'analysis', filter: 'all', selected: new Set(), draftEdits: {}, error: '', onboarding: null };
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(path, method = 'GET', data) {
  const res = await fetch(path, { method, ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const result = await res.json();
  if (!res.ok) { const e = new Error(result.error || '요청에 실패했습니다.'); e.status = res.status; throw e; }
  return result;
}
async function work(label, fn) {
  if (state.busy) return;
  state.busy = label; state.error = ''; render(); setModalBusy(true);
  try { await fn(); }
  catch (e) {
    state.error = e.message; toast(e.message);
    const error = $('#modal-error'); if (error) error.textContent = e.message;
    if (e.status === 409 && state.current) await loadCase(state.current.id).catch(() => {});
  } finally { state.busy = ''; render(); setModalBusy(false); }
}
function setModalBusy(busy) {
  $('#modal').querySelectorAll('button, input, select, textarea').forEach(el => { el.disabled = busy; });
  const status = $('#modal-status'); if (status) status.textContent = busy ? state.busy : '';
}
async function refreshList() { state.cases = await api('/api/cases'); }
function setCase(c) {
  const edits = {};
  if (state.current?.id === c.id) {
    for (const [kind, text] of Object.entries(state.draftEdits)) {
      if (c.drafts[kind] && c.drafts[kind].body === state.current.drafts[kind]?.body) edits[kind] = text;
    }
  }
  if (state.current?.id !== c.id) state.mobile = 'analysis';
  state.current = c; state.selected = new Set(c.questions.filter(q => q.status !== 'answered').map(q => q.id)); state.draftEdits = edits;
  localStorage.setItem('replytrack:last-case', c.id);
}
async function loadCase(id) { setCase(await api(`/api/cases/${id}`)); await refreshList(); }
const date = value => value ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '날짜 미입력';
const badge = status => `<span class="badge ${status}"><span class="status-dot"></span>${names[status]}</span>`;
const button = (action, label, type = 'secondary', symbol = '', attrs = '') => `<button class="btn ${type}" data-action="${action}" ${state.busy ? 'disabled' : ''} ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
function render() {
  const c = state.current;
  $('#app').innerHTML = `<a class="skip" href="#main">본문으로 이동</a>
    <aside class="sidebar">
      <a href="/" class="brand" data-action="home" aria-label="ReplyTrack 홈"><img src="/favicon.svg" width="35" height="35" alt=""><span>ReplyTrack<span class="brand-dot">.</span></span></a>
      <div class="workspace-label">나의 상담 워크스페이스</div>
      ${button('new', '새 상담 시작하기', 'primary wide', 'plus')}
      <div class="nav-heading"><span>내 상담</span><span>${state.cases.length.toString().padStart(2, '0')}</span></div>
      <nav class="case-list" aria-label="상담 목록">${state.cases.length ? state.cases.map(item => `<button class="case-item ${c?.id === item.id ? 'active' : ''}" data-action="open" data-id="${item.id}" ${state.busy ? 'disabled' : ''}>${icon('chat')}<span><strong>${esc(item.title)}</strong><small>${esc(item.company)}${item.mode === 'demo' ? ' · 예제' : ''}</small></span>${item.unanswered ? `<b>${item.unanswered}</b>` : icon('check')}</button>`).join('') : '<p class="sidebar-empty">새 상담을 시작하면<br>이곳에 기록이 쌓여요.</p>'}</nav>
      <div class="sidebar-bottom"><div class="demo-promo"><span class="eyebrow">FIRST TIME HERE?</span><strong>어떻게 이어주는지 궁금하다면</strong><p>가상의 A/S 상담으로<br>전체 흐름을 체험해 보세요.</p>${button('demo', '예제 상담 열기', 'text', 'arrow')}</div>
      <button class="connection" data-action="settings"><span class="connection-dot ${state.config.configured ? 'connected' : ''}"></span><span>${state.config.configured ? 'OpenAI 연결됨' : 'AI 연결 설정'}<small>${state.config.configured ? esc(state.config.model) : '실제 상담 분석에 사용해요'}</small></span>${icon('settings')}</button>
      <div class="local-note">로컬 워크스페이스 · 이 기기에 저장</div></div>
    </aside>
    <main id="main" class="main">
      <header class="topbar"><div>워크스페이스 <span>/</span> <strong>${c ? '상담 기록' : '시작하기'}</strong></div><span class="topbar-note">놓친 답변 없이, 다음 이야기로</span><button class="avatar" data-action="settings" aria-label="AI 연결 설정">R</button></header>
      ${state.busy ? `<div class="busy-bar" role="status"><span class="spinner"></span>${esc(state.busy)}<small>화면을 닫지 않고 잠시 기다려 주세요</small></div>` : ''}
      ${state.error ? `<div class="error-banner" role="alert">${esc(state.error)}<button data-action="dismiss-error" aria-label="오류 안내 닫기">${icon('close')}</button></div>` : ''}
      ${c ? detail(c) : landing()}
      <footer class="footer">ReplyTrack <span>대화는 이어지고, 기록은 남으니까.</span><span>AI 판단은 원문과 함께 확인해 주세요.</span></footer>
    </main>`;
}
function landing() {
  return `<section class="welcome"><div class="welcome-copy"><span class="eyebrow">YOUR CONVERSATION, CONTINUED</span><h1>답변은 받았는데,<br><span>다 해결된 걸까요?</span></h1><p>빠진 답변부터 아직 남은 약속까지.<br>고객센터와의 대화를 한눈에 정리하고,<br>필요한 이야기만 이어가세요.</p><div class="welcome-actions">${button('new', '내 상담 정리하기', 'primary', 'plus')}${button('demo', '예제로 먼저 둘러보기', 'secondary', 'arrow')}</div><div class="welcome-footnote">텍스트 붙여넣기 · 대화 캡처 · 질문별 원문 근거</div></div>
    <div class="welcome-visual" aria-label="질문과 답변 상태 예시"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="visual-label">FROM CONVERSATION TO CLARITY</div><div class="sample-message">${icon('chat')}<p>“수리비, 수리 기간, 배송비가 궁금해요.”</p></div><div class="sample-card"><div class="sample-card-head"><span class="tiny-logo">${icon('spark')}</span><strong>세 가지 질문, 놓치지 않도록</strong><span class="sample-tag">예시</span></div><div class="sample-row"><span>01</span><strong>수리비 안내</strong>${badge('waiting')}</div><div class="sample-row"><span>02</span><strong>수리 소요 기간</strong>${badge('answered')}</div><div class="sample-row"><span>03</span><strong>왕복 배송비</strong>${badge('unanswered')}</div><div class="sample-bottom">${icon('link')}모든 판단은 원문으로 연결돼요</div></div><div class="sample-follow">${icon('arrow')}남은 질문만 담아, 다음 문의로.</div></div></section>
    <section class="benefits"><article><span>01 / COLLECT</span><h2>대화는 한곳에</h2><p>메신저, 이메일, 고객센터 채팅.<br>흩어진 상담을 붙여넣어 주세요.</p></article><article><span>02 / CHECK</span><h2>빠진 답변은 선명하게</h2><p>질문별 답변 상태와 실제 처리 약속을<br>원문 근거와 함께 확인해요.</p></article><article><span>03 / CONTINUE</span><h2>다음 문의는 간결하게</h2><p>아직 필요한 질문만 담은 초안으로<br>같은 설명을 반복하지 않아요.</p></article></section>`;
}
function detail(c) {
  const unresolved = c.questions.filter(q => q.status !== 'answered').length;
  const answered = c.questions.length - unresolved;
  const pending = c.analyzedMessageCount < c.messages.length;
  return `<section class="case-heading"><div><div class="eyebrow">${esc(c.company)} <span class="middle-dot">·</span> ${c.mode === 'demo' ? 'DEMO CASE' : 'MY CASE'}</div><h1>${esc(c.title)}</h1><p>${esc(c.summary || '상담은 안전하게 저장됐어요. 질문을 분석하면 확인표가 만들어져요.')}</p></div><div class="heading-actions">${button('export', '기록 저장', 'secondary compact', 'download')}${button('delete', '', 'icon-btn', 'close', 'aria-label="상담 삭제"')}</div></section>
    ${c.mode === 'demo' ? `<div class="demo-banner"><span>${icon('spark')}<strong>예제 상담</strong> 준비된 가상 데이터예요. AI API를 호출하지 않아요.</span>${c.demoStep < 2 ? button('demo-next', c.demoStep === 0 ? '예제 답변 추가하기' : '견적 도착 시연하기', 'text', 'arrow') : '<span class="demo-complete">모든 예제 답변을 확인했어요</span>'}</div>` : ''}
    ${pending ? `<div class="pending-banner"><span>새 메시지가 저장됐어요. 분석하면 질문과 약속에 반영돼요.</span>${button('analyze', c.questions.length ? '새 답변 분석' : '질문 분석하기', 'primary compact', 'spark')}</div>` : ''}
    <section class="stats" aria-label="상담 현황"><div><span class="stat-icon neutral">${icon('chat')}</span><span>전체 질문<strong>${c.questions.length}<small>개</small></strong></span></div><div><span class="stat-icon green">${icon('check')}</span><span>답변 받은 질문<strong>${answered}<small>개</small></strong></span></div><div><span class="stat-icon orange">${icon('clock')}</span><span>아직 남은 질문<strong>${unresolved}<small>개</small></strong></span></div><div><span class="stat-icon violet">${icon('file')}</span><span>확인할 처리 약속<strong>${c.promises.filter(p => !p.confirmedAt).length}<small>개</small></strong></span></div></section>
    <div class="mobile-switch" role="group" aria-label="보기 선택"><button data-action="mobile" data-value="source" class="${state.mobile === 'source' ? 'active' : ''}">상담 원문</button><button data-action="mobile" data-value="analysis" class="${state.mobile === 'analysis' ? 'active' : ''}">질문 확인표</button></div>
    <div class="workspace mobile-${state.mobile}"><section class="source-panel panel"><div class="panel-header"><div>${icon('chat')}<h2>상담 원문</h2><span class="count">${c.messages.length}</span></div><span class="subtle">${c.mode === 'demo' ? '가상 상담' : '검토한 텍스트'}</span></div><div class="source-messages">${c.messages.map(m => `<article class="message ${m.role}" id="message-${m.id}"><div class="message-meta"><span class="speaker-avatar">${m.role === 'customer' ? '나' : 'CS'}</span><strong>${m.role === 'customer' ? '나' : esc(c.company)}</strong><time>${date(m.sentAt)}</time></div><div class="message-text">${esc(m.text)}</div></article>`).join('')}</div><div class="source-bottom"><span>${icon('link')}근거를 누르면 해당 원문으로 이동해요</span>${c.mode === 'live' ? button('append', '새 답변 / 질문 추가', 'secondary wide', 'plus') : ''}</div></section>
    <section class="analysis-panel"><div class="tabs" role="tablist" aria-label="분석 보기">${[['questions','질문 확인표', c.questions.length],['drafts','재문의 · 인계', null],['history','변경 이력', null]].map(([id,label,count]) => `<button role="tab" aria-selected="${state.tab === id}" class="${state.tab === id ? 'active' : ''}" data-action="tab" data-value="${id}">${label}${count !== null ? `<span>${count}</span>` : ''}</button>`).join('')}</div>${c.warnings.map(w => `<div class="warning-note">${esc(w)}</div>`).join('')}${state.tab === 'questions' ? questionPanel(c) : state.tab === 'drafts' ? draftPanel(c) : historyPanel(c)}</section></div>`;
}
function questionPanel(c) {
  const visible = c.questions.filter(q => state.filter !== 'remaining' || q.status !== 'answered');
  return `<div class="section-tools"><div><h2>어떤 답변이 아직 남아 있나요?</h2><p>답변 수신과 실제 처리 완료는 따로 확인해요.</p></div><select id="question-filter" aria-label="질문 필터"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>모든 질문</option><option value="remaining" ${state.filter === 'remaining' ? 'selected' : ''}>남은 질문만</option></select></div>
    <div class="question-list">${visible.length ? visible.map(q => `<article class="question-card ${q.status}"><div class="question-top"><span class="question-number">Q${String(c.questions.indexOf(q) + 1).padStart(2, '0')}</span>${badge(q.status)}<button class="edit-button" data-action="edit-question" data-id="${q.id}" aria-label="${esc(q.title)} 수정">${icon('edit')}</button></div><h3>${esc(q.title)}</h3><p class="reason">${esc(q.reason)}</p>${q.manualStatus ? `<p class="manual-note">직접 수정한 상태 · AI 제안: ${names[q.aiStatus]}</p>` : ''}<div class="evidence">${q.evidence.length ? q.evidence.map(e => `<button data-action="source" data-id="${e.messageId}" class="quote">${icon('link')}<span>“${esc(e.quote)}”</span>${icon('arrow')}</button>`).join('') : `<button class="quote empty-quote" data-action="source" data-id="${q.source.messageId}">${icon('link')}<span>이 질문에 연결된 답변이 아직 없어요. 질문 원문 보기</span>${icon('arrow')}</button>`}</div></article>`).join('') : `<div class="empty-panel">${icon('check')}<h3>${c.questions.length ? '모든 질문에 답변을 받았어요' : '첫 확인표를 만들어 볼까요?'}</h3><p>${c.questions.length ? '아래 처리 약속도 실제로 이행됐는지 확인해 주세요.' : '위의 질문 분석하기를 누르면 원문과 연결된 질문 카드가 생겨요.'}</p></div>`}</div>
    <section class="promise-section"><div class="section-title"><div>${icon('clock')}<h2>답변 뒤에 남은 약속</h2></div><span>${c.promises.length}건</span></div><p class="section-description">안내받은 약속과 실제로 확인한 결과를 구분해요.</p>${c.promises.length ? c.promises.map(p => `<article class="promise-card ${p.confirmedAt ? 'confirmed' : ''}"><div><span class="promise-label">${p.confirmedAt ? '사용자 확인 완료' : p.state === 'reported' ? '업체의 처리 안내 · 직접 확인 전' : '처리 약속 · 직접 확인 전'}</span><h3>${esc(p.title)}</h3><div class="due">${icon('clock')}${p.dueAt ? `${esc(p.dueAt)}까지` : '기한 미정'}${p.dueText ? ` <span>(${esc(p.dueText)}${!p.dueAt ? ' · 기준 날짜 확인 필요' : ''})</span>` : ''}</div><button class="promise-source" data-action="source" data-id="${p.evidence.messageId}">“${esc(p.evidence.quote)}” ${icon('link')}</button>${p.confirmedAt ? `<small class="confirmed-time">${date(p.confirmedAt)} 직접 확인</small>` : ''}</div>${button('confirm-promise', p.confirmedAt ? '확인 취소' : '직접 확인했어요', p.confirmedAt ? 'text' : 'secondary compact', p.confirmedAt ? 'check' : '', `data-id="${p.id}"`)}</article>`).join('') : '<p class="quiet-empty">명시적인 처리 약속이 나오면 여기에 모아 둘게요.</p>'}</section>
    ${c.questions.length ? `<div class="next-step"><span>${icon('spark')}남은 질문을 다시 설명할 필요 없어요.</span>${button('draft-tab', '재문의 초안 만들기', 'primary compact', 'arrow')}</div>` : ''}
    ${c.analysis ? `<p class="analysis-meta">${esc(c.analysis.model)} · ${date(c.analysis.at)} 분석${c.analysis.usage?.total_tokens ? ` · ${c.analysis.usage.total_tokens.toLocaleString()} tokens` : ''}${c.mode === 'live' ? ' · 생성형 AI의 판단은 원문과 대조해 주세요.' : ''}</p>` : ''}`;
}
function draftPanel(c) {
  const remaining = c.questions.filter(q => q.status !== 'answered');
  return `<div class="section-tools"><div><h2>필요한 이야기만 이어가세요</h2><p>초안을 확인하고 수정한 뒤, 원하는 채널에 붙여넣어요.</p></div></div><section class="draft-section"><div class="section-title"><div>${icon('chat')}<h2>남은 질문 재문의</h2></div><span>${remaining.length}개 남음</span></div><div class="question-choices">${remaining.map(q => `<label><input type="checkbox" name="draft-question" value="${q.id}" ${state.selected.has(q.id) ? 'checked' : ''}><span>${esc(q.title)}</span>${badge(q.status)}</label>`).join('') || '<p class="quiet-empty">모든 질문에 답변을 받았어요. 상담 인계 요약을 만들 수 있어요.</p>'}</div>${button('generate-draft', c.drafts.followup ? '초안 다시 만들기' : '선택한 질문으로 초안 만들기', 'primary', 'spark', `data-kind="followup" ${!remaining.length ? 'disabled' : ''}`)}${draftEditor(c,'followup')}</section><section class="draft-section"><div class="section-title"><div>${icon('file')}<h2>다른 상담원에게 이어 설명하기</h2></div></div><p class="section-description">상황, 받은 답변, 남은 질문과 약속을 하나의 요약으로 정리해요.</p>${button('generate-draft', c.drafts.handoff ? '인계 요약 다시 만들기' : '상담 인계 요약 만들기', 'secondary', 'spark', 'data-kind="handoff"')}${draftEditor(c,'handoff')}</section>`;
}
function draftEditor(c, kind) {
  const draft = c.drafts[kind];
  return draft ? `<div class="draft-editor"><label for="draft-${kind}">${kind === 'followup' ? '재문의 초안' : '상담 인계 요약'} <span>직접 수정할 수 있어요</span></label><textarea id="draft-${kind}" data-draft="${kind}" rows="7">${esc(state.draftEdits[kind] ?? draft.body)}</textarea><div class="draft-editor-bottom"><span>자동 전송되지 않아요 · 편집 내용은 현재 화면에 유지돼요</span>${button('copy', '복사하기', 'secondary compact', 'copy', `data-kind="${kind}"`)}</div><details class="draft-sources"><summary>초안의 원문 근거 ${draft.sourceMessageIds.length}개</summary>${draft.sourceMessageIds.map(id => `<button class="quote" data-action="source" data-id="${id}">${icon('link')}${esc(c.messages.find(m => m.id === id)?.text)}</button>`).join('')}</details></div>` : '';
}
function historyPanel(c) {
  return `<div class="section-tools"><div><h2>상담이 이어진 발자취</h2><p>새 답변, AI 분석, 직접 확인한 내용을 기록해요.</p></div></div><ol class="timeline">${c.history.map(h => `<li><span class="timeline-dot">${icon(h.type === 'confirmation' ? 'check' : h.type === 'analysis' ? 'spark' : 'chat')}</span><div><time>${date(h.at)}</time><h3>${esc(h.label)}</h3>${h.details ? `<p>${esc(h.details)}</p>` : ''}</div></li>`).join('')}</ol>`;
}
function showModal(title, content, wide = false) {
  const modal = $('#modal'); modal.className = wide ? 'modal wide-modal' : 'modal';
  modal.innerHTML = `<div class="modal-head"><div><span class="eyebrow">REPLYTRACK</span><h2>${title}</h2></div><button class="btn icon-btn" data-action="close-modal" aria-label="닫기">${icon('close')}</button></div>${content}<p id="modal-error" class="modal-error" role="alert"></p><p id="modal-status" role="status"></p>`;
  if (!modal.open) modal.showModal();
}
function showSettings() {
  showModal('실제 AI 분석 연결', `<p class="modal-intro">키는 이 서버의 메모리에만 보관돼요. 서버를 다시 시작하면 재등록해 주세요. AI 분석 시 입력한 상담 자료가 OpenAI로 전송됩니다.</p><form id="settings-form"><label class="field">OpenAI API 키<input id="api-key" type="password" autocomplete="off" placeholder="${state.config.configured ? '연결됨 · 변경할 때만 입력' : 'sk-…'}" ${state.config.configured ? '' : 'required'}></label><label class="field">모델<input id="api-model" value="${esc(state.config.model)}" required></label><div class="form-note">로컬 .env의 OPENAI_API_KEY로 설정할 수도 있어요. 키는 기록이나 내보내기에 포함하지 않아요.</div><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">연결 설정 저장</button></div></form>`);
}
function showNew() {
  state.onboarding = { title: '', company: '', messages: [], notes: [] };
  showModal('어떤 상담을 이어갈까요?', `<p class="modal-intro">대화를 가져온 뒤, 발화자와 내용을 확인하고 분석해요.</p><form id="import-form"><div class="form-grid"><label class="field">상담 제목<input name="title" placeholder="예: 무선 청소기 A/S 문의" maxlength="100" required></label><label class="field">업체명<input name="company" placeholder="예: 클린홈 고객센터" maxlength="60"></label></div><label class="field">상담 내용<textarea name="text" rows="8" maxlength="30000" placeholder="나: 수리비와 왕복 배송비가 궁금합니다.&#10;고객센터: 수리비는 점검 후 안내하겠습니다."></textarea></label><label class="upload-zone">${icon('file')}<span><strong>대화 캡처로 가져오기</strong><small>PNG · JPG · WebP / 최대 4MB / 1장</small></span><input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="form-note">AI가 읽은 내용은 저장 전에 수정할 수 있어요. 원본 이미지는 저장하지 않고 전사한 텍스트만 보관해요.</p><div class="modal-actions"><button type="button" class="btn secondary" data-action="manual">직접 나누어 입력</button><button class="btn primary" type="submit">${icon('spark')}AI로 대화 읽기</button></div></form>`, true);
}
function readNewMetadata() {
  const form = $('#import-form');
  if (form) { state.onboarding.title = form.elements.title.value; state.onboarding.company = form.elements.company.value; }
}
const localDateInput = iso => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
function reviewRow(m, i) {
  return `<div class="review-row" data-index="${i}"><div class="review-row-head"><span>메시지 ${i + 1}</span><select name="role" aria-label="메시지 ${i + 1} 발화자"><option value="customer" ${m.role === 'customer' ? 'selected' : ''}>나</option><option value="agent" ${m.role === 'agent' ? 'selected' : ''}>고객센터</option><option value="unknown" ${m.role === 'unknown' ? 'selected' : ''}>발화자 확인 필요</option></select><input type="datetime-local" name="sentAt" value="${localDateInput(m.sentAt)}" aria-label="메시지 ${i + 1} 날짜 (선택)"><button class="btn icon-btn" type="button" data-action="remove-row" aria-label="메시지 ${i + 1} 삭제">${icon('close')}</button></div><textarea name="text" rows="3" maxlength="6000" required aria-label="메시지 ${i + 1} 내용">${esc(m.text)}</textarea></div>`;
}
function showReview() {
  const data = state.onboarding;
  showModal('원문을 한 번 확인해 주세요', `<p class="modal-intro">이 내용이 분석의 기준이 돼요. 발화자와 인식 오류를 고치고, 실제 상담 날짜를 아는 경우 입력해 주세요.</p>${data.notes.map(n => `<p class="warning-note">${esc(n)}</p>`).join('')}<form id="review-form"><div class="form-grid"><label class="field">상담 제목<input name="title" value="${esc(data.title)}" maxlength="100" required></label><label class="field">업체명<input name="company" value="${esc(data.company)}" maxlength="60"></label></div><div id="review-rows">${data.messages.map(reviewRow).join('')}</div><button class="btn secondary" type="button" data-action="add-row">${icon('plus')}메시지 추가</button><div class="form-note">날짜가 없는 “내일” 같은 표현은 기한 미정으로 남겨요. AI 분석 시 아래 원문이 OpenAI로 전송됩니다.</div><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">저장하고 질문 분석하기 ${icon('arrow')}</button></div></form>`, true);
}
function showAppend() {
  showModal('새로운 대화 이어 붙이기', `<p class="modal-intro">기존 질문과 새 답변을 연결해요. 먼저 원문을 저장하고, AI 분석에 실패해도 기록은 유지돼요.</p><form id="append-form"><div class="form-grid"><label class="field">발화자<select name="role"><option value="agent">고객센터</option><option value="customer">나</option></select></label><label class="field">실제 상담 날짜 (선택)<input name="sentAt" type="datetime-local"></label></div><label class="field">추가 메시지<textarea name="text" rows="7" maxlength="6000" required placeholder="새로 받은 답변을 붙여넣어 주세요."></textarea></label><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">저장하고 새 답변 분석</button></div></form>`);
}
function showEdit(id) {
  const q = state.current.questions.find(q => q.id === id);
  showModal('질문과 답변 상태 수정', `<p class="modal-intro">직접 지정한 상태는 새 분석 후에도 유지돼요. 최신 AI 제안으로 되돌릴 수도 있어요.</p><form id="edit-form" data-id="${q.id}"><label class="field">질문 제목<input name="title" maxlength="200" value="${esc(q.title)}" required></label><label class="field">답변 상태<select name="status">${Object.entries(names).map(([id,label]) => `<option value="${id}" ${q.status === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="form-note">AI 제안: ${names[q.aiStatus]}<br>${esc(q.aiReason)}</div><div class="modal-actions">${q.manualStatus ? `<button class="btn secondary" type="button" data-action="apply-ai" data-id="${q.id}">AI 제안 적용</button>` : ''}<button class="btn primary" type="submit">수정 내용 저장</button></div></form>`);
}
async function updateCase(path, method, data) {
  const c = state.current;
  setCase(await api(`/api/cases/${c.id}/${path}`, method, { ...data, version: c.version }));
  await refreshList();
  render();
}
function highlightSource(id) {
  state.mobile = 'source'; render();
  const el = document.getElementById(`message-${id}`);
  if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => el.classList.remove('highlight'), 3500); }
}
function downloadRecord() {
  const c = state.current;
  const text = `# ${c.title}\n\n${c.company} · ${c.mode === 'demo' ? '가상 예제' : '실제 AI 분석'}\n\n${c.summary}\n\n## 질문 확인표\n\n${c.questions.map(q => `- ${q.title}: ${names[q.status]}\n  - ${q.reason}\n${q.evidence.map(e => `  - 근거: ${e.quote}`).join('\n')}`).join('\n')}\n\n## 처리 약속\n\n${c.promises.map(p => `- ${p.title}: ${p.confirmedAt ? '사용자 확인 완료' : p.state === 'reported' ? '업체 처리 안내 / 직접 확인 전' : '처리 약속 / 직접 확인 전'} · ${p.dueAt || '기한 미정'}\n  - ${p.evidence.quote}`).join('\n')}\n\n## 상담 원문\n\n${c.messages.map(m => `### ${m.role === 'customer' ? '나' : c.company} · ${date(m.sentAt)}\n\n${m.text}`).join('\n\n')}\n\n${Object.entries(c.drafts).map(([kind,d]) => `## ${kind === 'followup' ? '재문의 초안' : '인계 요약'}\n\n${state.draftEdits[kind] ?? d.body}`).join('\n\n')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `ReplyTrack-${c.title.replace(/[<>:"/\\|?*]/g,'_')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault(); if (state.busy) return;
  const action = target.dataset.action;
  if (action === 'home') { state.current = null; state.error = ''; render(); }
  if (action === 'new') showNew();
  if (action === 'settings') showSettings();
  if (action === 'close-modal') $('#modal').close();
  if (action === 'dismiss-error') { state.error = ''; render(); }
  if (action === 'open') await work('상담 기록을 불러오고 있어요', () => loadCase(target.dataset.id));
  if (action === 'demo') await work('예제 상담을 준비하고 있어요', async () => { setCase(await api('/api/demo','POST',{})); state.tab = 'questions'; state.filter = 'all'; await refreshList(); });
  if (action === 'demo-next') await work('새 예제 답변을 반영하고 있어요', async () => { await updateCase('demo-next', 'POST', {}); state.tab = 'questions'; toast('질문과 처리 약속이 갱신됐어요.'); });
  if (action === 'analyze') await work('AI가 질문과 답변 근거를 대조하고 있어요', () => updateCase('analyze','POST',{}));
  if (action === 'tab') { state.tab = target.dataset.value; render(); }
  if (action === 'draft-tab') { state.tab = 'drafts'; state.mobile = 'analysis'; render(); }
  if (action === 'mobile') { state.mobile = target.dataset.value; render(); }
  if (action === 'source') highlightSource(target.dataset.id);
  if (action === 'append') showAppend();
  if (action === 'edit-question') showEdit(target.dataset.id);
  if (action === 'apply-ai') await work('AI 제안을 적용하고 있어요', async () => { await updateCase(`questions/${target.dataset.id}`, 'PATCH', { applyAI: true }); $('#modal').close(); });
  if (action === 'confirm-promise') {
    const p = state.current.promises.find(p => p.id === target.dataset.id);
    if (p.confirmedAt) await work('직접 확인 상태를 변경하고 있어요', () => updateCase(`promises/${p.id}`, 'PATCH', { confirmed: false }));
    else showModal('실제 결과를 확인하셨나요?', `<p class="modal-intro"><strong>${esc(p.title)}</strong><br><br>업체의 안내와 별개로, 견적 수신이나 처리 결과를 직접 확인했을 때 완료로 표시해 주세요.</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">아직 확인 전이에요</button><button class="btn primary" data-action="confirm-yes" data-id="${p.id}">직접 확인했어요</button></div>`);
  }
  if (action === 'confirm-yes') await work('직접 확인한 결과를 기록하고 있어요', async () => { await updateCase(`promises/${target.dataset.id}`, 'PATCH', { confirmed: true }); $('#modal').close(); toast('사용자 확인 완료로 기록했어요.'); });
  if (action === 'generate-draft') await work('확인된 사실로 초안을 작성하고 있어요', async () => {
    const previousEdit = state.draftEdits[target.dataset.kind];
    delete state.draftEdits[target.dataset.kind];
    try { await updateCase('drafts','POST',{kind:target.dataset.kind, questionIds:[...state.selected]}); }
    catch (error) { if (previousEdit !== undefined) state.draftEdits[target.dataset.kind] = previousEdit; throw error; }
  });
  if (action === 'copy') {
    const area = $(`#draft-${target.dataset.kind}`);
    try { await navigator.clipboard.writeText(area.value); toast('초안을 복사했어요.'); }
    catch { area.focus(); area.select(); toast('복사 권한이 없어요. 선택된 내용을 Ctrl+C로 복사해 주세요.'); }
  }
  if (action === 'export') downloadRecord();
  if (action === 'delete') showModal('상담 기록을 삭제할까요?', `<p class="modal-intro">‘${esc(state.current.title)}’의 원문과 분석 기록이 이 기기에서 삭제돼요. 삭제 후에는 되돌릴 수 없어요.</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">취소</button><button class="btn danger" data-action="delete-yes">상담 삭제</button></div>`);
  if (action === 'delete-yes') await work('상담 기록을 삭제하고 있어요', async () => { await api(`/api/cases/${state.current.id}`, 'DELETE', {version:state.current.version}); state.current=null; localStorage.removeItem('replytrack:last-case'); await refreshList(); $('#modal').close(); });
  if (action === 'manual') { readNewMetadata(); state.onboarding.messages = [{role:'customer',text:'',sentAt:null},{role:'agent',text:'',sentAt:null}]; showReview(); }
  if (action === 'add-row') { const rows = $('#review-rows'); if(rows.children.length < 60) rows.insertAdjacentHTML('beforeend',reviewRow({role:'agent',text:'',sentAt:null},rows.children.length)); }
  if (action === 'remove-row') target.closest('.review-row').remove();
});
document.addEventListener('change', event => {
  if (event.target.id === 'question-filter') { state.filter = event.target.value; render(); }
  if (event.target.name === 'draft-question') { if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value); }
});
document.addEventListener('input', event => { if (event.target.dataset.draft) state.draftEdits[event.target.dataset.draft] = event.target.value; });
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target;
  if (form.id === 'settings-form') {
    const key = $('#api-key').value.trim(), model = $('#api-model').value.trim(); $('#api-key').value = '';
    await work('AI 연결 설정을 저장하고 있어요', async () => { state.config = await api('/api/config','PUT',{...(key ? {apiKey:key} : {}),model}); $('#modal').close(); toast('AI 연결 설정을 저장했어요. 분석할 때 연결을 확인합니다.'); });
  }
  if (form.id === 'import-form') {
    readNewMetadata(); const text = form.elements.text.value.trim(), file = form.elements.image.files[0];
    await work('AI가 대화를 읽고 있어요. 인식 후 원문을 확인해 주세요', async () => {
      if (!text && !file) throw new Error('상담 텍스트나 캡처를 입력해 주세요.');
      if (file && file.size > 4 * 1024 * 1024) throw new Error('4MB 이하 캡처를 선택해 주세요.');
      const image = file ? await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); }) : undefined;
      const result = await api('/api/extract','POST',{text,image});
      Object.assign(state.onboarding,result); showReview();
    });
  }
  if (form.id === 'review-form') {
    const title = form.elements.title.value, company = form.elements.company.value;
    const messages = [...form.querySelectorAll('.review-row')].map(row => ({ role:row.querySelector('[name=role]').value,text:row.querySelector('textarea').value,sentAt:row.querySelector('[name=sentAt]').value ? new Date(row.querySelector('[name=sentAt]').value).toISOString() : null }));
    await work('상담을 저장하고 AI가 질문을 분석하고 있어요', async () => {
      if (messages.some(m => m.role === 'unknown')) throw new Error('모든 메시지의 발화자를 확인해 주세요.');
      setCase(await api('/api/cases','POST',{title,company,messages})); await refreshList(); $('#modal').close(); state.tab='questions'; state.filter='all'; render();
      await updateCase('analyze','POST',{});
    });
  }
  if (form.id === 'append-form') {
    const body = {role:form.elements.role.value,text:form.elements.text.value,sentAt:form.elements.sentAt.value ? new Date(form.elements.sentAt.value).toISOString() : null};
    await work('새 대화를 저장하고 기존 질문에 연결하고 있어요', async () => { await updateCase('messages','POST',body); $('#modal').close(); await updateCase('analyze','POST',{}); state.tab='questions'; });
  }
  if (form.id === 'edit-form') {
    const body = {title:form.elements.title.value,status:form.elements.status.value};
    await work('수정 내용을 저장하고 있어요', async () => { await updateCase(`questions/${form.dataset.id}`,'PATCH',body); $('#modal').close(); });
  }
});
$('#modal').addEventListener('cancel', event => { if(state.busy) event.preventDefault(); });
async function init() {
  render();
  try {
    [state.config, state.cases] = await Promise.all([api('/api/config'),api('/api/cases')]);
    const last = new URLSearchParams(location.search).get('case') || localStorage.getItem('replytrack:last-case');
    if (last && state.cases.some(c => c.id === last)) setCase(await api(`/api/cases/${last}`));
  } catch(e) { state.error=e.message; }
  render();
}
init();
