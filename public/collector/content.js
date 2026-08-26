// 페이지(inject.js)와 확장 배경(background.js) 사이를 잇는 다리입니다.
//
// 크롬은 보안을 위해 이 둘을 다른 공간에 둡니다. 페이지 쪽은 토들의 로그인 상태를 그대로 쓸 수
// 있지만 우리 서버로 요청을 보낼 수 없고, 배경 쪽은 그 반대입니다. 그래서 "페이지가 토들에서
// 읽고 → 다리가 넘기고 → 배경이 우리 서버로 보내는" 구조가 됩니다.

// 같은 버전이 이미 놓여 있을 때만 건너뜁니다.
//
// 예전에는 버전을 따지지 않아서, 확장을 새로고침해도 낡은 다리가 그대로 남아 있었습니다.
const BRIDGE_VERSION = "2.5.0";
if (window.__giaBridgeVersion !== BRIDGE_VERSION) {
  window.__giaBridgeVersion = BRIDGE_VERSION;
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

// ── 새 메시지가 오면 곧바로 알리기(어깨 두드리기) ───────────────────────────────
//
// 지금까지는 배경 일꾼이 1분마다 "새 거 있나요?"를 물었습니다. 그런데 **1분은 크롬이 허용하는
// 가장 짧은 주기**라(chrome.alarms의 하한) 그 아래로는 내릴 수가 없습니다.
//
// 담당자 확인: "미뤄지면 픽업인데 그 알림이 오기 전에 차에 태워버리는 경우 있어서."
// 1분 늦게 반영되면 아이가 이미 차에 타 있을 수 있습니다. 시계를 더 빨리 돌릴 수 없다면,
// **묻지 말고 알림을 받으면** 됩니다.
//
// 사무실 PC에는 토들 탭이 늘 열려 있습니다. 새 메시지가 오면 그 탭의 화면이 바뀌므로,
// 화면 변화를 지켜보다가 배경 일꾼의 어깨를 두드립니다. 1분 주기는 그대로 두어 안전망으로
// 남깁니다 - 화면 구조가 바뀌어 이 감지가 헛돌더라도 예전만큼은 동작합니다.
//
// 두 가지를 봅니다.
//   ① 탭 제목 - 토들은 안 읽은 개수를 제목에 "(3) ..." 처럼 씁니다. 가장 확실한 신호라
//      바뀌는 즉시 두드립니다.
//   ② 본문 - 제목이 안 바뀌는 경우(이미 안 읽음이 있던 방에 한 건 더 오는 등)를 위한 보조
//      신호입니다. 스크롤·애니메이션에도 반응하므로 조용해질 때까지 기다렸다가, 그리고
//      한동안 두드린 적이 없을 때만 두드립니다.
const QUIET_MS = 1200; // 화면이 이만큼 잠잠해지면 "다 그려졌다"고 봅니다
const BODY_COOLDOWN_MS = 20_000; // 본문 신호는 이 간격보다 자주 두드리지 않습니다

let lastNudgeAt = 0;
let quietTimer = null;

function nudge(reason, cooldownMs) {
  const now = Date.now();
  if (now - lastNudgeAt < cooldownMs) return;
  lastNudgeAt = now;
  // 배경 일꾼이 잠들어 있으면 이 메시지가 깨웁니다. 이미 수집 중이면 배경 쪽에서 무시합니다.
  try {
    chrome.runtime.sendMessage({ cmd: "nudge", reason }, () => void chrome.runtime.lastError);
  } catch {
    /* 확장이 새로고침되는 중이면 실패할 수 있습니다 - 1분 주기가 받아줍니다 */
  }
}

// ① 탭 제목
// 이 스크립트는 document_start에 돌기 때문에 <title>이 아직 없을 수 있습니다. 생길 때까지 기다립니다.
function watchTitle() {
  const el = document.querySelector("title");
  if (!el) return void setTimeout(watchTitle, 500);
  new MutationObserver(() => nudge("title", 3_000)).observe(el, { childList: true, characterData: true, subtree: true });
}
watchTitle();

// ② 본문
function watchBody() {
  if (!document.body) return void setTimeout(watchBody, 500);
  new MutationObserver(() => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => nudge("dom", BODY_COOLDOWN_MS), QUIET_MS);
  }).observe(document.body, { childList: true, subtree: true });
}
watchBody();
}
