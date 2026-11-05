// 운영앱 ↔ 확장 다리. 운영앱 화면에 «확장이 깔려 있다»는 표시를 남기고, 손잡이가 보내는 {gia:"openChat"} 을
// 배경 일꾼에게 전합니다. 열렸으면 {gia:"chatOpened"} 로, 못 열었으면 {gia:"chatFailed", error} 로 답합니다.
(function () {
  const version = chrome.runtime.getManifest().version;
  document.documentElement.setAttribute("data-gia-chat-panel", version);
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.gia !== "openChat") return;
    try {
      chrome.runtime.sendMessage({ type: "openChat" }, (res) => {
        if (chrome.runtime.lastError) {
          window.postMessage({ gia: "chatFailed", error: chrome.runtime.lastError.message }, window.location.origin);
          return;
        }
        if (res && res.ok) window.postMessage({ gia: "chatOpened" }, window.location.origin);
        else window.postMessage({ gia: "chatFailed", error: (res && res.error) || "unknown" }, window.location.origin);
      });
    } catch (err) {
      // 확장이 지워지거나 갱신된 직후에는 다리가 끊깁니다 - 화면을 새로고침하면 다시 붙습니다.
      window.postMessage({ gia: "chatFailed", error: String(err) }, window.location.origin);
    }
  });
})();
