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

async function findToddleTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.toddleapp.com/*" });
  return tabs[0] ?? null;
}

async function runOnce() {
  const { serverUrl, secret, sent } = await getConfig();
  if (!serverUrl || !secret) {
    await setState({ status: "설정 필요", detail: "확장 아이콘을 눌러 서버 주소와 키를 넣어주세요." });
    return;
  }

  const tab = await findToddleTab();
  if (!tab) {
    await setState({ status: "토들 탭 없음", detail: "이 PC 크롬에 토들 메시지 화면을 열어두세요." });
    await heartbeat("error", "토들 탭이 열려 있지 않습니다.");
    return;
  }

  let reply;
  try {
    reply = await chrome.tabs.sendMessage(tab.id, { cmd: "collect" });
  } catch {
    await setState({ status: "탭 응답 없음", detail: "토들 페이지를 새로고침해주세요." });
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
      // 아직 대화 조회 서식을 못 배운 상태입니다. 사람이 채팅방을 한 번 열면 배웁니다.
      await setState({ status: "준비 중", detail: "토들에서 채팅방을 하나만 열어주세요(한 번이면 됩니다)." });
      await heartbeat("error", "수집기가 아직 준비되지 않았습니다(채팅방 1회 열기 필요).");
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
        receivedAt: m.createdAt,
      });
      nextSent[m.id] = Date.now();
    }
  }

  if (items.length === 0) {
    await setState({ status: "정상", detail: `새 메시지 없음 (안 읽은 방 ${(reply.chats ?? []).length}개)` });
    await heartbeat("ok", "새 메시지 없음");
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
    await setState({ status: "정상", detail: `${items.length}건 보냄` });
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
// 팝업에서 [지금 확인]을 누를 때도 같은 일을 합니다.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.cmd === "runNow") {
    runOnce().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
