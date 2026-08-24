// 토들 페이지 안에서 도는 부분입니다.
//
// ── 이 파일이 이렇게 생긴 이유 ────────────────────────────────────────────────
//
// 처음에는 토들이 주고받는 통신을 엿보다가 요청 서식을 "배워서" 흉내내는 방식이었습니다.
// 그 방식은 며칠 내내 실패했습니다. 이유는 이렇습니다:
//
//   - 토들은 채팅 목록을 한 번만 받아 캐시합니다. 화면을 아무리 눌러도 다시 요청하지 않아,
//     배울 기회가 사실상 "처음 들어올 때" 한 번뿐입니다. 그 순간을 놓치면 영영 못 배웁니다.
//   - 그렇다고 감시를 계속 다시 걸면, 토들이 우리 위에 덧씌운 것을 다시 원본으로 삼게 되어
//     우리 함수가 우리 함수를 부르는 고리가 생깁니다. 실제로 토들 전체가 멈췄습니다.
//
// 그래서 엿보기를 그만두고, 필요한 것을 직접 확인했습니다. 실제 화면에서 하나씩 확인한 결과:
//
//   - 인증은 **쿠키**로 됩니다. 토큰을 헤더에 넣지 않아도 됩니다.
//   - 필요한 헤더는 딱 둘입니다: content-type 과 x-tod-source: WEB (고정값).
//     x-tod-source 가 없으면 401, 있으면 200입니다. 나머지는 다 빼도 됩니다.
//   - 학교 번호는 localStorage 의 userInfo.org_id 에 있습니다.
//   - 우리에게 필요한 필드만 담은 짧은 질의를 직접 써도 그대로 답해줍니다.
//     토들의 원래 질의는 조각(fragment)이 얽혀 1,900자가 넘지만, 우리는 네 개 필드면 됩니다.
//
// 결과적으로 **엿볼 것도, 배울 것도 없습니다.** 로그인만 되어 있으면 바로 물어보면 됩니다.
// 훨씬 단순하고, 토들 화면이 바뀌어도 흔들리지 않습니다.
//
// 읽음 처리는 별도의 요청(insertUserChatActivityLog)이라, 이렇게 조회만 해서는 토들의
// '안 읽음' 표시가 사라지지 않습니다. 선생님들 업무를 건드리지 않는다는 뜻입니다.

(() => {
  const VERSION = "2.3.0";

  // 같은 버전이 이미 돌고 있으면 그대로 둡니다.
  //
  // 예전에는 버전을 따지지 않고 "설치된 적 있으면 무조건 그만"이었습니다. 그래서 새 코드가
  // 들어와도 낡은 코드가 계속 응답했고, 확장 버전만 올라가고 동작은 안 바뀌었습니다.
  // 이제 버전이 다르면 낡은 것을 걷어내고 새로 답니다.
  if (window.__giaCollectorVersion === VERSION) return;
  if (window.__giaCollectorHandler) {
    window.removeEventListener("message", window.__giaCollectorHandler);
  }
  window.__giaCollectorVersion = VERSION;

  const ENDPOINT = "https://ap-southeast-1-production-apis.toddleapp.com/graphql";
  const HEADERS = { "content-type": "application/json", "x-tod-source": "WEB" };

  // 한 번에 살펴볼 방 수. 너무 많으면 한 차례가 길어집니다.
  const MAX_ROOMS = 15;
  // 이보다 오래된 메시지는 보내지 않습니다. 수집기를 처음 켠 날 지난 몇 달치를 몰아
  // 보내면 인박스가 쓸모없어집니다.
  const MAX_AGE_DAYS = 3;

  const CHAT_LIST_QUERY = `query giaChatList($organizationId: ID!, $input: ChatFeedInput) {
  node(id: $organizationId, type: ORGANIZATION) {
    id
    ... on Organization {
      id
      chats(input: $input) {
        edges {
          node {
            id
            label
            unreadMessageCount
            lastActiveAt
            isArchived
          }
        }
      }
    }
  }
}`;

  const MESSAGES_QUERY = `query giaMessages($chatId: ID!) {
  node(id: $chatId, type: CHAT) {
    id
    ... on Chat {
      id
      messagesV2 {
        edges {
          node {
            id
            label
            type
            createdAt
            createdBy { id firstName lastName type }
          }
        }
      }
    }
  }
}`;

  /** 로그인한 사람 정보. 로그인되어 있으면 브라우저에 저장되어 있습니다. */
  function getUserInfo() {
    try {
      return JSON.parse(localStorage.getItem("userInfo") || "null");
    } catch {
      return null;
    }
  }

  function getOrgId() {
    const info = getUserInfo();
    return info && info.org_id ? String(info.org_id) : null;
  }

  /**
   * 어느 계정으로 보고 있는지.
   *
   * 토들의 '안 읽음'은 **계정마다 따로** 셉니다. 그 계정이 학부모 채팅방의 참여자가 아니면
   * 방이 아예 안 보이고, 참여자여도 이미 읽었으면 0개입니다. 둘은 전혀 다른 상황인데
   * 화면에는 똑같이 "0개"로 보여서, 원인을 짚으려면 계정을 알아야 합니다.
   */
  function whoAmI() {
    const info = getUserInfo();
    if (!info) return null;
    return info.email || [info.first_name, info.last_name].filter(Boolean).join(" ") || null;
  }

  async function gql(operationName, query, variables) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: HEADERS,
      credentials: "include",
      body: JSON.stringify([{ operationName, variables, extensions: {}, query }]),
    });
    // 401이면 로그인이 풀린 것입니다. 조용히 빈 값을 돌려주면 "새 메시지 없음"이라는
    // 거짓 안심을 주게 되므로, 분명히 알립니다.
    if (res.status === 401 || res.status === 403) throw new Error("LOGIN_REQUIRED");
    const json = await res.json();
    const one = Array.isArray(json) ? json[0] : json;
    if (one && one.errors && one.errors.length) {
      throw new Error("GRAPHQL: " + one.errors.map((e) => e.message).join(" | ").slice(0, 200));
    }
    return one;
  }

  /**
   * 방 목록.
   *
   * onlyUnread=false 로도 한 번 부르는 이유: "이 계정에 방이 아예 안 보이는 것"과 "방은
   * 보이는데 다 읽은 것"은 원인이 완전히 다른데, 둘 다 안 읽은 방 0개로 나옵니다.
   * 전체 방 수를 함께 알면 어느 쪽인지 바로 갈립니다.
   */
  async function fetchRoomList(onlyUnread) {
    const organizationId = getOrgId();
    if (!organizationId) throw new Error("LOGIN_REQUIRED");
    const input = onlyUnread ? { first: 50, isRead: false } : { first: 50 };
    const one = await gql("giaChatList", CHAT_LIST_QUERY, { organizationId, input });
    const edges = one?.data?.node?.chats?.edges;
    if (!Array.isArray(edges)) return [];
    return edges
      .map((e) => e?.node)
      .filter((n) => n && n.id && !n.isArchived)
      .map((n) => ({
        id: String(n.id),
        label: n.label ?? null,
        unread: Number(n.unreadMessageCount ?? 0),
        lastActiveAt: n.lastActiveAt ?? null,
      }));
  }

  /** 안 읽은 메시지가 있는 방들. */
  async function fetchRooms() {
    const all = await fetchRoomList(true);
    return all.filter((n) => n.unread > 0);
  }

  /**
   * 한 방의 새 메시지들.
   *
   * 토들이 돌려주는 isRead 는 이 계정 기준이라, 이 계정으로 한 번도 열지 않은 방은 과거
   * 메시지까지 전부 "안 읽음"으로 나옵니다(실제로 64개 전부 그랬습니다). 그래서 그 값을
   * 믿지 않고, 방의 안 읽은 개수만큼 **최신 것부터** 잘라 씁니다. 목록은 최신이 앞입니다.
   */
  /**
   * 이 방에 마지막으로 답글을 단 선생님.
   *
   * 요청: "혹시나 다른 직원이 답글을 달았다면 해결된 것으로 체크해줘"
   * 학부모 문의 뒤에 선생님 글이 있으면 누군가 이미 답한 것입니다. 그걸 모르고 또 답하면
   * 학부모는 같은 얘기를 두 번 듣게 됩니다.
   */
  function lastStaffReply(edges) {
    for (const e of edges) {
      const n = e?.node;
      if (!n) continue;
      if (String(n.type || "").toUpperCase() !== "NORMAL") continue;
      // 목록은 최신이 앞입니다. 학부모 글을 먼저 만나면 그 뒤로는 답글이 없는 것입니다.
      if (String(n.createdBy?.type || "").toUpperCase() !== "STAFF") return null;
      return {
        at: n.createdAt ?? null,
        by: [n.createdBy?.firstName, n.createdBy?.lastName].filter(Boolean).join(" ") || null,
        // 직원이 뭐라고 답했는지. 서버가 이 글을 보고 "해결됨/진행중"을 판단합니다(요청).
        text: typeof n.label === "string" ? n.label : "",
      };
    }
    return null;
  }

  async function fetchMessages(chatId, unread) {
    const one = await gql("giaMessages", MESSAGES_QUERY, { chatId });
    const edges = one?.data?.node?.messagesV2?.edges;
    if (!Array.isArray(edges)) return { messages: [], reply: null };
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const messages = edges
      .slice(0, Math.max(1, Math.min(unread, 20)))
      .map((e) => e?.node)
      .filter(Boolean)
      // 입퇴장 같은 시스템 알림은 문의가 아닙니다.
      .filter((m) => !m.type || String(m.type).toUpperCase() === "NORMAL")
      .filter((m) => !m.createdAt || new Date(m.createdAt).getTime() >= cutoff)
      .map((m) => ({
        id: String(m.id),
        text: typeof m.label === "string" ? m.label : "",
        createdAt: m.createdAt ?? null,
        // 여기까지 온 것은 모두 새 메시지입니다(위에서 이미 잘랐습니다).
        isRead: false,
        senderType: m.createdBy?.type ?? null,
        senderName: [m.createdBy?.firstName, m.createdBy?.lastName].filter(Boolean).join(" ") || null,
      }));
    return { messages, reply: lastStaffReply(edges) };
  }

  // ── 확장(content.js)과의 대화 ──────────────────────────────────────────────
  // 나중에 새 버전이 들어오면 이 함수를 걷어낼 수 있도록 창에 남겨둡니다.
  const onMessage = async (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.__gia !== "req") return;

    const reply = (payload) => window.postMessage({ __gia: "res", id: msg.id, payload }, "*");

    try {
      if (msg.cmd === "status") {
        reply({ ok: true, loggedIn: !!getOrgId(), account: whoAmI() });
        return;
      }

      if (msg.cmd === "collect") {
        const rooms = await fetchRooms();
        // 안 읽은 방이 없을 때만 전체를 세어봅니다(평소에는 쓸데없는 요청을 하지 않도록).
        const totalRooms = rooms.length === 0 ? (await fetchRoomList(false)).length : null;
        const targets = rooms.slice(0, MAX_ROOMS);
        const out = [];
        for (const room of targets) {
          try {
            const { messages, reply } = await fetchMessages(room.id, room.unread);
            // 원문으로 돌아가는 주소. 지금 보고 있는 화면 주소에서 학교 부분을 그대로 떼어
            // 씁니다 - 번호를 코드에 박아두면 다른 과정에서 안 맞습니다.
            const base = location.href.match(/^(https:\/\/[^/]+\/platform\/[^/]+)/);
            const url = base ? `${base[1]}/messaging/${room.id}` : null;
            out.push({
              chatId: room.id,
              label: room.label,
              unread: room.unread,
              lastActiveAt: room.lastActiveAt,
              url,
              messages,
              // 이 방에 이미 답글이 달렸는지. 서버가 해당 문의를 처리됨으로 표시합니다.
              reply,
            });
          } catch (err) {
            if (String(err.message) === "LOGIN_REQUIRED") throw err;
            // 한 방이 실패해도 나머지는 계속합니다.
          }
        }
        reply({
          ok: true,
          chats: out,
          diag: {
            knownRooms: rooms.length,
            unreadRooms: targets.length,
            totalRooms,
            account: whoAmI(),
            pageVersion: VERSION,
          },
        });
        return;
      }

      reply({ ok: false, error: "unknown command" });
    } catch (err) {
      reply({ ok: false, error: String(err?.message ?? err) });
    }
  };

  window.__giaCollectorHandler = onMessage;
  window.addEventListener("message", onMessage);
})();
