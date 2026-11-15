export function officialPanel(result, esc) {
  if (result?.state !== 'ready') return '';
  return `<details class="official-context"><summary>관련 공식 안내 ${result.items.length}건</summary><p class="subtle">문의 내용과 공식 자료를 대조한 참고 안내예요. 개별 처리 결과는 문의 답변과 직접 확인해 주세요.</p>${result.items.map(i => `<div class="official-item"><p>${esc(i.text)}</p><blockquote>${esc(i.quote)}</blockquote><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)} · 공식 출처 보기</a><small>조회 ${esc(i.checkedAt.slice(0,10))}</small></div>`).join('')}</details>`;
}

// Independent from the main operation. Update only this region, never replace an edited draft.
export function createOfficialLoader({ api, current, display }) {
  const requests = new Map();
  return function load(c) {
    const stamp = JSON.stringify([c.id, c.company, c.title, c.messages]);
    if (c.mode !== 'live' || !c.analysis || c.analyzedMessageCount !== c.messages.length) { display(null); return; }
    const matches = () => { const now = current(); return now && JSON.stringify([now.id, now.company, now.title, now.messages]) === stamp; };
    if (requests.has(stamp)) { display(requests.get(stamp)); return; }
    requests.set(stamp, null); display(null);
    if (requests.size > 100) requests.delete(requests.keys().next().value);
    (async () => {
      try {
        let result = await api(`/api/cases/${c.id}/official-context`, 'POST', {});
        const deadline = Date.now() + 65000;
        while (result.state === 'loading' && matches() && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          result = await api(`/api/cases/${c.id}/official-context`);
        }
        if (result.state === 'loading') requests.delete(stamp);
        else requests.set(stamp, result.state === 'ready' ? result : null);
        if (matches()) display(requests.get(stamp));
      } catch { requests.set(stamp, null); if (matches()) display(null); }
    })();
  };
}
