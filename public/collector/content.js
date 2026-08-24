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

// 페이지가 배운 서식을 확장 저장소에 넣고, 필요할 때 돌려줍니다.
window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const m = ev.data;
  if (m?.__gia === "save" && m.data) {
    chrome.runtime.sendMessage({ cmd: "saveLearned", data: m.data }).catch(() => {});
    return;
  }
  if (m?.__gia === "load") {
    chrome.runtime
      .sendMessage({ cmd: "loadLearned" })
      .then((d) => window.postMessage({ __gia: "restore", data: d ?? null }, "*"))
      .catch(() => {});
    return;
  }
});

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

// 기다리는 시간은 하는 일에 맞춰야 합니다.
//
// status는 값만 읽어오므로 곧바로 답이 옵니다. 답이 없으면 페이지가 죽은 것이니 짧게 끊습니다.
// collect는 다릅니다 - 화면을 왕복시켜 다시 배우는 데만 9초가 걸리고, 방 열두 개의 메시지를
// 받아오는 시간도 더해집니다. 여기에 같은 6초를 걸어두면 **일을 시작해놓고 끝나기 전에
// 포기**하게 됩니다. 실제로 그렇게 되고 있었습니다.
const TIMEOUT = { status: 6000, collect: 90000 };

function askPage(cmd) {
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    window.postMessage({ __gia: "req", id, cmd }, "*");
    setTimeout(() => {
      if (waiting.has(id)) {
        waiting.delete(id);
        resolve({ ok: false, error: "PAGE_TIMEOUT" });
      }
    }, TIMEOUT[cmd] ?? 6000);
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
