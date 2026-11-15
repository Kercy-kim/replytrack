import { renderPresentation } from './presentation-view.js';
const root = document.querySelector('#presentation'), status = document.querySelector('#presentation-status');
let data, step = 0;
function render(focus = false) { root.innerHTML = renderPresentation(data, step); if (focus) document.querySelector('#scene').focus({ preventScroll: true }); }
async function load() {
  try {
    const res = await fetch('/presentation-data.json');
    if (!res.ok) throw Error('load'); data = await res.json();
    if (data.schemaVersion !== 1 || !data.provenance?.synthetic) throw Error('format');
    render();
  } catch { data = null; root.innerHTML = '<h1>시연 결과를 불러오지 못했어요</h1><p>서버 연결을 확인한 뒤 다시 시도해 주세요.</p><button class="btn primary" data-action="retry">다시 불러오기</button> <a href="/">상담 화면으로</a>'; }
}
root.addEventListener('click', async e => {
  const target = e.target.closest('[data-action]'); if (!target || target.disabled) return;
  const action = target.dataset.action;
  if (action === 'retry') return load();
  if (action === 'copy') {
    const area = document.querySelector('#replay-draft');
    try { await navigator.clipboard.writeText(area.value); status.textContent = '영어 초안을 복사했어요.'; }
    catch { area.focus(); area.select(); status.textContent = '복사 권한이 없어요. 선택된 내용을 직접 복사해 주세요.'; }
    return;
  }
  step = action === 'start' ? 0 : action === 'step' ? Number(target.dataset.step) : step + (action === 'next' ? 1 : -1);
  step = Math.max(0, Math.min(3, step)); status.textContent = ''; render(true);
});
document.addEventListener('keydown', e => {
  if (!data || e.altKey || e.ctrlKey || e.metaKey || e.target.closest('textarea,input,button,a,summary')) return;
  if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); step = Math.max(0, Math.min(3, step + (e.key === 'ArrowRight' ? 1 : -1))); render(true); }
});
load();
