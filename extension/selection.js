export const MAX_SELECTION = 30000;

export function selectionPayload(text, pageTitle = '', pageUrl = '') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('대화를 먼저 드래그해 선택해 주세요. 채팅창 안의 대화는 우클릭 → ReplyTrack으로 가져오기도 사용할 수 있어요.');
  if (text.length > MAX_SELECTION) throw new Error('선택한 대화가 30,000자를 넘었어요. 필요한 상담 부분만 다시 선택해 주세요.');
  let site = '';
  try { const url = new URL(pageUrl); if (['http:', 'https:'].includes(url.protocol)) site = url.hostname; } catch { /* No source URL is required. */ }
  // Never retain query strings, fragments, or a full browsing URL.
  return { text: text.trim(), pageTitle: String(pageTitle).slice(0, 200), site };
}

// Self-contained: Chrome serializes this function into the user-invoked tab.
export function readSelection() {
  const element = document.activeElement;
  const isTextInput = element?.tagName === 'TEXTAREA' ||
    (element?.tagName === 'INPUT' && ['text', 'search', 'url', 'tel', 'email'].includes(element.type));
  const text = isTextInput && Number.isInteger(element.selectionStart)
    ? element.value.slice(element.selectionStart, element.selectionEnd)
    : window.getSelection()?.toString() || '';
  return { text, pageTitle: document.title, pageUrl: location.href };
}
