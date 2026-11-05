// GIA 구글챗 패널 - 배경 일꾼.
// 하는 일은 둘뿐입니다. ① 확장 아이콘을 누르면 사이드패널을 연다. ② 운영앱(bridge.js)이 «열어줘»를 보내면 그 탭의
// 사이드패널을 연다. 사이드패널은 사용자 동작(클릭) 뒤에만 열 수 있는데, 운영앱 손잡이 클릭에서 온 메시지라 통과합니다.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;
  if (msg.type === "ping") {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
  if (msg.type === "openChat") {
    const tab = sender.tab;
    (async () => {
      try {
        if (tab && tab.id != null) await chrome.sidePanel.open({ tabId: tab.id });
        else if (tab && tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
        else throw new Error("no tab");
        sendResponse({ ok: true });
      } catch (e) {
        // 못 열면 운영앱이 작은 창으로 엽니다. 이유는 돌려줘서 운영앱 화면에 보입니다.
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }
  return false;
});
