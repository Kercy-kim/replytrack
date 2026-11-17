import { emailExplanationPanel } from './email.js';
import { inquiryOverviewPanel, inquiryLabel } from './inquiry-overview.js';
import { renderEmailDemo } from './email-demo.js';
import { deadlineState, filterCases, dirtyDraftKinds, savedDraft, selectedQuestionIds, CaseNavigation } from './workspace.js';
import { WebOperation, stages, elapsedLabel } from './operations.js';
import { newOnboarding, hasOnboardingInput, manualMessages } from './onboarding.js';
import { renderActionPlan, actionsMarkdown } from './next-actions.js';
import { createOfficialLoader, officialPanel } from './official-context.js';
import { draftScope } from './draft-scope.js';
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
const state = { cases: [], current: null, config: { configured: false, model: 'gpt-5-mini' }, busy: '', tab: 'questions', mobile: 'analysis', filter: 'all', selected: new Set(), draftEdits: {}, error: '', onboarding: null, query: '', caseFilter: 'active', sort: 'priority' };
const dirtyKinds = () => dirtyDraftKinds(state.current?.drafts || {}, state.draftEdits);
state.replyLanguages = {};
state.emailDemoFocus = {};
let officialResult = null;
const loadOfficial = createOfficialLoader({ api, current: () => state.current, display: result => {
  officialResult = result;
  const region = $('#official-context'); if (region) region.innerHTML = officialPanel(result, esc);
} });
const views = new CaseNavigation();
const disclosureStates = new Map();
let viewRevision = 0;
let settingsReturn = false;
const readActions = new Set(['home', 'open', 'refresh', 'tab', 'draft-tab', 'mobile', 'source', 'source-return', 'copy', 'export', 'case-filter', 'reset-search', 'dismiss-error', 'guard-cancel', 'guard-continue', 'close-modal', 'inquiry-section']);
const canBrowse = () => !!state.operation && !!state.task?.caseId;
const blocked = action => !!state.busy && !(canBrowse() && readActions.has(action));
let guardResolve;
let modalReturnFocus;
function guardEdits(invalidates = false, kind) {
  const savedEdits = invalidates && Object.entries(state.current?.drafts || {}).some(([key, draft]) => (!kind || key === kind) && draft.editedBody !== undefined);
  if (!dirtyKinds().some(key => !kind || key === kind) && !savedEdits) return Promise.resolve(true);
  showModal(invalidates ? '편집한 초안을 바꾸기 전에' : '아직 저장하지 않은 초안이 있어요', `<p class="modal-intro">${invalidates ? '상담 상태가 바뀌거나 초안을 다시 생성하면 기존 초안이 초기화돼요. 필요한 편집 내용은 먼저 복사하거나 기록을 내려받아 주세요.' : '이동하면 저장하지 않은 편집 내용이 사라져요. 돌아가서 편집 내용을 저장할 수 있어요.'}</p><div class="modal-actions"><button class="btn secondary" data-action="guard-cancel">편집으로 돌아가기</button><button class="btn primary" data-action="guard-continue">${invalidates ? '초기화하고 계속' : '저장하지 않고 계속'}</button></div>`);
  return new Promise(resolve => { guardResolve = resolve; });
}
function resolveGuard(allowed) { const resolve = guardResolve; guardResolve = null; $('#modal').close(); resolve?.(allowed); }
window.addEventListener('beforeunload', event => { if (dirtyKinds().length || state.operation || hasOnboardingInput(state.onboarding)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => {
  if (state.operation?.snapshot.state === 'running') fetch(`/api/operations/${state.operation.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}', keepalive: true }).catch(() => {});
});
let toastTimer;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(path, method = 'GET', data) {
  const res = await fetch(path, { method, signal: AbortSignal.timeout(30000), ...(data ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {}) });
  const result = await res.json();
  if (res.status === 401 && result.code === 'LOGIN_REQUIRED') location.assign('/login');
  if (!res.ok) { const e = new Error(result.error || '요청에 실패했습니다.'); e.status = res.status; e.code = result.code; throw e; }
  return result;
}
async function work(label, fn) {
  if (state.busy) return;
  const focus = focusBookmark();
  const revision = viewRevision;
  const previousCaseId = state.current?.id;
  const previousAnalysisId = state.current?.history.find(h => h.type === 'analysis')?.id;
  state.busy = label; state.task = null; state.error = ''; render(); setModalBusy(true);
  const timer = setInterval(renderProgress, 250);
  try { await fn(); }
  catch (e) {
    if (e.code === 'OPERATION_CANCELLED') { toast('작업을 취소했어요. 입력과 기존 기록은 그대로예요.'); return; }
    state.error = `${state.task?.caseId && state.current?.id !== state.task.caseId ? `${state.task.title}: ` : ''}${e.message}`; toast(state.error);
    const error = $('#modal-error'); if (error) error.textContent = e.message;
    const failedCaseId = state.task?.caseId || previousCaseId;
    if (e.status === 409 && failedCaseId) {
      await api(`/api/cases/${failedCaseId}`).then(record => { views.remember(record); if (state.current?.id === failedCaseId) setCase(record); }).catch(() => {});
      state.error += ' 편집 중인 초안은 화면에 유지했어요. 최신 내용과 비교한 뒤 다시 저장해 주세요.';
    }
  } finally {
    if (!state.error && state.task?.caseId && state.current?.id !== state.task.caseId && state.operation?.snapshot.state === 'completed') toast(`${state.task.title} 작업을 완료했어요. 해당 상담에서 결과를 확인해 주세요.`);
    clearInterval(timer); state.operation = null; state.task = null; state.busy = ''; render(); setModalBusy(false); renderProgress(); if (viewRevision === revision) restoreFocus(focus);
    if (viewRevision === revision && !state.error && state.current?.id === previousCaseId && state.current?.history.find(h => h.type === 'analysis')?.id !== previousAnalysisId && $('#analysis-changes')) {
      $('#comparison-heading').focus({ preventScroll: true });
      $('#analysis-changes').scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
}
function setModalBusy(busy) {
  $('#modal').querySelectorAll('button, input, select, textarea').forEach(el => { if (el.dataset.action !== 'cancel-operation') el.disabled = busy; });
  const status = $('#modal-status'); if (status) status.textContent = busy ? state.busy : '';
}
async function runOperation(kind, input = {}, caseId) {
  const operation = new WebOperation(api, renderProgress);
  state.operation = operation;
  if (caseId) state.task = { caseId, title: state.current?.title || '상담' };
  render(); renderProgress();
  try {
    const result = await operation.run(kind, input, caseId);
    if (operation.cancelRequested) toast('저장 단계에 들어간 작업이 완료되어 결과를 반영했어요.');
    return result;
  }
  finally { state.config = await api('/api/config').catch(() => state.config); }
}
function renderProgress() {
  const operation = state.operation;
  document.querySelectorAll('[data-progress]').forEach(panel => {
    panel.hidden = !state.busy || !operation;
    if (panel.hidden) { panel.innerHTML = ''; delete panel.dataset.signature; return; }
    const job = operation.snapshot;
    const signature = JSON.stringify([job.stage, job.events, operation.cancelRequested, operation.cancelling, operation.warning, job.state, state.current?.id]);
    if (panel.dataset.signature !== signature) {
      const restoreCancelFocus = panel.contains(document.activeElement) && document.activeElement.dataset.action === 'cancel-operation';
      panel.dataset.signature = signature;
      const label = operation.cancelling ? '서버에서 취소 확인 중' : stages[job.stage] || '작업 처리 중';
      panel.innerHTML = `<div class="operation-head"><span class="spinner" aria-hidden="true"></span><strong role="status">${esc(label)}</strong><span class="operation-time" data-elapsed aria-live="off"></span></div><p class="operation-note">${state.task ? `<strong>${esc(state.task.title)}</strong> · 생성 중에도 상담 조회와 초안 복사를 할 수 있어요.<br>` : ''}취소해도 입력과 이전 분석·초안은 유지돼요. 이미 전송된 AI 요청은 비용이 발생할 수 있어요.</p>${job.events.length ? `<ol class="operation-stages" aria-label="실제 처리 단계">${job.events.map((event, i) => `<li ${i === job.events.length - 1 ? 'aria-current="step"' : ''}>${esc(stages[event.stage] || event.stage).replace(/ 중$/, '')}</li>`).join('')}</ol>` : ''}<div class="operation-bottom">${state.task && state.current?.id !== state.task.caseId ? button('open','작업 중인 상담 보기','secondary compact','',`data-id="${state.task.caseId}"`) : ''}<small>${esc(operation.warning || '완료율을 추정하지 않고 실제 처리 단계를 표시해요.')}</small><button type="button" class="btn secondary compact" data-action="cancel-operation" ${operation.cancelling || job.state !== 'running' ? 'disabled' : ''}>${operation.cancelling ? '취소 확인 중…' : '작업 취소'}</button></div>`;
      if (restoreCancelFocus) panel.querySelector('[data-action="cancel-operation"]').focus({ preventScroll: true });
    }
    panel.querySelector('[data-elapsed]').textContent = `경과 ${elapsedLabel(operation.elapsedMs)}`;
  });
  const status = $('#modal-status'); if (status && operation && state.busy) status.textContent = '';
}
async function refreshList() { state.cases = await api('/api/cases'); }
function setCase(c) {
  c = views.remember(c);
  if (state.sourceReturn && (state.sourceReturn.caseId !== c.id || state.sourceReturn.version !== c.version)) state.sourceReturn = null;
  // Retain local edits during conflict recovery, even if another window invalidated a draft.
  const edits = state.current?.id === c.id ? { ...state.draftEdits } : {};
  if (state.current?.id !== c.id) {
    state.mobile = 'analysis';
    state.filter = 'all';
  }
  state.selected = new Set(selectedQuestionIds(state.current, c, state.selected));
  state.current = c; state.draftEdits = edits;
  localStorage.setItem('replytrack:last-case', c.id);
  window.history.replaceState(null, '', `?case=${encodeURIComponent(c.id)}`);
  loadOfficial(c);
}
async function loadCase(id) {
  const record = await views.open(id, async caseId => { const c = await api(`/api/cases/${caseId}`); await refreshList(); return c; });
  if (record) setCase(record);
}
async function viewWork(label, fn) {
  if (!state.busy) return work(label, fn);
  try { await fn(); render(); } catch (error) { toast(error.message); }
}
const date = value => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '날짜 미입력';
const badge = status => `<span class="badge ${status}"><span class="status-dot"></span>${names[status]}</span>`;
const button = (action, label, type = 'secondary', symbol = '', attrs = '') => `<button class="btn ${type}" data-action="${action}" ${blocked(action) ? 'disabled' : ''} ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
function focusBookmark() {
  const el = document.activeElement;
  const scope = el?.closest('#app, #modal');
  if (!scope) return null;
  let selector = el.id ? `#${CSS.escape(el.id)}` : null;
  if (!selector && el.matches('summary') && el.parentElement.dataset.disclosure) selector = `details[data-disclosure="${CSS.escape(el.parentElement.dataset.disclosure)}"] > summary`;
  if (!selector && el.dataset.action) {
    selector = ['action', 'id', 'kind', 'value'].filter(key => el.dataset[key] !== undefined)
      .map(key => `[data-${key}="${CSS.escape(el.dataset[key])}"]`).join('');
  }
  if (!selector && el.name) selector = `[name="${CSS.escape(el.name)}"]${el.type === 'checkbox' ? `[value="${CSS.escape(el.value)}"]` : ''}`;
  if (!selector) return null;
  return { scope: scope.id, selector, occurrence: [...scope.querySelectorAll(selector)].indexOf(el), caseId: state.current?.id, start: el.selectionStart, end: el.selectionEnd,
    fallback: el.dataset.action === 'save-draft' ? `#draft-${el.dataset.kind}` : null };
}
function restoreFocus(bookmark) {
  if (!bookmark) return;
  const modal = $('#modal');
  if (modal.open && bookmark.scope !== 'modal') return;
  const scope = modal.open ? modal : $('#app');
  const available = el => el && !el.disabled && el.getClientRects().length;
  let target = bookmark.caseId === state.current?.id ? scope.querySelectorAll(bookmark.selector)[bookmark.occurrence ?? 0] : null;
  if (!available(target)) target = bookmark.fallback ? scope.querySelector(bookmark.fallback) : null;
  if (!available(target)) target = scope.querySelector(modal.open ? 'h2' : 'h1') || $('#main');
  if (!available(target)) return;
  if (!target.matches('button,input,textarea,select,a,[tabindex]')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  if (target.matches('textarea,input[type=text],input:not([type])') && Number.isInteger(bookmark.start)) target.setSelectionRange(bookmark.start, bookmark.end);
}
function render() {
  $('#app').querySelectorAll('details[data-disclosure]').forEach(el => disclosureStates.set(el.dataset.disclosure, el.open));
  const focus = $('#app').contains(document.activeElement) ? focusBookmark() : null;
  const c = state.current;
  $('#app').innerHTML = `<a class="skip" href="#main">본문으로 이동</a>
    <aside class="sidebar">
      <a href="/" class="brand" data-action="home" aria-label="ReplyTrack 홈"><img src="/favicon.svg" width="35" height="35" alt=""><span>ReplyTrack<span class="brand-dot">.</span></span></a>
      <div class="workspace-label">문의 내용과 진행 상황을 한곳에</div>
      ${button('new', '문의 추가', 'primary wide', 'plus')}
      ${button('home', '내 문의함', 'secondary wide workspace-home', 'file')}
      <div class="nav-heading"><span>저장한 문의</span><span>${state.cases.filter(item => !item.archivedAt || item.id === c?.id).length.toString().padStart(2, '0')}</span></div>
      <nav class="case-list" aria-label="문의 목록">${state.cases.length ? state.cases.filter(item => !item.archivedAt || item.id === c?.id).map(item => `<button class="case-item ${c?.id === item.id ? 'active' : ''}" data-action="open" data-id="${item.id}" ${blocked('open') ? 'disabled' : ''}>${icon('chat')}<span><strong>${esc(item.title)}</strong><small>${esc(item.company)}${item.mode === 'demo' ? ' · 가상 기록' : ''}</small></span>${item.pendingAnalysis ? '<b aria-label="대화 정리 필요">…</b>' : item.unanswered ? `<b aria-label="남은 질문 ${item.unanswered}개">${item.unanswered}</b>` : '<span class="subtle" aria-label="답변과 실제 해결은 별도로 확인">—</span>'}</button>`).join('') : '<p class="sidebar-empty">문의를 추가하면<br>이곳에 기록이 쌓여요.</p>'}</nav>
    </aside>
    <main id="main" class="main">
      <header class="topbar"><div>내 문의 <span>/</span> <strong>${c ? '문의 기록' : state.cases.length ? '내 문의함' : '시작하기'}</strong></div><span class="topbar-note">문의 내용과 진행 상황을 한곳에</span>${state.auth?.enabled ? `<button class="btn secondary compact account-button" data-action="account" aria-label="내 계정 ${esc(state.auth.user?.username)}">${esc(state.auth.user?.username)}</button>` : '<button class="avatar" data-action="settings" aria-label="AI 연결 설정">R</button>'}</header>
      ${state.busy ? `<div class="busy-bar" role="status">${esc(state.busy)}</div>` : ''}<section class="operation-panel" data-progress hidden aria-label="작업 진행 상황"></section>
      ${state.error ? `<div class="error-banner" role="alert">${esc(state.error)}<button data-action="dismiss-error" aria-label="오류 안내 닫기">${icon('close')}</button></div>` : ''}
      ${c ? detail(c) : landing()}
      <footer class="footer">ReplyTrack <span>대화는 이어지고, 기록은 남으니까.</span><span>AI 판단은 원문과 함께 확인해 주세요.</span></footer>
    </main>`;
  $('#app').querySelectorAll('button[data-action]').forEach(el => { if (blocked(el.dataset.action) && el.dataset.action !== 'cancel-operation') el.disabled = true; });
  $('#app').querySelectorAll('details[data-disclosure]').forEach(el => { if (disclosureStates.has(el.dataset.disclosure)) el.open = disclosureStates.get(el.dataset.disclosure); });
  renderProgress(); restoreFocus(focus);
}
function landing() {
  if (state.cases.length) return dashboard();
  return `<section class="welcome"><div class="welcome-copy"><h1>문의한 내용부터,<br><span>남은 일까지 한곳에.</span></h1><p>쇼핑부터 이메일·계정 복구 문의까지.<br>남은 질문과 해야 할 일을 정리하고,<br>새 답변에서 달라진 내용을 확인하세요.</p><div class="welcome-actions">${button('new', '내 문의 정리하기', 'primary', 'plus')}</div><div class="welcome-footnote">텍스트 붙여넣기 · 대화 캡처 · 질문별 원문 근거</div></div>
    <div class="welcome-visual" aria-label="질문과 답변 상태 예시"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="sample-message">${icon('chat')}<p>“환불 금액, 처리 기간, 반품 배송비가 궁금해요.”</p></div><div class="sample-card"><div class="sample-card-head"><span class="tiny-logo">${icon('spark')}</span><strong>세 가지 질문, 놓치지 않도록</strong><span class="sample-tag">예시</span></div><div class="sample-row"><span>01</span><strong>환불 금액 안내</strong>${badge('waiting')}</div><div class="sample-row"><span>02</span><strong>환불 소요 기간</strong>${badge('answered')}</div><div class="sample-row"><span>03</span><strong>반품 배송비</strong>${badge('unanswered')}</div><div class="sample-bottom">${icon('link')}모든 판단은 원문으로 연결돼요</div></div><div class="sample-follow">${icon('arrow')}남은 질문만 담아, 다음 문의로.</div></div></section>
    <section class="benefits"><article><h2>대화는 한곳에</h2><p>메신저, 이메일, 고객센터 채팅.<br>흩어진 상담을 붙여넣어 주세요.</p></article><article><h2>빠진 답변은 선명하게</h2><p>질문별 답변 상태와 실제 처리 약속을<br>원문 근거와 함께 확인해요.</p></article><article><h2>다음 문의는 간결하게</h2><p>아직 필요한 질문만 담은 초안으로<br>같은 설명을 반복하지 않아요.</p></article></section>`;
}
const caseFilters = [['active','전체 문의'],['attention','내가 확인할 문의'],['waiting','업체 답변·처리 대기'],['due','기한 확인'],['analysis','대화 정리 필요'],['archived','보관함']];
function dashboard() {
  const active = state.cases.filter(c => !c.archivedAt);
  const due = active.reduce((n, c) => n + c.deadlines.overdue + c.deadlines.today, 0);
  return `<section class="dashboard"><div class="dashboard-heading"><div><h1>내 문의함</h1><p>${active.length}개의 문의를 정리하고 있어요. ${due ? `오늘까지 확인할 약속 ${due}건이 있어요.` : '문의 내용과 지금 확인할 항목을 살펴보세요.'}</p></div>${button('refresh', '목록 새로고침', 'secondary compact', 'clock')}</div><div class="workspace-toolbar"><label class="search-field">문의 검색<input type="search" id="case-search" value="${esc(state.query)}" placeholder="제목, 문의처, 내용 미리보기" maxlength="100"></label><label class="sort-field">정렬<select id="case-sort"><option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>확인 우선순위</option><option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>최근 수정순</option></select></label></div><div class="case-filters" role="group" aria-label="문의 필터">${caseFilters.map(([id,label]) => `<button data-action="case-filter" data-value="${id}" aria-pressed="${state.caseFilter === id}">${label}<span>${filterCases(state.cases,{filter:id}).length}</span></button>`).join('')}</div><div id="workspace-results">${caseResults()}</div><p class="dashboard-note">한 문의가 여러 필터에 포함될 수 있어요. 답변·처리 대기와 실제 해결은 구분하며, 기한은 한국 시간 기준이에요.</p></section>`;
}
function caseResults() {
  const cases = filterCases(state.cases, {query:state.query, filter:state.caseFilter, sort:state.sort});
  return `<p class="result-count" role="status">${state.query ? `“${esc(state.query)}” 검색 결과` : caseFilters.find(([id]) => id === state.caseFilter)[1]} ${cases.length}건</p>${cases.length ? `<div class="workspace-list">${cases.map(c => `<article class="workspace-row"><div class="workspace-case"><p>${esc(c.company)} · ${c.channel === 'email' ? '이메일 문의' : '대화 문의'}${c.mode === 'demo' ? ' · 가상 기록' : ''}</p><h2><button data-action="open" data-id="${c.id}">${esc(c.title)}${icon('arrow')}</button></h2>${c.preview ? `<p class="inquiry-preview">${esc(c.preview)}${c.preview.length === 180 ? '…' : ''}</p>` : ''}<div class="case-counts">${c.overview?.fresh ? `<span>남은 질문 <strong>${c.unanswered}</strong></span><span>직접 확인 전 약속 <strong>${c.promises}</strong></span>` : '<span>새 대화는 아직 정리 전이에요</span>'}<time>수정 ${date(c.updatedAt)}</time></div></div><div class="case-next">${nextAction(c)}</div></article>`).join('')}</div>` : `<div class="empty-panel"><h2>${state.query ? '검색 결과가 없어요' : state.caseFilter === 'archived' ? '보관한 상담이 없어요' : '이 조건에 해당하는 상담이 없어요'}</h2><p>${state.query ? '제목, 문의처 또는 문의 내용의 다른 단어로 찾아보세요.' : '다른 필터에서 상담을 확인할 수 있어요.'}</p>${button('reset-search','전체 문의 보기','secondary compact')}</div>`}`;
}
function nextAction(c) {
  if (c.archivedAt) return '<span class="deadline-chip">보관한 문의</span><small>보관은 실제 해결 완료와 구분해요</small>';
  const o = c.overview, d = c.deadlines;
  if (!o?.fresh) return '<span class="deadline-chip today">대화 정리 필요</span><small>저장한 원문을 질문과 약속에 반영해요</small>';
  if (d.overdue) return `<span class="deadline-chip overdue">기한 지남 ${d.overdue}건</span><small>${esc(d.nextDueAt)}까지 · 실제 처리 확인 필요</small>`;
  if (d.today) return `<span class="deadline-chip today">오늘까지 ${d.today}건</span><small>약속한 결과가 도착했는지 확인해요</small>`;
  const details = [o.requests ? `수행·확인할 요청 ${o.requests}개` : '', o.confirmations ? `실제 결과 확인 ${o.confirmations}개` : '', o.followups ? `재문의·확인할 질문 ${o.followups}개` : '', o.waitingAnswers ? `답변 대기 질문 ${o.waitingAnswers}개` : '', o.waitingPromises ? `기다리는 처리 약속 ${o.waitingPromises}개` : ''].filter(Boolean);
  return `<span class="deadline-chip">${esc(inquiryLabel(o))}</span><small>${details.map(esc).join('<br>') || (o.hasAgent && !o.requestsFresh ? '업체가 요청한 행동은 별도로 확인할 수 있어요' : '새 답변이 오면 같은 문의에 이어서 추가하세요')}</small>`;
}
function deadlineLabel(p) {
  const status = deadlineState(p);
  const text = {overdue:'기한 지남 · 실제 처리 확인 필요',today:'오늘까지 · 실제 처리 확인 필요',upcoming:'기한 예정',unknown:'기한 미정',confirmed:'직접 확인 완료'}[status];
  return `<span class="deadline-chip ${status}">${text}</span>`;
}
const comparisonTitles = { reply: '이번 답변으로 달라진 점', messages: '추가 대화로 달라진 점', reanalysis: '같은 원문 재분석 결과' };
const changeStatus = status => `<strong class="change-state">${esc(names[status] || '확인 필요')}</strong>`;
const promiseStatus = state => state === 'reported' ? '업체의 처리 안내' : '처리 약속';
const changeDeadline = p => p.dueAt ? `${p.dueAt}까지` : p.dueText ? `기한 미정 · ${p.dueText}` : '기한 미정';
function changeTransition(label, before, after) {
  return `<div class="change-field"><p>${esc(label)}</p><div class="change-values"><span><small>이전</small>${before}</span>${icon('arrow')}<span><small>이번 분석</small>${after}</span></div></div>`;
}
function changeEvidence(change) {
  return `<div class="change-evidence">${change.evidenceMessageIds.map((id, i) => button('source', change.evidenceMessageIds.length > 1 ? `근거 원문 ${i + 1}` : '근거 원문', 'text', 'link', `data-id="${esc(id)}" aria-label="${esc(change.title)} 변경 근거 원문 ${i + 1} 보기"`)).join('')}</div>`;
}
function comparisonContents(comparison) {
  if (!comparison.questions.length && !comparison.promises.length) return '<p class="changes-empty">질문 상태와 처리 약속에 바뀐 항목이 없어요. 원문 근거와 판단 설명은 갱신될 수 있어요.</p>';
  const questions = comparison.questions.map(q => `<li><h4>${esc(q.title)}${!q.before ? '<span class="change-added">새 질문</span>' : ''}</h4>
    ${!q.before || q.before.status !== q.after.status ? changeTransition('질문 상태', q.before ? changeStatus(q.before.status) : '등록 전', changeStatus(q.after.status)) : `<p class="change-note">직접 지정한 상태: ${changeStatus(q.after.status)} 유지</p>`}
    ${q.after.manualStatus && q.before && q.before.aiStatus !== q.after.aiStatus ? changeTransition('AI 제안 · 지정한 상태에 자동 적용하지 않아요', changeStatus(q.before.aiStatus), changeStatus(q.after.aiStatus)) : ''}${changeEvidence(q)}</li>`).join('');
  const promises = comparison.promises.map(p => `<li><h4>${esc(p.title)}${!p.before ? '<span class="change-added">새 약속</span>' : ''}</h4>
    ${p.fields.includes('title') ? changeTransition('약속 내용', esc(p.before.title), esc(p.after.title)) : ''}
    ${!p.before || p.fields.includes('state') ? changeTransition('업체 안내', p.before ? esc(promiseStatus(p.before.state)) : '등록 전', esc(promiseStatus(p.after.state))) : ''}
    ${!p.before || p.fields.includes('deadline') ? changeTransition('약속 기한', p.before ? esc(changeDeadline(p.before)) : '등록 전', esc(changeDeadline(p.after))) : ''}
    <p class="change-note">${p.after.confirmedAt ? '분석 당시 사용자 확인 완료 상태를 유지했어요.' : '분석 당시 직접 확인 전이에요. 업체 안내만으로 실제 처리 완료가 되지는 않아요.'}</p>${changeEvidence(p)}</li>`).join('');
  return `<div class="changes-grid"><div><h3>질문 변화 <span>${comparison.questions.length}</span></h3>${questions ? `<ul class="change-list">${questions}</ul>` : '<p class="change-note">질문 상태 변화 없음</p>'}</div><div><h3>약속 변화 <span>${comparison.promises.length}</span></h3>${promises ? `<ul class="change-list">${promises}</ul>` : '<p class="change-note">처리 약속 변화 없음</p>'}</div></div>`;
}
function comparisonPanel(c) {
  const comparison = c.analysis?.comparison;
  if (!comparison || comparison.kind === 'initial') return '';
  const pending = c.analyzedMessageCount < c.messages.length;
  const analysisIndex = c.history.findIndex(h => h.type === 'analysis');
  const manuallyChanged = (analysisIndex < 0 ? c.history : c.history.slice(0, analysisIndex)).some(h => ['correction', 'confirmation'].includes(h.type));
  return `<section id="analysis-changes" class="analysis-changes" aria-label="분석 전후 비교"><header class="changes-heading"><div><h2 id="comparison-heading" tabindex="-1">${pending ? '이전 분석에서 달라진 점' : comparisonTitles[comparison.kind]}</h2><p><time>${date(comparison.at)}</time> 분석 기준${comparison.messageIds.length ? ` · 추가 메시지 ${comparison.messageIds.length}개 반영` : ' · 추가 메시지 없음'}</p></div><p class="changes-count">질문 ${comparison.questions.length}건 · 약속 ${comparison.promises.length}건</p></header>
    ${pending ? '<p class="changes-notice">새 메시지는 아직 분석 전이에요. 아래는 마지막으로 성공한 분석의 비교입니다.</p>' : ''}
    ${manuallyChanged ? '<p class="changes-notice">이 비교 이후 직접 수정한 내용이 있어요. 현재 상태는 질문 확인표와 변경 이력에서 확인해 주세요.</p>' : ''}
    ${comparisonContents(comparison)}</section>`;
}
function detail(c) {
  if (c.demoScenario === 'email' && state.emailDemoFocus[c.id] !== null) return renderEmailDemo(c, state.emailDemoFocus[c.id] ?? 0, { esc, button, badge, comparisonPanel });
  const pending = c.analyzedMessageCount < c.messages.length;
  return `<section class="case-heading"><div><h1>${esc(c.title)}</h1><div class="case-company">${esc(c.company)}${c.mode === 'demo' ? ' · 가상 기록' : ''}</div><p>${pending && c.analysis ? '이전 정리 · ' : ''}${esc(c.summary || '문의 내용을 저장했어요. 질문을 분석하면 진행 상황을 정리해 드려요.')}</p></div><div class="heading-actions">${c.mode === 'live' ? button('append', '새 답변 추가', 'primary compact append-primary', 'plus') : ''}${button('case-settings', '문의 관리', 'secondary compact', 'settings')}${button('export', '내려받기', 'secondary compact', 'download')}</div></section>
    ${c.archivedAt ? `<div class="archive-banner"><span>보관한 상담이에요. 보관은 실제 처리 완료를 의미하지 않아요.</span>${button('restore','진행 목록으로 복원','secondary compact')}</div>` : ''}
    ${c.mode === 'demo' ? `<div class="demo-banner"><span>${icon('spark')}<strong>가상 기록</strong> 준비된 데이터이며 실제 AI 분석 결과가 아니에요.</span>${c.demoStep < (c.demoScenario === 'email' ? 1 : 2) ? button('demo-next', c.demoStep === 0 ? '준비된 답변 보기' : c.demoScenario === 'refund' ? '준비된 환불 안내 보기' : '준비된 견적 보기', 'text', 'arrow') : '<span class="demo-complete">준비된 답변을 모두 확인했어요</span>'}</div>` : ''}
    ${pending ? `<div class="pending-banner"><span>새 메시지가 저장됐어요. 분석하면 질문과 약속에 반영돼요.</span>${button('analyze', c.questions.length ? '새 답변 분석' : '질문 분석하기', 'primary compact', 'spark')}</div>` : ''}
    ${inquiryOverviewPanel(c, { esc, button })}
    ${comparisonPanel(c)}${emailExplanationPanel(c, { esc, button, date })}
    <div id="official-context">${officialPanel(officialResult, esc)}</div>
    <div class="mobile-switch" role="group" aria-label="보기 선택"><button data-action="mobile" data-value="source" aria-pressed="${state.mobile === 'source'}" class="${state.mobile === 'source' ? 'active' : ''}">상담 원문</button><button data-action="mobile" data-value="analysis" aria-pressed="${state.mobile === 'analysis'}" class="${state.mobile === 'analysis' ? 'active' : ''}">질문 확인표</button></div>
    <div class="workspace mobile-${state.mobile}"><section class="source-panel panel"><div class="panel-header"><div>${icon('chat')}<h2>상담 원문</h2><span class="count">${c.messages.length}</span></div><span class="subtle">${c.mode === 'demo' ? '가상 상담' : '검토한 텍스트'}</span></div><div class="source-messages">${c.messages.map(m => `<article class="message ${m.role}" id="message-${m.id}"><div class="message-meta"><span class="speaker-avatar">${m.role === 'customer' ? '나' : 'CS'}</span><strong>${m.role === 'customer' ? '나' : esc(c.company)}</strong><time>${date(m.sentAt)}</time></div><div class="message-text">${esc(m.text)}</div>${state.sourceReturn?.caseId === c.id && state.sourceReturn.messageId === m.id ? button('source-return', '확인하던 내용으로 돌아가기', 'secondary compact source-return') : ''}</article>`).join('')}</div><div class="source-bottom"><span>${icon('link')}근거를 누르면 해당 원문으로 이동해요</span>${c.mode === 'live' ? button('append', '새 답변 / 질문 추가', 'secondary wide', 'plus') : ''}</div></section>
    <section class="analysis-panel"><div class="tabs" role="tablist" aria-label="분석 보기">${[['questions','질문 확인표', c.questions.length],['drafts','답장 작성', null],['history','변경 이력', null]].map(([id,label,count]) => `<button id="tab-${id}" role="tab" aria-controls="panel-${id}" tabindex="${state.tab === id ? 0 : -1}" ${blocked('tab') ? 'disabled' : ''} aria-selected="${state.tab === id}" class="${state.tab === id ? 'active' : ''}" data-action="tab" data-value="${id}">${label}${count !== null ? `<span>${count}</span>` : ''}</button>`).join('')}</div>${c.warnings.map(w => `<div class="warning-note">${esc(w)}</div>`).join('')}<div id="panel-${state.tab}" role="tabpanel" aria-labelledby="tab-${state.tab}" tabindex="0">${state.tab === 'questions' ? questionPanel(c) : state.tab === 'drafts' ? draftPanel(c) : historyPanel(c)}</div></section></div>`;
}
function questionPanel(c) {
  const visible = c.questions.filter(q => state.filter === 'remaining' ? q.status !== 'answered' : state.filter === 'followup' ? ['unanswered','partial','review'].includes(q.status) : state.filter === 'waiting' ? q.status === 'waiting' : true);
  return `${renderActionPlan(c, { esc, button, date })}${c.analyzedMessageCount < c.messages.length && c.analysis ? '<p class="action-notice">아래 질문과 약속은 이전 분석 기준이에요. 새 대화를 분석하면 갱신돼요.</p>' : ''}<div class="section-tools"><div><h2>어떤 답변이 아직 남아 있나요?</h2><p>답변 수신과 실제 처리 완료는 따로 확인해요.</p></div><select id="question-filter" aria-label="질문 필터"><option value="all" ${state.filter === 'all' ? 'selected' : ''}>모든 질문</option><option value="remaining" ${state.filter === 'remaining' ? 'selected' : ''}>남은 질문만</option><option value="followup" ${state.filter === 'followup' ? 'selected' : ''}>재문의·확인할 질문</option><option value="waiting" ${state.filter === 'waiting' ? 'selected' : ''}>답변 대기 질문</option></select></div>
    <div class="question-list" id="inquiry-questions" tabindex="-1">${visible.length ? visible.map(q => `<article class="question-card ${q.status}"><div class="question-top"><span class="question-number">Q${String(c.questions.indexOf(q) + 1).padStart(2, '0')}</span>${badge(q.status)}<button class="edit-button" data-action="edit-question" data-id="${q.id}" aria-label="${esc(q.title)} 수정">${icon('edit')}</button></div><h3>${esc(q.title)}</h3><p class="reason">${esc(q.reason)}</p>${q.manualStatus ? `<p class="manual-note">직접 수정한 상태 · AI 제안: ${names[q.aiStatus]}</p>` : ''}<div class="evidence">${q.evidence.length ? q.evidence.map(e => `<button data-action="source" data-id="${e.messageId}" class="quote">${icon('link')}<span>“${esc(e.quote)}”</span>${icon('arrow')}</button>`).join('') : `<button class="quote empty-quote" data-action="source" data-id="${q.source.messageId}">${icon('link')}<span>이 질문에 연결된 답변이 아직 없어요. 질문 원문 보기</span>${icon('arrow')}</button>`}</div></article>`).join('') : `<div class="empty-panel">${icon('check')}<h3>${!c.questions.length ? (c.analysis && c.analyzedMessageCount === c.messages.length ? '원문에서 확인할 질문을 찾지 못했어요' : '아직 질문을 분석하지 않았어요') : state.filter === 'waiting' ? '답변 대기 중인 질문이 없어요' : state.filter === 'followup' ? '재문의·확인할 질문이 없어요' : '모든 질문에 답변을 받았어요'}</h3><p>${c.questions.length ? '아래 처리 약속도 실제로 이행됐는지 확인해 주세요.' : (c.analysis && c.analyzedMessageCount === c.messages.length ? '내가 문의한 내용을 확인하고, 빠진 질문은 새 답변 / 질문 추가에서 넣어 주세요.' : '위의 질문 분석하기를 누르면 원문과 연결된 질문 카드가 생겨요.')}</p></div>`}</div>
    <section class="promise-section" id="inquiry-promises" tabindex="-1"><div class="section-title"><div>${icon('clock')}<h2>답변 뒤에 남은 약속</h2></div><span>${c.promises.length}건</span></div><p class="section-description">안내받은 약속과 실제로 확인한 결과를 구분해요.</p>${c.promises.length ? c.promises.map(p => `<article class="promise-card ${p.confirmedAt ? 'confirmed' : ''}"><div><span class="promise-label">${p.confirmedAt ? '사용자 확인 완료' : p.state === 'reported' ? '업체의 처리 안내 · 직접 확인 전' : '처리 약속 · 직접 확인 전'}</span><h3>${esc(p.title)}</h3>${deadlineLabel(p)}<div class="due">${icon('clock')}${p.dueAt ? `${esc(p.dueAt)}까지` : '기한 미정'}${p.dueText ? ` <span>(${esc(p.dueText)}${!p.dueAt ? ' · 기준 날짜 확인 필요' : ''})</span>` : ''}</div><button class="promise-source" data-action="source" data-id="${p.evidence.messageId}">“${esc(p.evidence.quote)}” ${icon('link')}</button>${p.confirmedAt ? `<small class="confirmed-time">${date(p.confirmedAt)} 직접 확인</small>` : ''}</div>${button('confirm-promise', p.confirmedAt ? '확인 취소' : '직접 확인했어요', p.confirmedAt ? 'text' : 'secondary compact', p.confirmedAt ? 'check' : '', `data-id="${p.id}"`)}</article>`).join('') : '<p class="quiet-empty">명시적인 처리 약속이 나오면 여기에 모아 둘게요.</p>'}</section>
    ${c.questions.some(q => q.status !== 'answered') ? `<div class="next-step"><span>${icon('spark')}남은 질문을 다시 설명할 필요 없어요.</span>${button('draft-tab', '재문의 초안 만들기', 'primary compact', 'arrow')}</div>` : ''}
    ${c.analysis ? `<p class="analysis-meta">마지막 분석 ${date(c.analysis.at)}${c.mode === 'live' ? ' · AI 판단은 원문과 함께 확인해 주세요.' : ' · 준비된 가상 기록'}</p>${c.mode === 'live' ? `<details class="analysis-details" data-disclosure="analysis-details-${esc(c.id)}"><summary>분석 상세</summary><p>사용 모델: ${esc(c.analysis.model)}${c.analysis.usage?.total_tokens ? `<br>사용량: ${c.analysis.usage.total_tokens.toLocaleString()} 토큰${c.analysis.usage.unobserved_requests ? ' 이상 · 일부 요청 사용량 미확인' : ''}` : ''}</p></details>` : ''}` : ''}`;
}
function openDraftPanel() {
  state.tab = 'drafts'; state.mobile = 'analysis'; render();
  const panel = $('#panel-drafts');
  panel?.focus({ preventScroll: true });
  panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
}
function draftScopeHtml(c) {
  return draftScope(c, state.selected, state.replyLanguages[c.id] ?? c.drafts.followup?.language ?? (c.channel === 'email' ? 'en' : 'ko'), esc);
}
function draftPanel(c) {
  const replyLanguage = state.replyLanguages[c.id] ?? c.drafts.followup?.language ?? (c.channel === 'email' ? 'en' : 'ko');
  const remaining = c.questions.filter(q => q.status !== 'answered');
  return `<div class="section-tools"><div><h2>필요한 이야기만 이어가세요</h2><p>초안을 확인하고 수정한 뒤, 원하는 채널에 붙여넣어요.</p></div></div><section class="draft-section"><div class="section-title"><div>${icon('chat')}<h2>남은 질문 재문의</h2></div><span>${remaining.length}개 남음</span></div>${c.mode !== 'demo' ? `<label class="field">답장 언어<select id="reply-language"><option value="ko" ${replyLanguage === 'ko' ? 'selected' : ''}>한국어</option><option value="en" ${replyLanguage === 'en' ? 'selected' : ''}>English · 영어</option></select></label>` : ''}<div class="question-choices">${remaining.map(q => `<label><input type="checkbox" name="draft-question" value="${q.id}" ${state.selected.has(q.id) ? 'checked' : ''}><span>${esc(q.title)}</span>${badge(q.status)}</label>`).join('') || `<p class="quiet-empty">${c.questions.length ? '모든 질문에 답변을 받았어요. 실제 처리 결과는 질문 확인표에서 따로 확인해 주세요.' : '분석된 질문이 없어요. 질문 확인표에서 먼저 내용을 확인해 주세요.'}</p>`}</div>${button('generate-draft', c.drafts.followup ? '초안 다시 만들기' : '선택한 질문으로 초안 만들기', 'primary', 'spark', `data-kind="followup" ${!state.selected.size || c.analyzedMessageCount < c.messages.length ? 'disabled' : ''}`)}<div id="draft-scope" aria-live="polite">${draftScopeHtml(c)}</div>${draftEditor(c,'followup')}</section>`;
}
function draftEditor(c, kind) {
  const draft = c.drafts[kind];
  const dirty = dirtyKinds().includes(kind);
  if (!draft && state.draftEdits[kind] === undefined) return '';
  return `<div class="draft-editor"><label for="draft-${kind}">${kind === 'followup' ? `${draft?.language === 'en' ? '영어 ' : ''}재문의 초안` : '상담 인계 요약'} <span>직접 수정할 수 있어요</span></label>${!draft ? '<p class="warning-note">다른 작업에서 원래 초안이 초기화됐어요. 편집 내용은 아래에 보존했으니 먼저 복사한 뒤 최신 상담으로 초안을 다시 만들어 주세요.</p>' : ''}<textarea id="draft-${kind}" data-draft="${kind}" rows="7" maxlength="8000" ${state.busy ? 'readonly' : ''}>${esc(state.draftEdits[kind] ?? savedDraft(draft))}</textarea><div class="draft-editor-bottom"><span id="draft-status-${kind}" role="status">${draftStatus(kind)}</span><div class="draft-actions">${draft ? button('save-draft','편집 저장','primary compact','check',`data-kind="${kind}" ${!dirty ? 'disabled' : ''}`) : ''}${button('copy','복사하기','secondary compact','copy',`data-kind="${kind}"`)}</div></div><p class="draft-note">자동 전송되지 않아요. 직접 편집한 문장은 원문과 대조해 주세요.</p>${draft ? `<details class="draft-sources" data-disclosure="draft-sources-${esc(c.id)}-${kind}"><summary>생성 당시 원문 근거 ${draft.sourceMessageIds.length}개</summary>${draft.sourceMessageIds.map(id => `<button class="quote" data-action="source" data-id="${id}">${icon('link')}${esc(c.messages.find(m => m.id === id)?.text)}</button>`).join('')}</details>${draft.editedAt ? `<details class="draft-sources" data-disclosure="draft-original-${esc(c.id)}-${kind}"><summary>편집 전 생성 초안 보기</summary><p class="original-draft">${esc(draft.body)}</p></details>` : ''}` : ''}</div>`;
}
function draftStatus(kind) {
  const draft = state.current?.drafts[kind];
  if (draft && state.current.analyzedMessageCount < state.current.messages.length) return '이전 분석 기준 · 새 답변 분석 전';
  return dirtyKinds().includes(kind) ? '저장하지 않은 편집 내용' : draft?.editedAt ? `${date(draft.editedAt)} 편집 저장됨` : '생성 초안 저장됨';
}
function historyPanel(c) {
  return `<div class="section-tools"><div><h2>상담이 이어진 발자취</h2><p>새 답변, AI 분석, 직접 확인한 내용을 기록해요.</p></div></div><ol class="timeline">${c.history.map(h => `<li><span class="timeline-dot">${icon(h.type === 'confirmation' ? 'check' : h.type === 'analysis' ? 'spark' : 'chat')}</span><div><time>${date(h.at)}</time><h3>${esc(h.label)}</h3>${h.details ? `<p>${esc(h.details)}</p>` : ''}${h.comparison && h.comparison.kind !== 'initial' ? `<details class="history-comparison" data-disclosure="history-${esc(c.id)}-${esc(h.id)}"><summary>반영 전후 비교 보기 · 질문 ${h.comparison.questions.length}건 · 약속 ${h.comparison.promises.length}건</summary><p class="change-note">이 분석 당시의 기록이에요. 현재 상태와 다를 수 있어요.</p>${comparisonContents(h.comparison)}</details>` : ''}</div></li>`).join('')}</ol>`;
}
function showModal(title, content, wide = false) {
  const modal = $('#modal'); modal.className = wide ? 'modal wide-modal' : 'modal';
  if (!modal.open) modalReturnFocus = focusBookmark();
  modal.innerHTML = `<div class="modal-head"><div><h2>${title}</h2></div><button class="btn icon-btn" data-action="close-modal" aria-label="닫기">${icon('close')}</button></div><section class="operation-panel" data-progress hidden aria-label="작업 진행 상황"></section>${content}<p id="modal-error" class="modal-error" role="alert"></p><p id="modal-status" role="status"></p>`;
  if (!modal.open) modal.showModal();
  updateReviewStatus();
}
function connectionLabel() {
  return state.config.connection?.state === 'ready' ? 'AI 연결됨' : state.config.connection?.state === 'failed' ? 'AI 연결 확인 필요' : state.config.configured ? '첫 분석 시 연결 확인' : 'AI 연결 설정';
}
function showSettings() {
  if (state.config.managed) { toast('AI 연결은 관리자가 설정해요. 연결되지 않으면 관리자에게 알려 주세요.'); return; }
  captureOnboarding();
  settingsReturn = $('#modal').open && !!$('#modal').querySelector('#import-form, #privacy-form, #review-form');
  showModal('AI 연결 설정', `<p class="modal-intro">키는 서버 메모리에만 보관돼요. 짧은 실제 요청으로 키·모델·응답 형식을 확인하며 소량의 API 비용이 발생해요.</p><p class="connection-result" role="status">${connectionLabel()}${state.config.connection?.checkedAt ? ` · ${date(state.config.connection.checkedAt)}` : ''}</p><form id="settings-form"><label class="field">OpenAI API 키<input id="api-key" type="password" autocomplete="off" placeholder="${state.config.configured ? '등록됨 · 변경할 때만 입력' : 'sk-…'}" ${state.config.configured ? '' : 'required'}></label><label class="field">모델<input id="api-model" value="${esc(state.config.model)}" required></label><div class="form-note">상담 자료 없이 연결만 점검해요. 실제 분석 전에도 점검하며, 통과 결과는 10분간 사용해요. 키는 기록이나 내보내기에 포함하지 않아요.</div><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">닫기</button><button class="btn primary" type="submit">저장하고 연결 점검</button></div></form>`);
}
function showCaseSettings() {
  const c = state.current;
  showModal('상담 관리', `<form id="case-settings-form"><label class="field">문의 제목<input name="title" maxlength="100" value="${esc(c.title)}" required></label><label class="field">문의처<input name="company" maxlength="60" value="${esc(c.company)}"></label><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">상담 정보 저장</button></div></form><div class="archive-controls"><h3>${c.archivedAt ? '보관한 상담' : '상담 보관하기'}</h3><p>진행 목록에서 잠시 빼 둘 수 있어요. 원문과 질문·약속 상태는 그대로 유지하며, 보관함에서 언제든 복원할 수 있어요.</p>${button(c.archivedAt ? 'restore' : 'archive',c.archivedAt ? '진행 목록으로 복원' : '보관함으로 이동','secondary compact')}</div><div class="archive-controls"><h3>상담 기록 삭제</h3><p>원문과 분석 기록을 영구 삭제해요. 진행 목록에서만 숨기려면 보관함을 이용하세요.</p>${button('delete', '상담 삭제', 'secondary compact')}</div>`);
}
function captureOnboarding() {
  if (!state.onboarding) return;
  if ($('#import-form')) readNewMetadata();
  const privacy = $('#privacy-form');
  if (privacy) state.onboarding.prepared.text = privacy.elements.text.value;
  const review = $('#review-form');
  if (review) {
    state.onboarding.title = review.elements.title.value;
    state.onboarding.company = review.elements.company.value;
    state.onboarding.messages = [...review.querySelectorAll('.review-row')].map(row => ({
      role: row.querySelector('[name=role]').value, text: row.querySelector('textarea').value,
      sentAt: row.querySelector('[name=sentAt]').value ? new Date(row.querySelector('[name=sentAt]').value).toISOString() : null,
    }));
  }
}
function resumeOnboarding() {
  state.onboarding ||= newOnboarding();
  if (state.onboarding.stage === 'privacy') showPrivacyPreview(state.onboarding.prepared);
  else if (state.onboarding.stage === 'review') showReview();
  else showNew();
}
function onboardingConnection() {
  if (state.auth?.enabled) return state.config.configured ? '' : '<p class="form-note">AI 연결을 준비 중이에요. 관리자에게 알려 주세요.</p>';
  if (state.config.connection?.state === 'ready') return '';
  return `<div class="onboarding-connection"><span>${state.config.configured ? '첫 분석 때 연결 상태를 확인해요.' : '문의 분석을 위해 AI 연결을 설정해 주세요. 입력한 내용은 유지돼요.'}</span><button type="button" class="btn secondary compact" data-action="settings">AI 연결 설정</button></div>`;
}
function showNew() {
  state.onboarding ||= newOnboarding();
  const data = state.onboarding;
  data.stage = 'import';
  showModal(data.targetCaseId ? '새 이메일 이어 붙이기' : '어떤 상담을 이어갈까요?', `<p class="modal-intro">대화를 가져온 뒤, 발화자와 내용을 확인하고 분석해요. 이 탭을 열어 둔 동안 입력을 유지해요.</p>${onboardingConnection()}<form id="import-form"><label class="field">문의 유형<select name="channel" ${data.targetCaseId ? 'disabled' : ''}><option value="chat" ${data.channel !== 'email' ? 'selected' : ''}>일반 상담</option><option value="email" ${data.channel === 'email' ? 'selected' : ''}>이메일 문의</option></select></label>${data.channel === 'email' ? `<p class="form-note">내 문의와 받은 답변을 헤더와 함께 붙여넣거나 캡처해 주세요. 이전 답장 인용은 중복을 정리한 뒤 직접 확인해요. 영어 원문은 그대로 보존해요.</p><label class="field">내 발신 이메일 주소 (선택)<input name="myAddress" type="email" value="${esc(data.myAddress || '')}" maxlength="254" placeholder="발신자 구분에만 사용해요"></label>` : ''}<div class="form-grid"><label class="field">문의 제목<input name="title" value="${esc(data.title)}" ${data.targetCaseId ? 'readonly' : ''} placeholder="예: 불량 이어폰 환불 문의" maxlength="100" required></label><label class="field">문의처<input name="company" value="${esc(data.company)}" ${data.targetCaseId ? 'readonly' : ''} placeholder="예: 모노샵 고객센터" maxlength="60"></label></div><label class="field">${data.channel === 'email' ? '이메일 본문' : '상담 내용'}<textarea name="text" rows="8" maxlength="30000" placeholder="${data.channel === 'email' ? 'From: me@example.com&#10;What documents do you need to recover my account?&#10;&#10;From: support@example.com&#10;Please provide the transaction ID from your receipt.' : '나: 환불 금액과 처리 기간이 궁금합니다.&#10;고객센터: 금액은 확인 후 안내하겠습니다.'}">${esc(data.text)}</textarea></label><details class="capture-options" ${data.file ? 'open' : ''}><summary>캡처로 가져오기 (선택)</summary><label class="field">캡처 언어<select name="ocrLanguage"><option value="kor+eng" ${(data.ocrLanguage || (data.channel === 'email' ? 'eng' : 'kor+eng')) === 'kor+eng' ? 'selected' : ''}>한국어 · 영어 혼합</option><option value="eng" ${(data.ocrLanguage || (data.channel === 'email' ? 'eng' : 'kor+eng')) === 'eng' ? 'selected' : ''}>영어</option></select></label><label class="upload-zone">${icon('file')}<span><strong>${data.channel === 'email' ? '이메일 캡처로 가져오기' : '대화 캡처로 가져오기'}</strong><small>PNG · JPG · WebP / 최대 4MB / 1장</small></span><input name="image" type="file" accept="image/png,image/jpeg,image/webp"></label>${data.file ? `<p class="selected-capture">선택한 캡처: ${esc(data.file.name)} <button type="button" class="btn text compact" data-action="remove-capture">선택 해제</button></p>` : ''}</details><p class="form-note">전화번호·주소를 기본으로 가려요. 캡처는 서버에서 글자를 읽으며 원본 이미지는 외부 AI로 보내거나 저장하지 않아요. 다음 화면에서 가림 결과를 확인해 주세요.</p><div class="modal-actions"><button type="button" class="btn secondary" data-action="manual">직접 나누어 입력</button><button class="btn primary" type="submit">${icon('spark')}개인정보 가리고 확인</button></div></form>`, true);
}
function readNewMetadata() {
  const form = $('#import-form');
  if (form) {
    const data = state.onboarding;
    if (data.text !== form.elements.text.value) { data.prepared = null; data.messages = []; data.notes = []; }
    if (data.channel !== form.elements.channel.value || data.myAddress !== (form.elements.myAddress?.value || '')) { data.prepared = null; data.messages = []; data.notes = []; }
    if (data.ocrLanguage !== form.elements.ocrLanguage.value) { data.prepared = null; data.messages = []; }
    data.ocrLanguage = form.elements.ocrLanguage.value;
    data.channel = form.elements.channel.value; data.myAddress = form.elements.myAddress?.value || '';
    data.title = form.elements.title.value; data.company = form.elements.company.value; data.text = form.elements.text.value;
    if (form.elements.image.files[0] && data.file !== form.elements.image.files[0]) { data.file = form.elements.image.files[0]; data.prepared = null; }
  }
}
function showPrivacyPreview(prepared) {
  state.onboarding.prepared = prepared;
  state.onboarding.stage = 'privacy';
  showModal('AI에 보내기 전에 확인해 주세요', `<p class="modal-intro">전화번호 ${prepared.counts.phone}개·주소 ${prepared.counts.address}개를 자동으로 가렸어요. 아직 상담 내용은 외부 AI로 보내지 않았어요.</p>${onboardingConnection()}<form id="privacy-form"><label class="field">AI에 전달할 상담 내용<textarea name="text" rows="12" maxlength="30000" required>${esc(prepared.text)}</textarea></label><p class="form-note">한국 전화번호·도로명·지번 주소를 기본 탐지해요. 특이한 표기나 캡처 인식 오류는 놓칠 수 있으니 이름·이메일 주소·계좌번호·복구 코드 등 추가로 숨길 내용도 직접 지워 주세요. 가림 표시는 저장 후 되돌릴 수 없어요.</p><div class="modal-actions"><button type="button" class="btn secondary" data-action="onboarding-import">이전 단계</button><button type="submit" class="btn primary">보낸 사람과 내용 확인</button></div></form>`, true);
}
const localDateInput = iso => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '';
function reviewRow(m, i) {
  return `<div class="review-row" data-index="${i}"><div class="review-row-head"><span>메시지 ${i + 1}</span><select name="role" aria-label="메시지 ${i + 1} 보낸 사람"><option value="customer" ${m.role === 'customer' ? 'selected' : ''}>나</option><option value="agent" ${m.role === 'agent' ? 'selected' : ''}>고객센터</option><option value="unknown" ${m.role === 'unknown' ? 'selected' : ''}>보낸 사람 확인 필요</option></select><button class="btn icon-btn" type="button" data-action="remove-row" aria-label="메시지 ${i + 1} 삭제">${icon('close')}</button></div><label class="review-date">실제 상담 날짜와 시간 (선택)<input type="datetime-local" name="sentAt" value="${localDateInput(m.sentAt)}" aria-label="메시지 ${i + 1} 날짜 (선택)"></label><textarea name="text" rows="3" maxlength="6000" required aria-label="메시지 ${i + 1} 내용">${esc(m.text)}</textarea></div>`;
}
function showReview() {
  const data = state.onboarding;
  data.stage = 'review';
  showModal('원문을 한 번 확인해 주세요', `<p class="modal-intro">이 내용이 분석의 기준이 돼요. 보낸 사람과 인식 오류를 고치고, 실제 상담 날짜를 아는 경우 입력해 주세요.</p>${onboardingConnection()}${data.notes.map(n => `<p class="warning-note">${esc(n)}</p>`).join('')}<form id="review-form"><div class="form-grid"><label class="field">문의 제목<input name="title" value="${esc(data.title)}" maxlength="100" ${data.targetCaseId ? 'readonly' : ''} required></label><label class="field">문의처<input name="company" value="${esc(data.company)}" maxlength="60" ${data.targetCaseId ? 'readonly' : ''}></label></div><div id="review-rows">${data.messages.map(reviewRow).join('')}</div><button class="btn secondary" type="button" data-action="add-row">${icon('plus')}메시지 추가</button><div class="form-note">날짜가 없는 “내일” 같은 표현은 기한 미정으로 남겨요. 전화번호·주소는 저장 전 다시 가리고, 가린 원문만 OpenAI에 전달해요. 인식 오류와 누락된 개인정보를 확인해 주세요.</div><div class="modal-actions"><button class="btn secondary" type="button" data-action="onboarding-back">이전 단계</button><button class="btn primary" type="submit">${data.targetCaseId ? '저장하고 새 답변 분석' : '저장하고 질문 분석하기'} ${icon('arrow')}</button></div></form>`, true);
}
function updateReviewStatus() {
  const form = $('#review-form');
  if (!form) return;
  let notice = $('#review-role-status');
  if (!notice) {
    notice = document.createElement('p');
    notice.id = 'review-role-status'; notice.className = 'warning-note'; notice.setAttribute('role', 'status');
    $('#review-rows').before(notice);
  }
  const roles = [...form.querySelectorAll('[name=role]')];
  const unknown = roles.filter(el => el.value === 'unknown');
  notice.hidden = !unknown.length;
  notice.textContent = unknown.length ? `발화자를 확인할 메시지가 ${unknown.length}개 있어요. 원문을 보고 ‘나’ 또는 ‘고객센터’를 선택해 주세요.` : '';
  if (!unknown.length && $('#modal-error').textContent === '저장하기 전에 발화자를 확인해 주세요.') $('#modal-error').textContent = '';
  for (const el of roles) {
    el.setAttribute('aria-invalid', String(el.value === 'unknown'));
    if (el.value === 'unknown') el.setAttribute('aria-describedby', notice.id);
    else el.removeAttribute('aria-describedby');
  }
  return unknown;
}
function showAppend() {
  if (state.current.channel === 'email') {
    if (hasOnboardingInput(state.onboarding)) { toast('작성 중인 입력을 먼저 마무리해 주세요. 입력은 유지됩니다.'); resumeOnboarding(); return; }
    state.onboarding = { ...newOnboarding(), channel: 'email', title: state.current.title, company: state.current.company, targetCaseId: state.current.id, targetVersion: state.current.version };
    showNew(); return;
  }
  showModal('새로운 대화 이어 붙이기', `<p class="modal-intro">기존 질문과 새 답변을 연결해요. 전화번호·주소를 가린 메시지를 먼저 저장해요. 분석을 취소하거나 실패해도 메시지와 이전 분석·초안은 유지돼요.</p><form id="append-form"><div class="form-grid"><label class="field">발화자<select name="role"><option value="agent">고객센터</option><option value="customer">나</option></select></label><label class="field">실제 상담 날짜 (선택)<input name="sentAt" type="datetime-local"></label></div><label class="field">추가 메시지<textarea name="text" rows="7" maxlength="6000" required placeholder="새로 받은 답변을 붙여넣어 주세요."></textarea></label><div class="modal-actions"><button class="btn secondary" type="button" data-action="close-modal">취소</button><button class="btn primary" type="submit">저장하고 새 답변 분석</button></div></form>`);
}
function showEdit(id) {
  const q = state.current.questions.find(q => q.id === id);
  showModal('질문과 답변 상태 수정', `<p class="modal-intro">직접 지정한 상태는 새 분석 후에도 유지돼요. 최신 AI 제안으로 되돌릴 수도 있어요.</p><form id="edit-form" data-id="${q.id}"><label class="field">질문 제목<input name="title" maxlength="200" value="${esc(q.title)}" required></label><label class="field">답변 상태<select name="status">${Object.entries(names).map(([id,label]) => `<option value="${id}" ${q.status === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div class="form-note">AI 제안: ${names[q.aiStatus]}<br>${esc(q.aiReason)}</div><div class="modal-actions">${q.manualStatus ? `<button class="btn secondary" type="button" data-action="apply-ai" data-id="${q.id}">AI 제안 적용</button>` : ''}<button class="btn primary" type="submit">수정 내용 저장</button></div></form>`);
}
async function updateCase(path, method, data) {
  const c = state.current;
  const input = { ...data, version: c.version };
  const result = path === 'email-explanation' ? await runOperation('email-explanation', input, c.id)
    : path === 'analyze' ? await runOperation('analyze', input, c.id)
    : path === 'actions' ? await runOperation('actions', input, c.id)
    : path === 'drafts' && method === 'POST' ? await runOperation('draft', input, c.id)
    : await api(`/api/cases/${c.id}${path ? `/${path}` : ''}`, method, input);
  views.remember(result);
  if (state.current?.id === c.id) {
    if (['analyze','demo-next'].includes(path) || /^(questions|promises)\//.test(path)) state.draftEdits = {};
    if (path === 'drafts' && method === 'POST') delete state.draftEdits[data.kind];
    if (path.startsWith('drafts/') && method === 'PATCH') delete state.draftEdits[path.split('/')[1]];
    setCase(result);
  }
  await refreshList();
  render();
}
function highlightSource(id) {
  if (state.current?.demoScenario === 'email' && state.emailDemoFocus[state.current.id] !== null) {
    const source = state.current.messages.find(m => m.id === id);
    if (source) showModal('판정 근거 원문', `<p class="modal-intro" lang="en">${esc(source.text)}</p><div class="modal-actions">${button('close-modal', '닫기', 'secondary')}</div>`);
    return;
  }
  state.sourceReturn = { caseId: state.current.id, version: state.current.version, messageId: id, tab: state.tab, mobile: state.mobile, filter: state.filter, focus: focusBookmark() };
  state.mobile = 'source'; render();
  const el = document.getElementById(`message-${id}`);
  if (el) { el.classList.add('highlight'); el.tabIndex = -1; el.focus({ preventScroll: true }); el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); setTimeout(() => el.classList.remove('highlight'), 3500); }
}
function returnFromSource() {
  const back = state.sourceReturn; state.sourceReturn = null;
  if (!back || back.caseId !== state.current?.id || back.version !== state.current.version) return;
  state.tab = back.tab; state.mobile = back.mobile; state.filter = back.filter;
  render(); restoreFocus(back.focus); document.activeElement?.scrollIntoView({ block: 'center', behavior: 'instant' });
}
function downloadRecord() {
  const c = state.current;
  const text = `# ${c.title}\n\n${c.company} · ${c.mode === 'demo' ? '가상 기록' : '실제 AI 분석'}\n\n${c.summary}\n\n## 질문 확인표\n\n${c.questions.map(q => `- ${q.title}: ${names[q.status]}\n  - ${q.reason}\n${q.evidence.map(e => `  - 근거: ${e.quote}`).join('\n')}`).join('\n')}\n\n## 처리 약속\n\n${c.promises.map(p => `- ${p.title}: ${p.confirmedAt ? '사용자 확인 완료' : p.state === 'reported' ? '업체 처리 안내 / 직접 확인 전' : '처리 약속 / 직접 확인 전'} · ${p.dueAt || '기한 미정'}\n  - ${p.evidence.quote}`).join('\n')}\n\n${actionsMarkdown(c)}\n## 상담 원문\n\n${c.messages.map(m => `### ${m.role === 'customer' ? '나' : c.company} · ${date(m.sentAt)}\n\n${m.text}`).join('\n\n')}\n\n${Object.keys({ ...c.drafts, ...state.draftEdits }).map(kind => `## ${kind === 'followup' ? '재문의 초안' : '인계 요약'}\n\n${state.draftEdits[kind] ?? savedDraft(c.drafts[kind])}`).join('\n\n')}`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `ReplyTrack-${c.title.replace(/[<>:"/\\|?*]/g,'_')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]'); if (!target) return;
  event.preventDefault();
  if (target.dataset.action === 'cancel-operation') { await state.operation?.cancel(); return; }
  const action = target.dataset.action;
  if (blocked(action)) return;
  if (['home', 'open', 'tab', 'draft-tab', 'mobile', 'source', 'source-return', 'inquiry-section'].includes(action)) viewRevision++;
  if (action === 'guard-cancel') return resolveGuard(false);
  if (action === 'guard-continue') return resolveGuard(true);
  const navigating = ['home','new','demo','email-demo'].includes(action) || (action === 'open' && target.dataset.id !== state.current?.id);
  const invalidating = ['demo-next','email-demo-reply','analyze','append','edit-question','apply-ai','confirm-promise','generate-draft'].includes(action);
  if ((navigating || invalidating) && !await guardEdits(invalidating, action === 'generate-draft' ? target.dataset.kind : undefined)) return;
  if (['home', 'tab', 'draft-tab', 'mobile', 'inquiry-section'].includes(action)) state.sourceReturn = null;
  if (action === 'home') { views.leave(); state.current = null; state.draftEdits = {}; state.error = ''; window.history.replaceState(null,'','/'); await viewWork('상담 목록을 불러오고 있어요', refreshList); }
  if (action === 'refresh') await viewWork('상담 목록을 새로 불러오고 있어요', refreshList);
  if (action === 'inquiry-section') {
    state.tab = 'questions'; state.mobile = 'analysis';
    state.filter = target.dataset.value === 'questions' ? 'followup' : target.dataset.value === 'waiting' ? 'waiting' : 'all';
    render();
    const section = $(target.dataset.value === 'actions' ? '#next-actions-title' : target.dataset.value === 'waiting' && !state.current.questions.some(q => q.status === 'waiting') ? '#inquiry-promises' : '#inquiry-questions');
    section?.setAttribute('tabindex', '-1'); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  if (action === 'case-filter') { state.caseFilter = target.dataset.value; render(); }
  if (action === 'reset-search') { state.query = ''; state.caseFilter = 'active'; render(); }
  if (action === 'case-settings') showCaseSettings();
  if (['archive','restore'].includes(action)) await work('상담 목록을 정리하고 있어요', async () => { await updateCase('','PATCH',{archived:action === 'archive'}); $('#modal').close(); toast(action === 'archive' ? '보관함으로 이동했어요. 언제든 복원할 수 있어요.' : '진행 목록으로 복원했어요.'); });
  if (action === 'save-draft') await work('편집한 초안을 저장하고 있어요', async () => { await updateCase(`drafts/${target.dataset.kind}`,'PATCH',{body:state.draftEdits[target.dataset.kind]}); toast('편집 내용을 저장했어요.'); });
  if (action === 'new') resumeOnboarding();
  if (action === 'settings') showSettings();
  if (action === 'account') { captureOnboarding(); state.auth = await api('/api/auth/me'); showAccount(); }
  if (action === 'join') {
    if (!await guardEdits()) return;
    captureOnboarding();
    if (hasOnboardingInput(state.onboarding) && !confirm('작성 중인 입력은 저장되지 않았어요. 계정 연결 화면으로 이동할까요?')) return;
    state.onboarding = null; state.draftEdits = {}; location.assign('/login?register=1');
  }
  if (action === 'logout') {
    if (!await guardEdits()) return;
    if (state.auth.user?.role === 'guest' && !confirm('비회원 이용을 종료하면 이 문의 기록이 삭제돼요. 종료할까요?')) return;
    if (hasOnboardingInput(state.onboarding) && !confirm('작성 중인 입력은 저장되지 않았어요. 로그아웃할까요?')) return;
    try { await api('/api/auth/logout', 'POST', {}); state.onboarding = null; state.draftEdits = {}; location.replace('/login'); }
    catch (e) { toast(e.message); }
  }
  if (action === 'close-modal') { captureOnboarding(); if (guardResolve) resolveGuard(false); else if (settingsReturn) { settingsReturn = false; resumeOnboarding(); } else $('#modal').close(); }
  if (action === 'dismiss-error') { state.error = ''; render(); }
  if (action === 'open') await viewWork('상담 기록을 불러오고 있어요', () => loadCase(target.dataset.id));
  if (action === 'email-demo-step' && state.current?.demoScenario === 'email') { const step = Number(target.dataset.step); if (Number.isInteger(step) && step >= 0 && step <= 3 && (step !== 3 || state.current.demoStep)) { state.emailDemoFocus[state.current.id] = step; render(); $('#email-demo-scene')?.focus(); } }
  if (action === 'email-demo-reply' && state.current?.demoScenario === 'email') await work('준비된 새 이메일을 반영하고 있어요', async () => { if (!state.current.demoStep) await updateCase('demo-next','POST',{}); state.emailDemoFocus[state.current.id] = 3; });
  if (action === 'email-demo-full' && state.current?.demoScenario === 'email') { state.emailDemoFocus[state.current.id] = null; state.tab = 'questions'; render(); }
  if (action === 'explain-email') await work('이메일 답변을 한국어로 설명하고 원문과 대조하고 있어요', () => updateCase('email-explanation','POST',{}));
  if (action === 'read-actions') await work('원문에서 업체가 요청한 할 일을 확인하고 있어요', () => updateCase('actions','POST',{}));
  if (action === 'action-followup') { state.selected = new Set([target.dataset.id]); openDraftPanel(); }
  if (action === 'complete-action') {
    const a = state.current.nextActions.items.find(a => a.id === target.dataset.id);
    if (a.completedAt) await work('수행 표시를 취소하고 있어요', () => updateCase(`actions/${a.id}`,'PATCH',{completed:false}));
    else showModal('요청받은 행동을 수행하셨나요?', `<p class="modal-intro"><strong>${esc(a.title)}</strong><br><br>사진 제출·반품 발송 등 이 행동을 직접 수행했을 때 표시해 주세요. 환불·교환 완료 상태는 바뀌지 않아요.</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">아직 수행 전이에요</button><button class="btn primary" data-action="action-complete-yes" data-id="${a.id}">직접 수행했어요</button></div>`);
  }
  if (action === 'action-complete-yes') await work('수행한 할 일을 기록하고 있어요', async () => { await updateCase(`actions/${target.dataset.id}`,'PATCH',{completed:true}); $('#modal').close(); toast('수행한 행동을 기록했어요. 환불·교환 상태는 그대로예요.'); });
  if (action === 'demo-next') await work('준비된 답변을 반영하고 있어요', async () => { await updateCase('demo-next', 'POST', {}); state.tab = 'questions'; toast('질문과 처리 약속이 갱신됐어요.'); });
  if (action === 'analyze') await work('AI가 질문과 답변 근거를 대조하고 있어요', () => updateCase('analyze','POST',{}));
  if (action === 'tab') { state.tab = target.dataset.value; render(); }
  if (action === 'draft-tab') openDraftPanel();
  if (action === 'mobile') { state.mobile = target.dataset.value; render(); }
  if (action === 'source') highlightSource(target.dataset.id);
  if (action === 'source-return') returnFromSource();
  if (action === 'append') showAppend();
  if (action === 'edit-question') showEdit(target.dataset.id);
  if (action === 'apply-ai') await work('AI 제안을 적용하고 있어요', async () => { await updateCase(`questions/${target.dataset.id}`, 'PATCH', { applyAI: true }); $('#modal').close(); });
  if (action === 'confirm-promise') {
    const p = state.current.promises.find(p => p.id === target.dataset.id);
    if (p.confirmedAt) await work('직접 확인 상태를 변경하고 있어요', () => updateCase(`promises/${p.id}`, 'PATCH', { confirmed: false }));
    else showModal('실제 결과를 확인하셨나요?', `<p class="modal-intro"><strong>${esc(p.title)}</strong><br><br>업체의 안내와 별개로, 환불 입금·교환품 수신 등 처리 결과를 직접 확인했을 때 완료로 표시해 주세요.</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">아직 확인 전이에요</button><button class="btn primary" data-action="confirm-yes" data-id="${p.id}">직접 확인했어요</button></div>`);
  }
  if (action === 'confirm-yes') await work('직접 확인한 결과를 기록하고 있어요', async () => { await updateCase(`promises/${target.dataset.id}`, 'PATCH', { confirmed: true }); $('#modal').close(); toast('사용자 확인 완료로 기록했어요.'); });
  if (action === 'generate-draft') { const language = target.dataset.kind === 'followup' ? ($('#reply-language')?.value || (state.current?.demoScenario === 'email' ? 'en' : 'ko')) : 'ko'; await work('확인된 사실로 초안을 작성하고 있어요', () => updateCase('drafts','POST',{kind:target.dataset.kind, language, questionIds:[...state.selected]})); }
  if (action === 'copy') {
    const area = $(`#draft-${target.dataset.kind}`);
    try { await navigator.clipboard.writeText(area.value); toast('초안을 복사했어요.'); }
    catch { area.focus(); area.select(); toast('복사 권한이 없어요. 선택된 내용을 Ctrl+C로 복사해 주세요.'); }
  }
  if (action === 'export') downloadRecord();
  if (action === 'delete') showModal('상담 기록을 삭제할까요?', `<p class="modal-intro">‘${esc(state.current.title)}’의 원문과 분석 기록이 삭제돼요. 삭제 후에는 되돌릴 수 없어요.</p><div class="modal-actions"><button class="btn secondary" data-action="close-modal">취소</button><button class="btn danger" data-action="delete-yes">상담 삭제</button></div>`);
  if (action === 'delete-yes') await work('상담 기록을 삭제하고 있어요', async () => { await api(`/api/cases/${state.current.id}`, 'DELETE', {version:state.current.version}); state.current=null; state.draftEdits={}; window.history.replaceState(null,'','/'); localStorage.removeItem('replytrack:last-case'); await refreshList(); $('#modal').close(); });
  if (action === 'manual') { readNewMetadata(); if (!state.onboarding.messages.length) state.onboarding.messages = manualMessages(state.onboarding.text); showReview(); }
  if (action === 'onboarding-import') { captureOnboarding(); showNew(); }
  if (action === 'onboarding-back') { captureOnboarding(); if (state.onboarding.prepared) showPrivacyPreview(state.onboarding.prepared); else showNew(); }
  if (action === 'remove-capture') { state.onboarding.file = null; state.onboarding.prepared = null; $('#import-form [name=image]').value = ''; showNew(); }
  if (action === 'add-row') { const rows = $('#review-rows'); if(rows.children.length < 60) rows.insertAdjacentHTML('beforeend',reviewRow({role:'agent',text:'',sentAt:null},rows.children.length)); captureOnboarding(); }
  if (action === 'remove-row') { target.closest('.review-row').remove(); captureOnboarding(); updateReviewStatus(); }
});
document.addEventListener('change', event => {
  if (event.target.closest('#import-form, #privacy-form, #review-form')) captureOnboarding();
  if (event.target.matches('#review-form [name=role]')) {
    updateReviewStatus();
    $('#modal-error').textContent = '';
  }
  if (event.target.id === 'case-sort') { state.sort = event.target.value; $('#workspace-results').innerHTML = caseResults(); }
  if (event.target.name === 'channel') { readNewMetadata(); state.onboarding.prepared = null; state.onboarding.messages = []; state.onboarding.ocrLanguage = state.onboarding.channel === 'email' ? 'eng' : 'kor+eng'; showNew(); }
  if (event.target.id === 'reply-language') {
    state.replyLanguages[state.current.id] = event.target.value;
    if ($('#draft-scope')) $('#draft-scope').innerHTML = draftScopeHtml(state.current);
  }
  if (event.target.id === 'question-filter') { state.filter = event.target.value; render(); }
  if (event.target.name === 'draft-question') {
    if (event.target.checked) state.selected.add(event.target.value); else state.selected.delete(event.target.value);
    const generate = $('[data-action="generate-draft"][data-kind="followup"]');
    if (generate) generate.disabled = !!state.busy || !state.selected.size || state.current.analyzedMessageCount < state.current.messages.length;
    if ($('#draft-scope')) $('#draft-scope').innerHTML = draftScopeHtml(state.current);
  }
});
document.addEventListener('keydown', event => {
  const tab = event.target.closest('[role="tab"][data-action="tab"]');
  if (!tab || blocked('tab') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
  const index = tabs.indexOf(tab);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  state.tab = tabs[next].dataset.value;
  viewRevision++;
  render();
  $(`#tab-${state.tab}`).focus();
});
document.addEventListener('input', event => {
  if (event.target.closest('#import-form, #privacy-form, #review-form')) captureOnboarding();
  if (event.target.id === 'case-search') { state.query = event.target.value; $('#workspace-results').innerHTML = caseResults(); }
  const kind = event.target.dataset.draft;
  if (kind) {
    state.draftEdits[kind] = event.target.value;
    $(`#draft-status-${kind}`).textContent = draftStatus(kind);
    const save = $(`[data-action="save-draft"][data-kind="${kind}"]`);
    if (save) save.disabled = state.busy || !dirtyKinds().includes(kind) || !event.target.value.trim();
  }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target;
  if (state.busy) return;
  if (form.id === 'case-settings-form') {
    const data = {title:form.elements.title.value,company:form.elements.company.value};
    await work('상담 정보를 저장하고 있어요',async () => { await updateCase('','PATCH',data); $('#modal').close(); toast('상담 정보를 수정했어요.'); });
  }
  if (form.id === 'settings-form') {
    const key = $('#api-key').value.trim(), model = $('#api-model').value.trim();
    await work('AI 연결을 사전 점검하고 있어요', async () => {
      state.config = await api('/api/config','PUT',{...(key ? {apiKey:key} : {}),model});
      $('#api-key').value = ''; $('#api-key').required = false; $('#api-key').placeholder = '서버에 등록됨 · 변경할 때만 입력';
      try { state.config = await runOperation('preflight'); toast('AI 연결을 확인했어요. 문의를 분석할 수 있어요.'); }
      finally { const result = $('.connection-result'); if (result) result.textContent = `${connectionLabel()}${state.config.connection?.checkedAt ? ` · ${date(state.config.connection.checkedAt)}` : ''}`; }
    });
    if (!state.error && settingsReturn) { settingsReturn = false; resumeOnboarding(); }
  }
  if (form.id === 'import-form') {
    readNewMetadata(); const text = state.onboarding.text.trim(), file = state.onboarding.file;
    if (state.onboarding.prepared) { showPrivacyPreview(state.onboarding.prepared); return; }
    await work('대화를 읽고 개인정보를 가리고 있어요', async () => {
      if (!text && !file) throw new Error('상담 텍스트나 캡처를 입력해 주세요.');
      if (file && file.size > 4 * 1024 * 1024) throw new Error('4MB 이하 캡처를 선택해 주세요.');
      const image = file ? await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); }) : undefined;
      const result = await runOperation('prepare', {text,image,ocrLanguage:state.onboarding.ocrLanguage});
      showPrivacyPreview(result);
    });
  }
  if (form.id === 'privacy-form') {
    captureOnboarding();
    if (!state.config.configured) { showSettings(); return; }
    const text = form.elements.text.value;
    if (state.onboarding.messages.length && state.onboarding.reviewText === text) { showReview(); return; }
    await work('연결을 확인하고 AI가 대화를 정리하고 있어요', async () => {
      const d = state.onboarding;
      const result = await runOperation('extract', {text, channel:d.channel, ...(d.myAddress ? {myAddress:d.myAddress} : {}), ...(d.targetCaseId ? {caseId:d.targetCaseId,version:d.targetVersion} : {})});
      Object.assign(state.onboarding, result, { reviewText: text }); showReview();
    });
  }
  if (form.id === 'review-form') {
    const unknown = updateReviewStatus();
    if (unknown?.length) {
      $('#modal-error').textContent = '저장하기 전에 발화자를 확인해 주세요.';
      unknown[0].focus({ preventScroll: true });
      unknown[0].scrollIntoView({ block: 'center', behavior: 'instant' });
      return;
    }
    captureOnboarding();
    if (!state.config.configured) { showSettings(); return; }
    const title = form.elements.title.value, company = form.elements.company.value;
    const messages = [...form.querySelectorAll('.review-row')].map(row => ({ role:row.querySelector('[name=role]').value,text:row.querySelector('textarea').value,sentAt:row.querySelector('[name=sentAt]').value ? new Date(row.querySelector('[name=sentAt]').value).toISOString() : null }));
    await work('상담을 저장하고 AI가 질문을 분석하고 있어요', async () => {
      if (messages.some(m => m.role === 'unknown')) throw new Error('모든 메시지의 발화자를 확인해 주세요.');
      const d = state.onboarding;
      if (d.targetCaseId) setCase(await api(`/api/cases/${d.targetCaseId}/email-messages`,'POST',{messages,version:d.targetVersion}));
      else setCase(await api('/api/cases','POST',{title,company,messages,channel:d.channel})); state.onboarding = null; await refreshList(); $('#modal').close(); state.tab='questions'; state.filter='all'; render();
      await updateCase('analyze','POST',{});
    });
  }
  if (form.id === 'append-form') {
    const body = {role:form.elements.role.value,text:form.elements.text.value,sentAt:form.elements.sentAt.value ? new Date(form.elements.sentAt.value).toISOString() : null};
    const revision = viewRevision, caseId = state.current.id;
    await work('새 대화를 저장하고 기존 질문에 연결하고 있어요', async () => { await updateCase('messages','POST',body); $('#modal').close(); await updateCase('analyze','POST',{}); if (viewRevision === revision && state.current?.id === caseId) state.tab='questions'; });
  }
  if (form.id === 'edit-form') {
    const body = {title:form.elements.title.value,status:form.elements.status.value};
    await work('수정 내용을 저장하고 있어요', async () => { await updateCase(`questions/${form.dataset.id}`,'PATCH',body); $('#modal').close(); });
  }
});
$('#modal').addEventListener('cancel', event => { captureOnboarding(); if (settingsReturn && !state.busy) { event.preventDefault(); settingsReturn = false; resumeOnboarding(); return; } if(state.busy) event.preventDefault(); else if (guardResolve) { event.preventDefault(); resolveGuard(false); } });
$('#modal').addEventListener('close', () => {
  if ($('#modal').open) return;
  restoreFocus(modalReturnFocus); modalReturnFocus = null;
});
async function init() {
  render();
  try {
    state.auth = await api('/api/auth/me');
    if (state.auth.enabled && !state.auth.user) { location.replace('/login'); return; }
    [state.config, state.cases] = await Promise.all([api('/api/config'),api('/api/cases')]);
    const last = new URLSearchParams(location.search).get('case');
    if (last && state.cases.some(c => c.id === last)) setCase(await api(`/api/cases/${last}`));
  } catch(e) { state.error=e.message; }
  render();
}
init();

function showAccount() {
  const { user, usage } = state.auth;
  if (user.role === 'guest') {
    const until = new Date(user.expiresAt).toLocaleString('ko-KR', { timeZone:'Asia/Seoul', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
    showModal('비회원으로 이용 중', `<p class="modal-intro">문의는 이 브라우저에서 <strong>${esc(until)}까지</strong> 이어 볼 수 있어요. 쿠키를 지우거나 이용을 종료하면 다시 찾을 수 없어요.</p><p class="form-note">회원가입하거나 로그인하면 지금 저장한 문의를 계정으로 이어서 보관해요.</p><div class="account-actions">${button('join','계정에 기록 보관하기','primary')}${button('logout','기록 삭제하고 종료','secondary')}</div><div class="modal-actions">${button('close-modal','닫기','secondary')}</div>`);
    return;
  }
  showModal('내 계정', `<p class="modal-intro"><strong>${esc(user.username)}</strong><br>문의 기록은 이 계정에서만 확인할 수 있어요.</p><p class="account-caption">오늘 AI 작업 ${usage.used}회</p><p class="form-note">분석·초안·공식 안내 등 AI 작업을 시작할 때 집계해요. 취소하거나 실패한 요청도 포함됩니다.</p><div class="account-actions">${user.role === 'admin' ? button('settings', 'AI 연결 설정', 'secondary') : ''}${button('logout', '로그아웃', 'secondary')}</div><div class="modal-actions">${button('close-modal','닫기','primary')}</div>`);
}
