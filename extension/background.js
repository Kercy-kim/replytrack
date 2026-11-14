import { readSelection, selectionPayload } from './selection.js';

const menuId = 'replytrack-selection';
const captureKey = windowId => `capture:${windowId}`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({
    id: menuId, title: 'ReplyTrack으로 선택한 대화 가져오기', contexts: ['selection'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  }));
});

async function publish(windowId, payload) {
  await chrome.storage.session.set({ [captureKey(windowId)]: { ...payload, id: crypto.randomUUID() } });
}

async function capture(tab) {
  try {
    if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('일반 웹페이지에서 대화를 선택해 주세요. 브라우저 설정 페이지와 PDF 뷰어는 지원하지 않아요.');
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSelection });
    await publish(tab.windowId, selectionPayload(result.text, result.pageTitle, result.pageUrl));
    return { ok: true };
  } catch (error) {
    const message = /Cannot access|Missing host permission/.test(error.message)
      ? '이 페이지에서는 선택 영역을 읽을 수 없어요. 대화에서 우클릭 → ReplyTrack으로 가져오기 또는 직접 붙여넣기를 사용해 주세요.' : error.message;
    if (tab?.windowId !== undefined) await publish(tab.windowId, { error: message });
    return { ok: false, error: message };
  }
}

chrome.action.onClicked.addListener(tab => {
  // Call open synchronously in the user gesture, before storage or scripting awaits.
  const opened = chrome.sidePanel.open({ windowId: tab.windowId });
  void capture(tab);
  void opened.catch(() => publish(tab.windowId, { error: '옆 패널을 다시 열어 주세요.' }));
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== menuId || !tab) return;
  const opened = chrome.sidePanel.open({ windowId: tab.windowId });
  void (async () => {
    try { await publish(tab.windowId, selectionPayload(info.selectionText, tab.title, info.frameUrl || info.pageUrl)); }
    catch (error) { await publish(tab.windowId, { error: error.message }); }
  })();
  void opened.catch(() => publish(tab.windowId, { error: '옆 패널을 다시 열어 주세요.' }));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // No web page/content-script bridge, no externally_connectable, no arbitrary fetch proxy.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('sidepanel.html')) return;
  if (message.type !== 'capture-selection') return;
  void chrome.tabs.query({ active: true, windowId: message.windowId })
    .then(([tab]) => capture(tab)).then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: '현재 탭을 확인하지 못했어요. 대화를 복사해서 붙여넣어 주세요.' }));
  return true;
});
