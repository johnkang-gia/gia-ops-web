// 지금 돌고 있는 확장의 버전.
//
// 이게 없어서 "고쳤는데 그대로다"를 여러 번 주고받았습니다. 업데이트 스크립트가 파일을
// 내려받아도 크롬 확장을 새로고침하지 않으면 예전 코드가 계속 돌고, 화면만 봐서는
// 어느 쪽인지 알 수가 없었습니다. 눈에 보이게 둡니다.
document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("ver");
  if (el) el.textContent = "v" + chrome.runtime.getManifest().version;
});

// 설정 화면 겸 상태판입니다. 담당자가 여기만 보면 "지금 잘 돌고 있는지"를 알 수 있어야 합니다.

const $ = (id) => document.getElementById(id);

async function load() {
  const c = await chrome.storage.local.get(["serverUrl", "secret", "state", "newVersion"]);
  $("serverUrl").value = c.serverUrl ?? "";
  $("secret").value = c.secret ?? "";
  render(c.state);
  renderUpdate(c.newVersion);
}

// 새 버전이 있으면 알려줍니다. 손으로 설치한 확장이라 크롬이 알아서 갱신해주지 않습니다.
function renderUpdate(newVersion) {
  const box = $("update");
  if (!newVersion) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.innerHTML =
    `<b>새 버전 ${newVersion}이 있습니다.</b><br>` +
    `수집기 폴더의 <b>업데이트</b> 파일을 더블클릭한 뒤, ` +
    `chrome://extensions 에서 이 확장의 🔄 를 눌러주세요.`;
}

function render(state) {
  const box = $("state");
  if (!state) {
    box.className = "box warn";
    box.textContent = "아직 한 번도 확인하지 않았습니다. [지금 확인]을 눌러보세요.";
    return;
  }
  const good = state.status === "정상";
  box.className = "box " + (good ? "ok" : state.status === "준비 중" ? "warn" : "bad");
  const at = state.at ? new Date(state.at).toLocaleTimeString("ko-KR") : "";
  box.innerHTML = `<b>${state.status}</b> · ${at}<br>${state.detail ?? ""}`;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    serverUrl: $("serverUrl").value.trim(),
    secret: $("secret").value.trim(),
  });
  $("save").textContent = "저장했습니다";
  setTimeout(() => ($("save").textContent = "저장"), 1500);
});

$("run").addEventListener("click", async () => {
  $("run").textContent = "확인 중...";
  await chrome.runtime.sendMessage({ cmd: "runNow" });
  const c = await chrome.storage.local.get(["state"]);
  render(c.state);
  $("run").textContent = "지금 확인";
});

// 화면을 열어둔 동안 상태가 바뀌면 바로 반영합니다.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.state) render(changes.state.newValue);
  if (changes.newVersion) renderUpdate(changes.newVersion.newValue);
});

load();
