// 토들 페이지 안에서 도는 부분입니다(MAIN world - 페이지와 같은 자바스크립트 공간).
//
// 하는 일은 두 가지뿐입니다.
//   ① 토들이 스스로 보내는 요청을 옆에서 지켜보며 "요청 서식"을 배웁니다.
//   ② 나중에 그 서식을 그대로 재사용해, 안 읽은 방의 메시지를 조회합니다.
//
// 왜 서식을 "배우게" 만들었나요?
//   토들의 질의문(GraphQL query)을 코드에 박아두면, 토들이 다음 업데이트에서 필드를 하나만
//   바꿔도 수집기가 멈춥니다. 대신 그때그때 토들이 실제로 보내는 요청을 복사해서 쓰면, 토들이
//   바뀌어도 같이 따라갑니다. 우리가 손대는 건 "어느 방을 볼지"(chat id) 하나뿐입니다.
//
// 읽음 처리는 절대 하지 않습니다.
//   토들에서 메시지를 읽음으로 바꾸는 것은 insertUserChatActivityLog 라는 별도 요청입니다.
//   우리는 조회(getChatConversations)만 흉내 내고 그 요청은 만들지 않습니다. 그래서 직원 화면의
//   '안 읽음' 표시가 그대로 남고, 답장이 필요한 진짜 문의는 예전처럼 사람이 처리합니다.

(() => {
  // 두 번 심겨도 한 번만 설치합니다.
  // 크롬은 확장 설치 전부터 열려 있던 탭에 코드를 넣지 않아서, 배경 일꾼이 나중에 직접
  // 심습니다(background.js의 injectInto). 그때 이미 설치된 탭에 또 심기면 fetch를 두 겹으로
  // 감싸고 같은 질문에 두 번 답하게 됩니다.
  if (window.__giaCollectorInstalled) return;
  window.__giaCollectorInstalled = true;

  const ENDPOINT_RE = /toddleapp\.com\/graphql/i;

  // 배운 것들. 새로고침하면 사라지지만, 화면을 열어두면 몇 초 안에 다시 배웁니다.
  const learned = {
    url: null,
    headers: null,
    /** 채팅 목록 요청 한 건(그대로 복사해 재사용) */
    chatListItem: null,
    /** 대화 조회 요청 한 건 */
    messagesItem: null,
  };
  /** 마지막으로 본 채팅 목록: id → { label, unread, lastActiveAt } */
  const chats = new Map();

  // 배운 서식을 확장에 맡겨 저장합니다.
  //
  // 왜 필요한가요?
  //   토들은 채팅 목록을 한 번 받아 캐시해두고, 화면을 아무리 눌러도 다시 요청하지 않습니다.
  //   즉 "Messages 화면에 처음 들어갈 때" 딱 한 번만 배울 기회가 있습니다. 그 순간을 놓치면
  //   (확장을 나중에 켰거나, 크롬이 탭을 재웠다 깨웠거나) 영영 못 배웁니다.
  //   그래서 한 번 배우면 확장에 저장해두고, 다음부터는 그걸 그대로 씁니다.
  let saveTimer = null;
  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    // 연달아 배울 때 매번 저장하지 않도록 잠깐 모아서 한 번만 보냅니다.
    saveTimer = setTimeout(() => {
      window.postMessage(
        {
          __gia: "save",
          data: {
            url: learned.url,
            headers: learned.headers,
            chatListItem: learned.chatListItem,
            messagesItem: learned.messagesItem,
          },
        },
        "*"
      );
    }, 1500);
  }

  // 확장이 저장해둔 서식을 돌려주면 복원합니다. 이미 배운 것이 있으면 덮어쓰지 않습니다
  // (지금 막 본 것이 더 최신입니다 - 특히 인증 헤더).
  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.data?.__gia !== "restore") return;
    const d = ev.data.data;
    if (!d) return;
    if (!learned.url && d.url) learned.url = d.url;
    if (!learned.headers && d.headers) learned.headers = d.headers;
    if (!learned.chatListItem && d.chatListItem) learned.chatListItem = d.chatListItem;
    if (!learned.messagesItem && d.messagesItem) learned.messagesItem = d.messagesItem;
  });

  // 페이지가 준비되면 저장된 서식을 달라고 청합니다.
  setTimeout(() => window.postMessage({ __gia: "load" }, "*"), 300);

  function pickItems(body) {
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  function headersToObject(h) {
    const out = {};
    try {
      if (!h) return out;
      if (typeof h.forEach === "function") h.forEach((v, k) => (out[k] = v));
      else if (Array.isArray(h)) h.forEach(([k, v]) => (out[k] = v));
      else Object.assign(out, h);
    } catch {
      /* 무시 */
    }
    return out;
  }

  // 원본은 여기서 딱 한 번만 붙잡고, 이후 절대 바꾸지 않습니다.
  //
  // v1.5.0에서 "지워졌으면 다시 씌운다"며 이 값을 갱신했다가, 토들이 우리 위에 덧씌운 것을
  // 다시 원본으로 삼는 바람에 우리 함수가 우리 함수를 부르는 고리가 생겼습니다. 토들의 모든
  // 통신이 막혀 "오프라인"이 되고 로그아웃도 안 되었습니다. 원본은 고정입니다.
  const originalFetch = window.fetch;
  const hookedFetch = async function (...args) {
    const req = args[0];
    const url = typeof req === "string" ? req : (req && req.url) || "";
    const init = args[1];

    let body = null;
    if (ENDPOINT_RE.test(url)) {
      try {
        if (init && init.body) body = init.body;
        else if (req && req.clone) body = await req.clone().text();
      } catch {
        /* 무시 */
      }
    }

    const res = await originalFetch.apply(this, args);

    if (ENDPOINT_RE.test(url) && body) {
      try {
        learned.url = url;
        const h = headersToObject(init?.headers ?? (req && req.headers));
        if (Object.keys(h).length) {
          // 인증 토큰이 바뀔 수 있어 최신 헤더로 계속 갱신합니다.
          const changed = JSON.stringify(h) !== JSON.stringify(learned.headers);
          learned.headers = h;
          if (changed && (learned.chatListItem || learned.messagesItem)) persist();
        }

        const items = pickItems(body);
        const json = await res.clone().json();
        const arr = Array.isArray(json) ? json : [json];

        // 어느 요청이 무엇을 돌려주는지는 "응답"을 보고 판단합니다.
        //
        // 처음에는 요청 본문의 이름(operationName)이나 질의문 글자를 보고 골랐는데, 토들이
        // 이름을 조금만 바꿔도 못 알아봅니다. 토들은 여러 요청을 배열로 묶어 한 번에 보내고
        // 응답도 같은 순서의 배열로 오므로, "몇 번째 응답에 채팅 목록이 들어 있나"를 보면
        // 그 자리의 요청이 곧 채팅 목록 요청입니다. 이름이 바뀌어도 계속 맞습니다.
        for (let i = 0; i < arr.length; i += 1) {
          const one = arr[i];
          const req = items[i];
          const edges = one?.data?.node?.chats?.edges;
          if (Array.isArray(edges) && edges.length > 0) {
            // 채팅 목록을 돌려주는 요청이 두 종류입니다.
            //   getChatAndChannelList - 방 이름·안 읽은 수가 들어 있는 진짜 목록
            //   getChatUnreadCount    - 안 읽은 "개수"만 세는 요청(이름이 없습니다)
            // 둘 다 data.node.chats 모양이라, 응답에 chats가 있다는 것만으로 고르면 나중에 오는
            // 개수 세기 요청이 진짜 목록을 덮어씁니다. 그래서 "방 이름이 들어 있는 응답"만
            // 목록으로 인정합니다. 이름으로 고르지 않으므로 토들이 요청 이름을 바꿔도 맞습니다.
            const hasLabels = edges.some((e) => typeof e?.node?.label === "string" && e.node.label);
            if (hasLabels && req?.query) {
            learned.chatListItem = req;
            persist();
          }

            for (const e of edges) {
              const n = e?.node;
              if (!n?.id) continue;
              const id = String(n.id);
              const prev = chats.get(id);
              chats.set(id, {
                // 개수 세기 응답에는 이름이 없으므로, 없으면 예전에 알아둔 이름을 지키고
                // 덮어쓰지 않습니다.
                label: n.label ?? prev?.label ?? null,
                unread: n.unreadMessageCount != null ? Number(n.unreadMessageCount) : (prev?.unread ?? 0),
                lastActiveAt: n.lastActiveAt ?? prev?.lastActiveAt ?? null,
              });
            }
          }
          // 대화 조회 요청 - 이 서식을 chat id만 바꿔 재사용합니다.
          if (one?.data?.node?.messagesV2 && req?.query) {
            learned.messagesItem = req;
            persist();
          }
        }
      } catch {
        /* 응답이 JSON이 아니거나 이미 읽힌 경우 - 무시 */
      }
    }

    return res;
  };

  window.fetch = hookedFetch;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 목록 서식을 아직 못 배웠을 때, 화면을 잠깐 왕복시켜 요청을 일으킵니다.
  //
  // 토들은 채팅 목록을 한 번 받아 캐시하므로, 가만히 두면 아무리 기다려도 요청이 다시 오지
  // 않습니다. 다른 화면에 갔다가 돌아오면 목록을 새로 받아옵니다(실측으로 확인했습니다).
  // 이 컴퓨터는 수집 전용이라 화면이 잠깐 바뀌어도 누구도 불편하지 않습니다.
  let retraining = false;
  let lastRetrainAt = 0;
  async function retrain() {
    if (retraining) return false;
    // 못 배우는 상태가 이어질 때 1분마다 화면이 왔다갔다 하면 곤란합니다.
    if (Date.now() - lastRetrainAt < 10 * 60 * 1000) return false;
    lastRetrainAt = Date.now();
    retraining = true;
    try {
      // 토들 왼쪽 메뉴는 <a>가 아니라 id가 붙은 <div>입니다(실제 화면에서 확인).
      //   #chat = Messages, #monitor = Overview
      const toMessaging = document.querySelector("#chat");
      const toElsewhere = document.querySelector("#monitor") ?? document.querySelector("#flagged");
      if (!toMessaging || !toElsewhere) return false;
      toElsewhere.click();
      await sleep(2500);
      toMessaging.click();
      await sleep(6000);
      return !!learned.chatListItem;
    } finally {
      retraining = false;
    }
  }

  // 배운 서식을 그대로 쓰되, 변수에서 chat id로 보이는 값만 바꿉니다.
  // 어느 변수가 chat id인지 이름으로 단정하지 않고 "값이 원래 chat id와 같은 칸"을 찾아 바꿉니다
  // - 토들이 변수 이름을 바꿔도 계속 동작합니다.
  function withChatId(item, chatId) {
    const clone = JSON.parse(JSON.stringify(item));
    const originalId = clone?.variables?.id;
    const swap = (obj) => {
      if (!obj || typeof obj !== "object") return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string" && originalId && v === String(originalId)) obj[k] = chatId;
        else if (v && typeof v === "object") swap(v);
      }
    };
    if (clone.variables) {
      if (clone.variables.id !== undefined) clone.variables.id = chatId;
      else swap(clone.variables);
      // 첫 페이지(가장 최근 메시지)만 봅니다. after를 지워야 처음부터 받습니다.
      if (clone.variables.input && typeof clone.variables.input === "object") {
        delete clone.variables.input.after;
        delete clone.variables.input.before;
        clone.variables.input.first = 15;
      }
    }
    return clone;
  }

  async function callGraphql(items) {
    if (!learned.url) throw new Error("아직 토들 통신을 보지 못했습니다.");
    const headers = Object.assign({ "content-type": "application/json" }, learned.headers || {});
    // 브라우저가 금지하는 헤더는 빼야 요청이 만들어집니다.
    for (const bad of ["content-length", "host", "connection"]) delete headers[bad];
    const res = await originalFetch(learned.url, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(items),
    });
    if (res.status === 401 || res.status === 403) throw new Error("LOGIN_REQUIRED");
    return res.json();
  }

  async function fetchMessages(chatId) {
    if (!learned.messagesItem) throw new Error("NEEDS_TRAINING");
    const json = await callGraphql([withChatId(learned.messagesItem, chatId)]);
    const arr = Array.isArray(json) ? json : [json];
    for (const one of arr) {
      const edges = one?.data?.node?.messagesV2?.edges;
      if (!Array.isArray(edges)) continue;
      return edges
        .map((e) => e?.node)
        .filter(Boolean)
        .map((m) => ({
          id: String(m.id),
          text: typeof m.label === "string" ? m.label : "",
          createdAt: m.createdAt ?? null,
          isRead: m.isRead === true,
          senderType: m.createdBy?.type ?? null,
          senderName: [m.createdBy?.firstName, m.createdBy?.lastName].filter(Boolean).join(" ") || null,
        }));
    }
    return [];
  }

  // 채팅 목록을 새로 받아옵니다(화면을 건드리지 않고). 실패하면 갈무리해 둔 목록을 씁니다.
  async function refreshChatList() {
    // 채팅 목록 요청도 못 배웠고 갈무리해 둔 목록도 없으면, 아직 아무것도 볼 수 없는 상태입니다.
    // 이때 빈 목록을 돌려주면 "새 메시지 없음"이라는 거짓 안심을 주게 됩니다 - 조용히 아무것도
    // 안 하면서 정상이라고 말하는 것이 이 시스템에서 가장 나쁜 실패입니다.
    if (!learned.chatListItem) await retrain();
    if (!learned.chatListItem && chats.size === 0) throw new Error("NEEDS_TRAINING");
    if (!learned.chatListItem) return [...chats.entries()].map(([id, v]) => ({ id, ...v }));
    try {
      const json = await callGraphql([JSON.parse(JSON.stringify(learned.chatListItem))]);
      const arr = Array.isArray(json) ? json : [json];
      for (const one of arr) {
        const edges = one?.data?.node?.chats?.edges;
        if (!Array.isArray(edges)) continue;
        for (const e of edges) {
          const n = e?.node;
          if (!n?.id) continue;
          chats.set(String(n.id), {
            label: n.label ?? null,
            unread: Number(n.unreadMessageCount ?? 0),
            lastActiveAt: n.lastActiveAt ?? null,
          });
        }
      }
    } catch {
      /* 갈무리해 둔 목록으로 대신합니다 */
    }
    return [...chats.entries()].map(([id, v]) => ({ id, ...v }));
  }

  // ── 확장(content.js)과의 대화 ──────────────────────────────────────────────
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.__gia !== "req") return;

    const reply = (payload) => window.postMessage({ __gia: "res", id: msg.id, payload }, "*");

    try {
      if (msg.cmd === "status") {
        reply({
          ok: true,
          sawTraffic: !!learned.url,
          hasChatList: !!learned.chatListItem,
          hasMessages: !!learned.messagesItem,
          chatCount: chats.size,
          unreadCount: [...chats.values()].filter((c) => c.unread > 0).length,
        });
        return;
      }
      if (msg.cmd === "collect") {
        const list = await refreshChatList();
        const targets = list.filter((c) => c.unread > 0).slice(0, 12);
        const out = [];
        for (const c of targets) {
          try {
            const messages = await fetchMessages(c.id);
            // 원문으로 돌아가는 주소. 지금 보고 있는 화면 주소에서 학교 부분을 그대로 떼어
            // 씁니다 - 학교 번호를 코드에 박아두면 다른 학교/과정에서 안 맞습니다.
            const base = location.href.match(/^(https:\/\/[^/]+\/platform\/[^/]+)\/messaging/);
            const url = base ? `${base[1]}/messaging/${c.id}` : null;
            out.push({ chatId: c.id, label: c.label, unread: c.unread, lastActiveAt: c.lastActiveAt, url, messages });
          } catch (err) {
            if (String(err.message) === "LOGIN_REQUIRED") throw err;
            // 한 방이 실패해도 나머지는 계속합니다.
          }
        }
        reply({
          ok: true,
          chats: out,
          diag: {
            hasChatList: !!learned.chatListItem,
            hasMessages: !!learned.messagesItem,
            knownRooms: list.length,
            unreadRooms: targets.length,
          },
        });
        return;
      }
      reply({ ok: false, error: "unknown command" });
    } catch (err) {
      reply({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
})();
