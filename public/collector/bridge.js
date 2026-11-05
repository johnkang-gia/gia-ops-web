// 운영앱 ↔ 확장 다리. 운영앱의 「💬 구글챗」 손잡이가 window.postMessage({gia:"openChat"}) 를 보내면
// 배경 일꾼에게 «사이드패널 열어줘»를 전하고, 열렸으면 {gia:"chatOpened"} 로 답합니다.
// 답이 없으면 운영앱은 확장이 없는 것으로 보고 작은 창으로 엽니다.
window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.gia !== "openChat") return;
  try {
    chrome.runtime.sendMessage({ type: "openChat" }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.ok) window.postMessage({ gia: "chatOpened" }, window.location.origin);
    });
  } catch {
    /* 확장이 꺼져 있으면 운영앱이 창으로 엽니다 */
  }
});
