// 페이지(inject.js)와 확장 배경(background.js) 사이를 잇는 다리입니다.
//
// 크롬은 보안을 위해 이 둘을 다른 공간에 둡니다. 페이지 쪽은 토들의 로그인 상태를 그대로 쓸 수
// 있지만 우리 서버로 요청을 보낼 수 없고, 배경 쪽은 그 반대입니다. 그래서 "페이지가 토들에서
// 읽고 → 다리가 넘기고 → 배경이 우리 서버로 보내는" 구조가 됩니다.

// 두 번 심겨도 한 번만 설치합니다(background.js의 injectInto가 다시 심을 수 있습니다).
if (window.__giaBridgeInstalled) {
  // 이미 다리가 놓여 있으면 아무것도 하지 않습니다.
} else {
  window.__giaBridgeInstalled = true;
  install();
}

function install() {
let seq = 0;
const waiting = new Map();

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const msg = ev.data;
  if (!msg || msg.__gia !== "res") return;
  const resolve = waiting.get(msg.id);
  if (resolve) {
    waiting.delete(msg.id);
    resolve(msg.payload);
  }
});

function askPage(cmd) {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    window.postMessage({ __gia: "req", id, cmd }, "*");
    // 페이지가 아직 준비되지 않았을 수 있으니 오래 기다리지 않습니다.
    setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        resolve({ ok: false, error: "PAGE_TIMEOUT" });
      }
    }, 6000);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.cmd === "collect" || msg?.cmd === "status") {
    askPage(msg.cmd).then(sendResponse);
    return true; // 비동기 응답
  }
  return false;
});
}
