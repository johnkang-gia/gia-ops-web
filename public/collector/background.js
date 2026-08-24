// 확장의 배경 일꾼입니다. 1분마다 두 가지를 합니다.
//   ① 토들 탭에 "새로 온 메시지 있나?"를 묻고, 있으면 운영앱의 픽업 인박스로 보냅니다.
//   ② 살아있다는 신호(하트비트)를 운영앱에 남깁니다.
//
// ②가 왜 중요한가요?
//   수집기가 조용히 멈추는 것이 이 시스템의 가장 나쁜 실패입니다 - 멈춘 줄 모르면 그날 픽업을
//   통째로 놓칩니다. 신호가 10분 끊기면 픽업 인박스 화면 위에 빨간 경고가 뜹니다.
//   상태가 login_required면 "그 PC에서 토들에 다시 로그인하세요"라고 안내됩니다.

const ALARM = "gia-collect";
const PERIOD_MIN = 1;

async function getConfig() {
  const c = await chrome.storage.local.get(["serverUrl", "secret", "sent"]);
  return { serverUrl: (c.serverUrl || "").replace(/\/+$/, ""), secret: c.secret || "", sent: c.sent || {} };
}

async function post(path, secret, serverUrl, body) {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function heartbeat(status, detail) {
  const { serverUrl, secret } = await getConfig();
  if (!serverUrl || !secret) return;
  try {
    await post("/api/pickup/heartbeat", secret, serverUrl, { key: "toddle-collector", status, detail });
  } catch {
    /* 서버가 잠깐 안 될 수도 있습니다. 다음 회차에 다시 보냅니다. */
  }
}

async function setState(state) {
  await chrome.storage.local.set({ state: { ...state, at: new Date().toISOString() } });
}

// 새 버전이 올라왔는지 확인합니다.
//
// 확장을 손으로 설치했기 때문에 크롬이 알아서 갱신해주지 않습니다. 그렇다고 담당자가 매번
// "혹시 새 버전 있나?"를 물으러 올 수는 없으니, 수집기가 스스로 확인해 팝업에 알려줍니다.
// 실제 갱신은 폴더의 [업데이트] 파일을 더블클릭하면 됩니다.
async function checkUpdate(serverUrl) {
  try {
    const res = await fetch(`${serverUrl}/collector/files.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const latest = String(json.version ?? "");
    const mine = chrome.runtime.getManifest().version;
    return latest && latest !== mine ? latest : null;
  } catch {
    return null; // 확인 실패는 조용히 넘어갑니다 - 수집 자체에는 지장이 없습니다.
  }
}

// 토들 탭을 찾습니다. 여러 개 열려 있을 수 있으므로 전부 돌려주되, 메시지 화면을 먼저 씁니다
// (로그인 탭이나 다른 화면 탭을 골라 실패하는 일이 없도록).
async function findToddleTabs() {
  const tabs = await chrome.tabs.query({ url: "https://web.toddleapp.com/*" });
  return tabs.sort((a, b) => Number((b.url || "").includes("/messaging")) - Number((a.url || "").includes("/messaging")));
}

// 그 탭에 수집기 코드를 심습니다.
//
// 왜 필요한가요?
//   크롬은 확장을 설치해도 "이미 열려 있던 탭"에는 코드를 넣지 않습니다. 그래서 설치 직후에는
//   항상 "탭 응답 없음"이 납니다. 사람에게 새로고침을 시키는 대신, 우리가 직접 심어서 스스로
//   낫게 만듭니다. 토들 탭을 오래 열어두면 크롬이 탭을 잠재웠다가 깨우는 경우에도 같은 일이
//   생기는데, 그때도 이 길로 복구됩니다.
async function injectInto(tabId) {
  // 페이지 쪽(MAIN)과 확장 쪽(ISOLATED)을 각각 심습니다. 순서가 중요합니다 - 페이지 쪽이
  // 먼저 준비되어 있어야 다리(content.js)가 말을 걸 상대가 있습니다.
  await chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"], world: "ISOLATED" });
}

// 탭에 물어봅니다. 대답이 없으면 코드를 심고 한 번 더 물어봅니다.
//
// 대답이 없는 경우는 둘입니다.
//   ① 다리(content.js)조차 없어서 sendMessage 자체가 실패 - 확장 설치 전부터 열려 있던 탭
//   ② 다리는 있는데 페이지 쪽(inject.js)이 없어 시간초과(PAGE_TIMEOUT) - 둘 중 하나만 심긴 경우
// 둘 다 "심고 다시 물어보기"로 낫습니다.
async function askTab(tabId, cmd) {
  const send = () => chrome.tabs.sendMessage(tabId, { cmd });

  let first = null;
  try {
    first = await send();
  } catch {
    first = null;
  }
  if (first && !(first.ok === false && first.error === "PAGE_TIMEOUT")) return first;

  try {
    await injectInto(tabId);
  } catch {
    return null; // 심는 것조차 실패 - 이 탭은 포기하고 다음 탭으로
  }
  // 심은 직후에는 아직 준비 중일 수 있어 잠깐 기다립니다.
  await new Promise((r) => setTimeout(r, 800));
  try {
    const second = await send();
    return second && !(second.ok === false && second.error === "PAGE_TIMEOUT") ? second : null;
  } catch {
    return null;
  }
}

async function runOnce() {
  const { serverUrl, secret, sent } = await getConfig();
  if (!serverUrl || !secret) {
    await setState({ status: "설정 필요", detail: "확장 아이콘을 눌러 서버 주소와 키를 넣어주세요." });
    return;
  }

  // 새 버전 확인은 수집과 별개로 돌립니다(실패해도 수집은 계속되어야 합니다).
  const newVersion = await checkUpdate(serverUrl);
  await chrome.storage.local.set({ newVersion });

  const tabs = await findToddleTabs();
  if (tabs.length === 0) {
    await setState({ status: "토들 탭 없음", detail: "이 PC 크롬에 토들 메시지 화면을 열어두세요." });
    await heartbeat("error", "토들 탭이 열려 있지 않습니다.");
    return;
  }

  // 열려 있는 토들 탭을 차례로 시도합니다. 한 탭이 굳어 있어도 다른 탭으로 넘어갑니다.
  let reply = null;
  let tabId = null;
  for (const tab of tabs) {
    reply = await askTab(tab.id, "collect");
    if (reply) {
      tabId = tab.id;
      break;
    }
  }
  if (!reply) {
    await setState({
      status: "탭 응답 없음",
      detail: "토들 페이지에서 F5(새로고침)를 한 번 눌러주세요. 그래도 안 되면 크롬을 껐다 켜주세요.",
    });
    await heartbeat("error", "토들 탭이 응답하지 않습니다.");
    return;
  }

  if (!reply?.ok) {
    const err = String(reply?.error ?? "");
    if (err === "LOGIN_REQUIRED") {
      await setState({ status: "로그인 필요", detail: "이 PC 크롬에서 토들에 다시 로그인해주세요." });
      await heartbeat("login_required", "토들 로그인이 풀렸습니다.");
      return;
    }
    if (err === "NEEDS_TRAINING") {
      // 아직 서식을 못 배운 상태입니다.
      //
      // 수집기는 토들이 스스로 보내는 요청을 옆에서 보고 배웁니다. 그런데 확장이 나중에 끼어들면
      // (설치 직후, 또는 크롬이 탭을 재웠다 깨운 뒤) 페이지가 이미 보낸 요청을 못 봅니다. 화면을
      // 가만히 두면 그 요청이 다시 일어나지 않아 영원히 못 배웁니다.
      //
      // 그래서 두 번 연속 이 상태면 탭을 한 번 새로고침해 스스로 낫게 합니다. 매번 새로고침하면
      // 담당자가 토들을 보고 있을 때 방해가 되므로, 정말 막혔을 때만 합니다.
      const { trainFails = 0 } = await chrome.storage.local.get(["trainFails"]);
      const next = trainFails + 1;
      await chrome.storage.local.set({ trainFails: next });

      if (next >= 2) {
        await chrome.storage.local.set({ trainFails: 0 });
        try {
          await chrome.tabs.reload(tabId);
          await setState({ status: "준비 중", detail: "토들 페이지를 새로고침했습니다. 1분 뒤 자동으로 다시 확인합니다." });
          await heartbeat("error", "수집기 준비 중(자동 새로고침).");
          return;
        } catch {
          /* 새로고침 실패 - 아래 안내로 넘어갑니다 */
        }
      }
      await setState({ status: "준비 중", detail: "토들 페이지에서 F5를 한 번 눌러주세요. 곧 자동으로도 시도합니다." });
      await heartbeat("error", "수집기가 아직 준비되지 않았습니다.");
      return;
    }
    await setState({ status: "오류", detail: err || "알 수 없는 오류" });
    await heartbeat("error", err || "알 수 없는 오류");
    return;
  }

  // ── 아직 보내지 않은 메시지만 골라냅니다 ──────────────────────────────────
  const items = [];
  const nextSent = { ...sent };
  for (const chat of reply.chats ?? []) {
    for (const m of chat.messages ?? []) {
      if (!m.text || !m.text.trim()) continue;
      // 우리 직원이 쓴 글은 보내지 않습니다. 학부모가 보낸 것만 픽업 후보입니다.
      if (m.senderType && String(m.senderType).toUpperCase() === "STAFF") continue;
      // 이미 읽은 메시지는 예전 것이므로 건너뜁니다(수집기를 처음 켠 날 과거를 몰아 보내지 않도록).
      if (m.isRead) continue;
      if (nextSent[m.id]) continue;
      items.push({
        source: "토들",
        sourceRef: m.id,
        channelLabel: chat.label,
        senderName: m.senderName,
        text: m.text,
        // 언제 온 문의인지가 목록에서 중요합니다(요청: "시간이 나와 요일도나오고... 언제문의가
        // 온건지도 기록해줘"). 메시지 자체의 시각을 쓰고, 없으면 그 방의 마지막 활동 시각으로
        // 대신합니다. 둘 다 없으면 서버가 받은 시각을 씁니다.
        receivedAt: m.createdAt ?? chat.lastActiveAt ?? null,
        chatId: chat.chatId,
        // 문의 목록에서 눌러 원문으로 바로 갈 수 있게 주소를 함께 보냅니다.
        sourceUrl: chat.url ?? null,
      });
      nextSent[m.id] = Date.now();
    }
  }

  await chrome.storage.local.set({ trainFails: 0 });

  const diag = reply.diag ?? {};
  if (items.length === 0) {
    // 아는 방이 하나도 없으면 아직 목록을 못 읽고 있는 것입니다. 이걸 "정상"이라고 하면
    // 조용히 아무것도 안 하면서 괜찮다고 말하는 셈이 됩니다.
    if (!diag.knownRooms) {
      await setState({
        status: "목록 못 읽음",
        detail: `채팅목록서식 ${diag.hasChatList ? "있음" : "없음"} · 대화서식 ${diag.hasMessages ? "있음" : "없음"} · 토들 페이지에서 F5를 눌러주세요.`,
      });
      await heartbeat("error", "채팅 목록을 읽지 못했습니다.");
      return;
    }
    await setState({
      status: "정상",
      detail: `새 메시지 없음 (전체 ${diag.knownRooms}개 · 안 읽은 방 ${diag.unreadRooms ?? 0}개)`,
    });
    await heartbeat("ok", `새 메시지 없음 (안 읽은 방 ${diag.unreadRooms ?? 0}개)`);
    return;
  }

  try {
    // 서버가 한 번에 30건까지 받습니다.
    for (let i = 0; i < items.length; i += 25) {
      await post("/api/pickup/ingest", secret, serverUrl, { items: items.slice(i, i + 25) });
    }
    // 보낸 기록이 무한정 쌓이지 않게 최근 2000건만 남깁니다.
    const entries = Object.entries(nextSent).sort((a, b) => b[1] - a[1]).slice(0, 2000);
    await chrome.storage.local.set({ sent: Object.fromEntries(entries) });
    await setState({ status: "정상", detail: `${items.length}건 보냄 (안 읽은 방 ${diag.unreadRooms ?? 0}개)` });
  } catch (err) {
    await setState({ status: "전송 실패", detail: String(err.message ?? err) });
    await heartbeat("error", `전송 실패: ${String(err.message ?? err)}`);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) runOnce();
});
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  // 팝업에서 [지금 확인]을 누를 때
  if (msg?.cmd === "runNow") {
    runOnce().then(() => sendResponse({ ok: true }));
    return true;
  }
  // 페이지가 배운 서식을 저장합니다. 토들은 채팅 목록을 한 번만 받아 캐시하므로, 배울 기회를
  // 놓치면 영영 못 배웁니다. 저장해두면 다음 로드부터는 바로 씁니다.
  if (msg?.cmd === "saveLearned") {
    chrome.storage.local.set({ learned: msg.data, learnedAt: Date.now() }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.cmd === "loadLearned") {
    chrome.storage.local.get(["learned"]).then((c) => sendResponse(c.learned ?? null));
    return true;
  }
  return false;
});
