import { ReplyTrackApi, SERVER_URL } from './api.js';
import { MAX_SELECTION } from './selection.js';

const api = new ReplyTrackApi();
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const statusNames = { unanswered: '미답변', partial: '부분 답변', waiting: '답변 대기', answered: '답변 받음', review: '확인 필요' };
let windowId, workspaceKey, captureKey, renderedPhase;
const state = { phase: 'input', raw: '', title: '고객센터 상담', company: '', source: '', messages: [], notes: [], recordId: null, recordVersion: null,
  record: null, draft: '', draftDirty: false, draftStale: false, selected: [], selectionInitialized: false, seenCapture: '', pending: null, busy: '', error: '', connection: 'checking', model: '', copied: false };

function persist() {
  if (!workspaceKey) return Promise.resolve();
  const { phase, raw, title, company, source, messages, notes, recordId, recordVersion, draft, draftDirty, draftStale, selected, selectionInitialized, seenCapture } = state;
  return chrome.storage.session.set({ [workspaceKey]: { phase, raw, title, company, source, messages, notes, recordId, recordVersion, draft, draftDirty, draftStale, selected, selectionInitialized, seenCapture } });
}
function saveSoon() { void persist(); }
function field(name, label, value, max) {
  return `<label for="${name}">${label}</label><input id="${name}" name="${name}" value="${escape(value)}" maxlength="${max}" ${name === 'title' ? 'required' : ''}>`;
}
function evidence(ref, record) {
  const message = record.messages.find(m => m.id === ref.messageId);
  if (!message) return '';
  return `<p class="source-label">${message.role === 'customer' ? '나' : '고객센터'} · 저장된 원문 인용</p><blockquote>${escape(ref.quote)}</blockquote>`;
}
function inputView() {
  return `<h1>이 대화, 빠진 답변은 없나요?</h1>
    <p class="intro">고객센터 대화를 선택하면 질문별로 받은 답변과 남은 내용을 정리해 드려요.</p>
    <button class="btn wide capture-button" data-action="capture">현재 탭의 선택한 대화 가져오기</button>
    <form id="extract-form">
      <label for="raw">가져온 대화</label>
      <textarea id="raw" name="raw" rows="8" maxlength="${MAX_SELECTION}" required placeholder="대화를 드래그한 뒤 가져오기를 누르거나, 여기에 직접 붙여넣어 주세요.">${escape(state.raw)}</textarea>
      <p class="hint counter" id="counter">${state.raw.length.toLocaleString()} / 30,000자</p>
      ${state.source ? `<p class="source">가져온 곳: ${escape(state.source)}</p>` : ''}
      ${field('title', '상담 제목', state.title, 100)}${field('company', '업체명 · 선택', state.company, 60)}
      <p class="privacy">‘대화 읽기’를 누르면 위 내용이 로컬 ReplyTrack 서버를 거쳐 OpenAI로 전송돼요. 불필요한 개인정보는 지워 주세요.</p>
      <button class="btn primary wide" type="submit">대화 읽기</button>
      <p class="hint">다음 단계에서 발화자와 원문을 확인해요.</p>
    </form>`;
}
function reviewView() {
  return `<h1>누가 한 말인지 확인해 주세요</h1><p class="intro">AI가 나눈 대화예요. 내 질문과 고객센터 답변이 맞게 나뉘었는지 확인한 뒤 분석해요.</p>
    ${state.notes.map(note => `<p class="warning">${escape(note)}</p>`).join('')}
    <form id="analyze-form">${state.messages.map((message, i) => `<section class="message-edit">
      <div class="message-heading"><label for="role-${i}">메시지 ${i + 1} 발화자</label><button type="button" class="text-button" data-action="remove-message" data-index="${i}">삭제</button></div>
      <select id="role-${i}" data-message="${i}" data-field="role" required><option value="unknown" ${message.role === 'unknown' ? 'selected' : ''}>발화자 선택 필요</option><option value="customer" ${message.role === 'customer' ? 'selected' : ''}>나</option><option value="agent" ${message.role === 'agent' ? 'selected' : ''}>고객센터</option></select>
      <label for="message-${i}">메시지 ${i + 1} 원문</label><textarea id="message-${i}" data-message="${i}" data-field="text" rows="3" maxlength="6000" required>${escape(message.text)}</textarea>
      <p class="hint">${message.sentAt ? `인식한 상담 시각: ${escape(new Date(message.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))} (한국 시간)` : '상담 날짜 미정 · 가져온 시각을 상담 날짜로 사용하지 않아요.'}</p>
      ${message.sentAt ? `<button type="button" class="text-button" data-action="clear-date" data-index="${i}">날짜가 다르면 미정으로 변경</button>` : ''}
    </section>`).join('')}
    <div class="actions"><button type="button" class="btn" data-action="add-message">메시지 추가</button><button type="button" class="btn" data-action="back">원문으로 돌아가기</button></div>
    <p class="privacy">확인한 원문과 분석 결과는 이 기기의 ReplyTrack 상담 기록에 저장돼요.</p>
    <button class="btn primary wide" type="submit">확인한 대화 분석하기</button></form>`;
}
function resultView() {
  const record = state.record;
  if (!record) return `<h1>저장한 상담 불러오기</h1><div class="empty"><p>연결을 확인하고 저장된 기록을 다시 불러와 주세요.</p><button class="btn primary" data-action="reload">기록 다시 불러오기</button><div class="actions"><button class="btn" data-action="new">다른 대화 분석하기</button></div></div>`;
  const remaining = record.questions.filter(q => q.status !== 'answered');
  const pendingAnalysis = record.analyzedMessageCount < record.messages.length;
  return `<div class="result-heading"><p class="hint">${escape(record.company)} · ${escape(record.analysis?.model || '아직 분석 전')}</p><h1>${escape(record.title)}</h1>
    <p>${escape(record.summary || '원문은 저장했어요. 분석을 다시 시도할 수 있어요.')}</p>
    <div class="result-actions"><a href="${SERVER_URL}/?case=${encodeURIComponent(record.id)}" target="_blank" rel="noopener noreferrer" class="small-link">웹에서 기록·수정</a><button class="text-button" data-action="reload">새로고침</button></div></div>
    ${record.warnings.map(w => `<p class="warning">${escape(w)}</p>`).join('')}
    ${pendingAnalysis && record.questions.length ? '<div class="warning"><p>새 대화가 아직 분석되지 않았어요. 아래는 이전 분석 결과예요.</p><button class="text-button" data-action="retry-analysis">저장한 원문 다시 분석</button></div>' : ''}
    ${record.questions.length ? `<div class="section-heading"><h2>질문 확인표</h2><p>${record.questions.length}개 중 ${remaining.length}개 확인 필요</p></div>
      ${record.questions.map(q => `<article class="question"><span class="badge ${Object.hasOwn(statusNames, q.status) ? q.status : 'review'}">${escape(statusNames[q.status] || '확인 필요')}</span><h3>${escape(q.title)}</h3><p>${escape(q.reason)}</p>
        <details><summary>판단에 사용한 원문 보기</summary>${evidence(q.source, record)}${q.evidence.map(ref => evidence(ref, record)).join('')}</details>
        ${q.status !== 'answered' ? `<label class="question-check"><input type="checkbox" name="question" value="${escape(q.id)}" ${state.selected.includes(q.id) ? 'checked' : ''}>재문의에 포함</label>` : ''}</article>`).join('')}`
      : '<div class="empty"><p>아직 질문 확인표를 만들지 못했어요.</p><button class="btn primary" data-action="retry-analysis">저장한 원문 다시 분석</button></div>'}
    ${record.promises.length ? `<div class="section-heading"><h2>확인할 처리 약속</h2></div>${record.promises.map(p => `<section class="promise"><strong>${escape(p.title)}</strong><p>${p.confirmedAt ? '사용자 확인 완료' : p.state === 'reported' ? '업체의 처리 안내 · 직접 확인 전' : '처리 약속 · 직접 확인 전'} · ${escape(p.dueAt || '기한 미정')}</p><details><summary>약속의 원문 보기</summary>${evidence(p.evidence, record)}</details></section>`).join('')}<p class="hint">실제 처리 확인은 웹의 상담 기록에서 할 수 있어요.</p>` : ''}
    ${record.questions.length ? `<section class="draft-section"><h2>남은 질문으로 재문의하기</h2><p>${remaining.length ? '확인할 질문을 골라 초안을 만들어 보세요.' : '모든 질문에 답변을 받았어요. 처리 약속이 있다면 실제 결과도 확인해 주세요.'}</p>
      ${remaining.length ? `<button class="btn primary wide" data-action="draft" ${!state.selected.length || pendingAnalysis ? 'disabled' : ''}>${state.draft ? '선택한 질문으로 다시 작성' : '재문의 초안 만들기'}</button>` : ''}
      ${state.draftStale ? '<p class="warning">상담 기록이 변경되었어요. 직접 편집한 초안은 그대로 보관했으니 최신 답변과 대조해 주세요. 「선택한 질문으로 다시 작성」을 누르면 초안이 교체돼요.</p>' : ''}
      ${state.draft || state.draftDirty ? `<label for="draft">재문의 초안 · 수정 가능</label><textarea id="draft" rows="7">${escape(state.draft)}</textarea><p class="hint">내용을 확인한 뒤 복사해서 보내 주세요. 직접 편집한 내용은 이 브라우저 세션에 유지돼요.</p><button class="btn wide" data-action="copy" ${!state.draft.trim() ? 'disabled' : ''}>초안 복사</button><p class="success" id="copy-status" role="status">${state.copied ? '초안을 복사했어요.' : ''}</p>` : ''}</section>` : ''}
    <div class="actions"><button class="btn wide" data-action="new">다른 대화 분석하기</button></div>`;
}
function focusBookmark() {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  const selector = element.id ? `#${CSS.escape(element.id)}` : element.dataset.action
    ? `[data-action="${CSS.escape(element.dataset.action)}"]${element.dataset.index !== undefined ? `[data-index="${element.dataset.index}"]` : ''}`
    : element.name === 'question' ? `[name="question"][value="${CSS.escape(element.value)}"]` : null;
  return selector ? { selector, start: element.selectionStart, end: element.selectionEnd } : null;
}
function render({ focus = focusBookmark(), reveal = false } = {}) {
  const changedPhase = renderedPhase !== undefined && renderedPhase !== state.phase;
  renderedPhase = state.phase;
  const messages = { checking: '서버 연결 확인 중', offline: '서버 연결 필요', unconfigured: 'OpenAI 연결 설정 필요', ready: `AI 연결됨 · ${state.model}` };
  $('#connection').innerHTML = `<span>${escape(messages[state.connection])}</span><button class="text-button" data-action="connect">연결 확인</button>`;
  $('#feedback').hidden = !state.error;
  $('#feedback').innerHTML = state.error ? `<p>${escape(state.error)}</p><button class="text-button" data-action="dismiss-error">닫기</button>` : '';
  $('#progress').hidden = !state.busy; $('#progress').textContent = state.busy;
  $('#capture-notice').hidden = !state.pending;
  $('#capture-notice').innerHTML = state.pending ? `<p>새로 선택한 대화 ${state.pending.text.length.toLocaleString()}자를 가져왔어요. 지금 작성 중인 내용을 바꿀 때 눌러 주세요.</p><button class="text-button" data-action="use-capture">선택한 대화로 바꾸기</button>` : '';
  $('#content').innerHTML = state.phase === 'result' ? resultView() : state.phase === 'review' ? reviewView() : inputView();
  $('#content').setAttribute('aria-busy', String(Boolean(state.busy)));
  if (state.busy) document.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = true; });
  else {
    const bookmark = typeof focus === 'string' ? { selector: focus } : focus;
    let target = typeof focus === 'string' ? $(focus) : changedPhase ? $('#content h1') : bookmark?.selector ? $(bookmark.selector) : null;
    if (!target && bookmark) { target = $('#content h1'); reveal = true; }
    if (target) {
      if (!target.matches('button,input,textarea,select,a')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      if (!changedPhase && Number.isInteger(bookmark?.start) && target.setSelectionRange) target.setSelectionRange(bookmark.start, bookmark.end);
      if (changedPhase || reveal) (target.id === 'draft' ? target.closest('.draft-section') : target).scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }
}
async function work(label, task, focusOnSuccess) {
  if (state.busy) return;
  const bookmark = focusBookmark();
  state.busy = label; state.error = ''; state.copied = false; render();
  try { await task(); }
  catch (error) { state.error = error.message; if (error.status === 409) state.error += ' 「새로고침」으로 최신 기록을 불러와 주세요.'; }
  finally { state.busy = ''; await persist(); render({ focus: state.error ? '#feedback' : focusOnSuccess || bookmark, reveal: !!state.error || !!focusOnSuccess }); }
}
async function checkConnection() {
  try {
    const config = await api.request('/api/config');
    state.connection = config.configured ? 'ready' : 'unconfigured'; state.model = config.model;
    if (!config.configured) state.error = '웹의 「AI 연결 설정」에서 API 키를 등록한 뒤 연결 확인을 눌러 주세요.';
  } catch (error) { state.connection = 'offline'; state.error = error.message; }
}
function acceptCapture(capture) {
  state.seenCapture = capture.id;
  Object.assign(state, { phase: 'input', raw: capture.text, source: [capture.pageTitle, capture.site].filter(Boolean).join(' · '),
    title: '고객센터 상담', company: '', messages: [], notes: [], recordId: null, recordVersion: null, record: null, draft: '', draftDirty: false, draftStale: false, selected: [], selectionInitialized: false, pending: null, error: '' });
}
async function receiveCapture(capture) {
  if (!capture || capture.id === state.seenCapture) return;
  if (capture.error) { state.seenCapture = capture.id; state.error = capture.error; }
  else if (!state.raw && !state.recordId && !state.messages.length && !state.busy) acceptCapture(capture);
  else state.pending = capture;
  await persist();
  if (!state.busy) render();
}
function setRecord(record) {
  const changed = record.id === state.recordId && state.recordVersion !== null && record.version !== state.recordVersion;
  const remaining = record.questions.filter(q => q.status !== 'answered').map(q => q.id);
  state.selected = state.selectionInitialized ? state.selected.filter(id => remaining.includes(id)) : remaining;
  if (record.questions.length) state.selectionInitialized = true;
  if (state.draftDirty) { if (changed) state.draftStale = true; }
  else { state.draft = record.drafts.followup?.body || ''; state.draftStale = false; }
  state.record = record; state.recordId = record.id; state.recordVersion = record.version; state.phase = 'result';
}

document.addEventListener('input', event => {
  const el = event.target;
  if (['raw', 'title', 'company', 'draft'].includes(el.id)) {
    state[el.id] = el.value;
    if (el.id === 'raw') $('#counter').textContent = `${el.value.length.toLocaleString()} / 30,000자`;
    if (el.id === 'draft') { state.draftDirty = true; state.copied = false; $('#copy-status').textContent = ''; $('[data-action="copy"]').disabled = !el.value.trim(); }
  }
  if (el.dataset.message !== undefined) state.messages[Number(el.dataset.message)][el.dataset.field] = el.value;
  saveSoon();
});
document.addEventListener('change', event => {
  if (event.target.name === 'question') {
    state.selected = [...document.querySelectorAll('[name="question"]:checked')].map(el => el.value);
    const button = $('[data-action="draft"]'); if (button) button.disabled = !state.selected.length || state.record.analyzedMessageCount < state.record.messages.length;
    saveSoon();
  }
});
document.addEventListener('submit', event => {
  event.preventDefault();
  if (state.busy) return;
  if (event.target.id === 'extract-form') void work('선택한 대화의 발화자와 원문을 읽고 있어요…', async () => {
    if (!state.raw.trim() || state.raw.length > MAX_SELECTION) throw new Error('상담 대화를 1~30,000자로 입력해 주세요.');
    const result = await api.request('/api/extract', 'POST', { text: state.raw });
    state.messages = result.messages; state.notes = result.notes; state.phase = 'review';
  });
  if (event.target.id === 'analyze-form') void work('질문별 답변과 처리 약속을 분석하고 있어요…', async () => {
    if (!state.messages.length || state.messages.some(m => !['customer', 'agent'].includes(m.role) || !m.text.trim())) throw new Error('모든 메시지의 발화자와 원문을 확인해 주세요.');
    if (!state.messages.some(m => m.role === 'customer')) throw new Error('내 질문이 포함되도록 발화자를 확인해 주세요.');
    const record = await api.request('/api/cases', 'POST', { title: state.title, company: state.company || '고객센터', messages: state.messages });
    setRecord(record); await persist();
    setRecord(await api.request(`/api/cases/${record.id}/analyze`, 'POST', { version: record.version }));
  });
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || state.busy || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'connect') return work('서버 연결을 확인하고 있어요…', checkConnection);
  if (action === 'capture') {
    const response = await chrome.runtime.sendMessage({ type: 'capture-selection', windowId }).catch(() => ({ error: '확장 프로그램을 다시 열어 주세요.' }));
    if (response?.error) { state.error = response.error; render(); } return;
  }
  if (action === 'dismiss-error') { state.error = ''; render(); return; }
  if (action === 'use-capture') acceptCapture(state.pending);
  if (action === 'back') state.phase = 'input';
  if (action === 'clear-date') state.messages[Number(button.dataset.index)].sentAt = null;
  if (action === 'remove-message') state.messages.splice(Number(button.dataset.index), 1);
  if (action === 'add-message' && state.messages.length < 60) state.messages.push({ role: 'unknown', text: '', sentAt: null });
  if (action === 'new') Object.assign(state, { phase: 'input', raw: '', title: '고객센터 상담', company: '', source: '', messages: [], notes: [], record: null, recordId: null, recordVersion: null, draft: '', draftDirty: false, draftStale: false, selected: [], selectionInitialized: false, error: '' });
  if (action === 'reload') return work('최신 상담 기록을 불러오고 있어요…', async () => {
    const record = await api.request(`/api/cases/${state.recordId}`);
    setRecord(record);
  });
  if (action === 'retry-analysis') return work('저장한 원문을 다시 분석하고 있어요…', async () => {
    const latest = await api.request(`/api/cases/${state.recordId}`); setRecord(latest);
    setRecord(await api.request(`/api/cases/${latest.id}/analyze`, 'POST', { version: latest.version }));
  });
  if (action === 'draft') return work('선택한 질문으로 재문의 초안을 작성하고 있어요…', async () => {
    const record = await api.request(`/api/cases/${state.recordId}/drafts`, 'POST', { version: state.record.version, kind: 'followup', questionIds: state.selected });
    state.record = record; state.recordVersion = record.version; state.draft = record.drafts.followup.body; state.draftDirty = false; state.draftStale = false;
  }, '#draft');
  if (action === 'copy') {
    try { await navigator.clipboard.writeText(state.draft); state.copied = true; $('#copy-status').textContent = '초안을 복사했어요.'; }
    catch { state.error = '복사하지 못했어요. 초안을 직접 선택해 복사해 주세요.'; render(); } return;
  }
  await persist(); render();
});

async function init() {
  render();
  try {
    windowId = (await chrome.windows.getCurrent()).id;
    workspaceKey = `workspace:${windowId}`; captureKey = `capture:${windowId}`;
    const stored = await chrome.storage.session.get([workspaceKey, captureKey]);
    if (stored[workspaceKey]) Object.assign(state, stored[workspaceKey]);
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes[captureKey]?.newValue) void receiveCapture(changes[captureKey].newValue); });
    await receiveCapture(stored[captureKey]);
    await checkConnection();
    if (state.recordId) {
      try {
        const record = await api.request(`/api/cases/${state.recordId}`);
        setRecord(record);
      }
      catch (error) { state.error = error.message; }
    }
  } catch { state.error = '확장 프로그램을 다시 열어 주세요. 브라우저 확장 페이지에서 실행해야 해요.'; }
  render();
}
void init();
