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

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
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
        if (Object.keys(h).length) learned.headers = h;

        const items = pickItems(body);
        for (const item of items) {
          const op = item?.operationName;
          // 대화 조회 요청 - 이 서식을 chat id만 바꿔 재사용합니다.
          if (op === "getChatConversations" && item.query) learned.messagesItem = item;
          // 채팅 목록 요청 - 안 읽은 방을 찾는 데 씁니다.
          if (item.query && /chats\s*\(/.test(item.query) && /unreadMessageCount/.test(item.query)) {
            learned.chatListItem = item;
          }
        }

        // 응답에서 채팅 목록을 갈무리해 둡니다. 토들 화면이 목록을 새로 받을 때마다 갱신됩니다.
        const json = await res.clone().json();
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
        /* 응답이 JSON이 아니거나 이미 읽힌 경우 - 무시 */
      }
    }

    return res;
  };

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
          trained: !!learned.messagesItem,
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
            out.push({ chatId: c.id, label: c.label, unread: c.unread, messages });
          } catch (err) {
            if (String(err.message) === "LOGIN_REQUIRED") throw err;
            // 한 방이 실패해도 나머지는 계속합니다.
          }
        }
        reply({ ok: true, chats: out, trained: !!learned.messagesItem, sawTraffic: !!learned.url });
        return;
      }
      reply({ ok: false, error: "unknown command" });
    } catch (err) {
      reply({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });
})();
