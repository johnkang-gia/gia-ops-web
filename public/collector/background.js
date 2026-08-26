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

// 수집 한 번이 1분을 넘을 수 있습니다(다시 배우는 데만 9초, 방마다 메시지 받아오는 시간이
// 더해집니다). 알람은 1분마다 울리므로, 앞의 수집이 아직 도는 중이면 이번 차례는 거릅니다.
// 겹쳐 돌면 같은 메시지를 두 번 보내고 화면도 두 번 왕복합니다.
let running = false;
// 마지막으로 '로그인 필요'를 만나 탭을 새로고침해 본 시각. 매 분 새로고침하지 않도록 쿨다운.
let lastLoginReload = 0;

async function runOnce() {
  if (running) return;
  running = true;
  try {
    await runOnceInner();
  } finally {
    running = false;
  }
}

async function runOnceInner() {
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
      // 실제로 로그인이 풀린 경우도 있지만, 크롬이 밤새 탭을 잠재웠다 깨울 때 로그인 정보를
      // 잠깐 못 읽어 생기는 '가짜 로그인 필요'도 많습니다(요청: "로그인이 되어있는데 로그인
      // 필요라고"). 그래서 8분에 한 번, 토들 탭을 새로고침하고 한 번 더 시도해 스스로 낫게
      // 합니다. 그래도 안 되면 진짜로 로그인이 풀린 것이라 안내를 띄웁니다.
      const now = Date.now();
      if (tabId != null && now - lastLoginReload > 8 * 60 * 1000) {
        lastLoginReload = now;
        try {
          await chrome.tabs.reload(tabId);
        } catch {}
        await new Promise((r) => setTimeout(r, 6000));
        const retry = await askTab(tabId, "collect");
        if (retry && retry.ok) {
          reply = retry; // 새로고침으로 복구됨 - 아래에서 정상 처리로 이어집니다.
        } else {
          await setState({
            status: "로그인 필요",
            detail: "화면은 로그인돼 보여도 토들 접속이 만료됐을 수 있습니다. 토들 탭에서 새로고침(F5) 후 로그인 화면이 뜨면 다시 로그인해주세요.",
          });
          await heartbeat("login_required", "토들 로그인이 풀렸습니다(자동 복구 실패).");
          return;
        }
      } else {
        await setState({
          status: "로그인 필요",
          detail: "화면은 로그인돼 보여도 토들 접속이 만료됐을 수 있습니다. 토들 탭에서 새로고침(F5) 후 로그인 화면이 뜨면 다시 로그인해주세요.",
        });
        await heartbeat("login_required", "토들 로그인이 풀렸습니다.");
        return;
      }
    } else {
      await setState({ status: "오류", detail: err || "알 수 없는 오류" });
      await heartbeat("error", err || "알 수 없는 오류");
      return;
    }
  }

  // ── 아직 보내지 않은 메시지만 골라냅니다 ──────────────────────────────────
  const items = [];
  const nextSent = { ...sent };
  // 왜 안 보냈는지를 세어 둡니다. "0건"만 보여주면 정상인지 막힌 건지 알 수가 없어서,
  // 이걸 알아내려고 여러 번 헛짚었습니다.
  const skipped = { 빈글: 0, 직원: 0, 읽음: 0, 이미보냄: 0, 방없음: 0 };
  for (const chat of reply.chats ?? []) {
    if (!chat.messages || chat.messages.length === 0) skipped.방없음 += 1;
    for (const m of chat.messages ?? []) {
      if (!m.text || !m.text.trim()) {
        skipped.빈글 += 1;
        continue;
      }
      // 우리 직원이 쓴 글은 보내지 않습니다. 학부모가 보낸 것만 픽업 후보입니다.
      if (m.senderType && String(m.senderType).toUpperCase() === "STAFF") {
        skipped.직원 += 1;
        continue;
      }
      // 이미 읽은 메시지는 예전 것이므로 건너뜁니다(수집기를 처음 켠 날 과거를 몰아 보내지 않도록).
      if (m.isRead) {
        skipped.읽음 += 1;
        continue;
      }
      if (nextSent[m.id]) {
        skipped.이미보냄 += 1;
        continue;
      }
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


  // 이제는 목록을 못 읽으면 오류로 올라옵니다(로그인 풀림 등). 여기까지 왔는데 0개면
  // 정말로 새 학부모 메시지가 없는 것입니다.
  // 이미 답글이 달린 방들. 서버가 그 방의 미처리 문의를 처리됨으로 바꿉니다.
  // 다른 선생님이 벌써 답했는데 인박스에 남아 있으면, 또 답하거나 계속 신경 쓰게 됩니다.
  // 보낼 새 메시지가 하나도 없어도 이 소식은 전해야 하므로 여기서 먼저 처리합니다.
  const replies = (reply.chats ?? [])
    .filter((c) => c.reply && c.chatId)
    .map((c) => ({ chatId: c.chatId, at: c.reply.at, by: c.reply.by, text: c.reply.text ?? "" }));
  if (replies.length > 0) {
    try {
      await post("/api/pickup/ingest", secret, serverUrl, { items: [], replies });
    } catch {
      /* 답글 표시가 늦어지는 것은 큰 문제가 아닙니다 - 다음 회차에 다시 보냅니다 */
    }
  }

  const diag = reply.diag ?? {};
  // 페이지 쪽 코드가 몇 버전인지 함께 적습니다. 확장 카드의 버전과 다르면 낡은 코드가
  // 아직 돌고 있다는 뜻이고, 그걸 화면에서 바로 알 수 있어야 합니다.
  const who = [diag.pageVersion ? `p${diag.pageVersion}` : null, diag.account].filter(Boolean).join(" · ");
  const suffix = who ? ` · ${who}` : "";

  if (items.length === 0) {
    // 0개일 때는 "왜 0개인지"까지 적어야 합니다.
    //
    // 토들의 '안 읽음'은 계정마다 따로 셉니다. 그래서 0개에는 서로 다른 세 가지가 섞여 있고,
    // 그냥 "정상"이라고만 하면 어느 쪽인지 알 수 없어 원격에서 짐작만 하게 됩니다.
    //   ① 방이 아예 안 보임 → 이 계정이 학부모 채팅방의 참여자가 아닙니다.
    //   ② 방은 보이는데 다 읽음 → 진짜 정상입니다.
    if (diag.totalRooms === 0) {
      await setState({
        status: "계정 확인 필요",
        detail: `이 계정에는 채팅방이 하나도 보이지 않습니다${suffix}. 학부모 채널에 참여한 계정으로 로그인해주세요.`,
      });
      await heartbeat("error", `채팅방이 보이지 않는 계정입니다${suffix}`);
      return;
    }
    const total = diag.totalRooms != null ? ` / 전체 ${diag.totalRooms}개` : "";
    // 무엇을 걸렀는지 적습니다. 방은 있는데 보낼 게 없다면 그 이유가 보여야 합니다.
    const reasons = Object.entries(skipped)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
    const why = reasons ? ` · 거른 것: ${reasons}` : "";
    await setState({
      status: "정상",
      detail: `새 메시지 없음 (안 읽은 방 ${diag.knownRooms ?? 0}개${total})${why}${suffix}`,
    });
    await heartbeat("ok", `새 메시지 없음 (안 읽은 방 ${diag.knownRooms ?? 0}개)`);
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
    await setState({ status: "정상", detail: `${items.length}건 보냄 (안 읽은 방 ${diag.knownRooms ?? 0}개)${suffix}` });
  } catch (err) {
    await setState({ status: "전송 실패", detail: String(err.message ?? err) });
    await heartbeat("error", `전송 실패: ${String(err.message ?? err)}`);
  }
}

// 확장을 새로고침해도 이미 열려 있는 토들 탭 안에서는 **예전 코드가 그대로 돕니다.**
//
// 크롬이 새 코드를 그 탭에 다시 넣어주긴 하는데, 페이지에는 이전 스크립트가 이미 자리를
// 잡고 있어서 "이미 설치됨" 표시에 걸려 새 코드가 곧장 빠져나갑니다. 그래서 확장 카드에는
// 새 버전이 찍히는데 동작은 하나도 안 바뀌는, 아주 헷갈리는 상태가 됩니다.
// (실제로 이것 때문에 "고쳤는데 그대로다"를 여러 번 주고받았습니다.)
//
// 사람에게 F5를 눌러달라고 부탁하는 대신, 확장이 새로 올라오면 알아서 새로고침합니다.
async function reloadToddleTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://web.toddleapp.com/*" });
    for (const t of tabs) {
      if (t.id != null) await chrome.tabs.reload(t.id);
    }
  } catch {
    /* 탭이 없거나 권한이 없으면 그냥 넘어갑니다 */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
  reloadToddleTabs();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) runOnce();
});
// 토들 탭이 "화면이 바뀌었어요"라고 두드릴 때(content.js) 곧바로 확인합니다.
//
// 1분 주기는 크롬이 허용하는 하한이라 더 줄일 수 없습니다. 대신 새 메시지가 오는 그 순간
// 탭이 알려주면 기다릴 이유가 없습니다 - 픽업 연락이 1분 늦으면 아이가 이미 차에 타 있을 수
// 있습니다. 1분 주기는 안전망으로 그대로 둡니다.
//
// 근무시간 밖에는 두드려도 무시합니다. 밤에 누가 토들 탭을 스크롤하는 것만으로 수집이
// 도는 일을 막습니다(서버의 크론 시간대와 같은 기준: 평일 07~19시).
function isWorkHours() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const day = p.find((x) => x.type === "weekday")?.value;
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? "0");
  if (day === "Sat" || day === "Sun") return false;
  return hour >= 7 && hour < 19;
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.cmd === "nudge") {
    // running 이면 runOnce가 알아서 그냥 돌아섭니다 - 겹쳐 도는 일은 없습니다.
    if (isWorkHours()) runOnce();
    sendResponse({ ok: true });
    return false;
  }
  // 팝업에서 [지금 확인]을 누를 때
  if (msg?.cmd === "runNow") {
    runOnce().then(() => sendResponse({ ok: true }));
    return true;
  }
  // 보낸 기록 지우기. 서버 쪽에서 지웠는데 수집기가 "이미 보냈다"고 기억해 다시 안 보낼 때 씁니다.
  if (msg?.cmd === "clearSent") {
    chrome.storage.local.set({ sent: {} }).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
