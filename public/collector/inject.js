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
  const VERSION = "2.6.0";

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

  // 한 차례에 메시지를 받아 볼 방 수. 남은 방은 다음 차례(1분 뒤)에 이어 봅니다.
  const MAX_ROOMS = 30;

  /**
   * 오늘 한국시간 0시(밀리초).
   *
   * 예전 기준은 「안 읽은 방의 안 읽은 메시지」였습니다. 직원이 토들에서 먼저 열어 보면 그 메시지는
   * 앱에 영영 안 들어왔고, 수집기가 꺼져 있던 시간의 메시지도 마찬가지였습니다. 읽음은 사람이
   * 화면을 연 기록이지 메시지가 온 기록이 아니라서, 기준을 **날짜**로 바꿨습니다.
   * PC 시계의 시간대와 상관없이 한국 날짜를 씁니다.
   */
  function kstMidnightMs() {
    const KST = 9 * 60 * 60 * 1000;
    const day = Math.floor((Date.now() + KST) / 86400000);
    return day * 86400000 - KST;
  }

  // 방마다 마지막으로 다 읽어 본 활동 시각. 같으면 그 방은 새 글이 없으니 다시 묻지 않습니다.
  // 탭이 새로고침되면 비워지고, 그때는 오늘 방을 처음부터 다시 훑습니다(서버가 중복을 거릅니다).
  const seenActive = new Map();
  // 방마다 오늘 학부모가 쓴 글 수. 합계를 앱에 들어온 수와 견줘 빠진 것이 없는지 봅니다.
  const todayCountByRoom = new Map();
  let seenDay = 0;

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
    const base = onlyUnread ? { isRead: false } : {};
    // 하루에 활동하는 방이 50개를 넘을 수 있어 100개씩 받습니다. 토들이 거절하면 50개로 물립니다.
    let one;
    try {
      one = await gql("giaChatList", CHAT_LIST_QUERY, { organizationId, input: { ...base, first: 100 } });
    } catch (err) {
      if (String(err.message) === "LOGIN_REQUIRED") throw err;
      one = await gql("giaChatList", CHAT_LIST_QUERY, { organizationId, input: { ...base, first: 50 } });
    }
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

  /** 오늘(한국시간) 활동이 있는 방들. 읽었는지는 따지지 않습니다. */
  async function fetchTodayRooms() {
    const all = await fetchRoomList(false);
    const since = kstMidnightMs();
    const today = all.filter((n) => n.lastActiveAt && new Date(n.lastActiveAt).getTime() >= since);
    return { all, today };
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

  const isStaff = (n) => String(n?.createdBy?.type || "").toUpperCase() === "STAFF";
  const nameOf = (n) => [n?.createdBy?.firstName, n?.createdBy?.lastName].filter(Boolean).join(" ") || null;

  /**
   * 한 방에서 오늘 0시(한국시간) 이후의 글.
   *
   * 학부모 글마다 **그 뒤에 처음 달린 직원 글**을 붙입니다. 그 글이 있으면 서버가 그 문의를
   * 「답함」으로 표시합니다. 답한 것과 일을 끝낸 것은 다르므로 「처리 완료」는 건드리지 않습니다.
   */
  async function fetchTodayMessages(chatId) {
    const one = await gql("giaMessages", MESSAGES_QUERY, { chatId });
    const edges = one?.data?.node?.messagesV2?.edges;
    if (!Array.isArray(edges)) return { messages: [], reply: null, truncated: false };
    const since = kstMidnightMs();
    const all = edges
      .map((e) => e?.node)
      .filter(Boolean)
      // 입퇴장 같은 시스템 알림은 문의가 아닙니다.
      .filter((m) => !m.type || String(m.type).toUpperCase() === "NORMAL")
      .filter((m) => m.createdAt && new Date(m.createdAt).getTime() >= since)
      .sort((x, y) => new Date(x.createdAt).getTime() - new Date(y.createdAt).getTime());
    const messages = [];
    for (let i = 0; i < all.length; i++) {
      const m = all[i];
      if (isStaff(m)) continue;
      const answer = all.slice(i + 1).find(isStaff) || null;
      messages.push({
        id: String(m.id),
        text: typeof m.label === "string" ? m.label : "",
        createdAt: m.createdAt,
        isRead: false,
        senderType: m.createdBy?.type ?? null,
        senderName: nameOf(m),
        staffReply: answer ? { at: answer.createdAt, by: nameOf(answer) } : null,
      });
    }
    // 토들이 한 번에 돌려준 글이 전부 오늘 것이면, 더 앞의 오늘 글이 잘렸을 수 있습니다.
    const oldest = edges.map((e) => e?.node?.createdAt).filter(Boolean).map((t) => new Date(t).getTime());
    const truncated = oldest.length > 0 && Math.min(...oldest) >= since;
    return { messages, reply: lastStaffReply(edges), truncated };
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
        const since = kstMidnightMs();
        if (seenDay !== since) {
          seenActive.clear();
          todayCountByRoom.clear();
          seenDay = since;
        }
        const { all, today } = await fetchTodayRooms();
        // 마지막으로 본 뒤 활동이 바뀐 방만 다시 묻습니다.
        const changed = today.filter((r) => seenActive.get(r.id) !== r.lastActiveAt);
        const targets = changed.slice(0, MAX_ROOMS);
        const out = [];
        let truncatedRooms = 0;
        for (const room of targets) {
          try {
            const { messages, reply, truncated } = await fetchTodayMessages(room.id);
            if (truncated) truncatedRooms += 1;
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
              reply,
            });
            seenActive.set(room.id, room.lastActiveAt);
            todayCountByRoom.set(room.id, messages.filter((m) => m.text && m.text.trim()).length);
          } catch (err) {
            if (String(err.message) === "LOGIN_REQUIRED") throw err;
            // 한 방이 실패해도 나머지는 계속합니다. 본 것으로 표시하지 않아 다음 차례에 다시 봅니다.
          }
        }
        reply({
          ok: true,
          chats: out,
          diag: {
            knownRooms: today.length,
            unreadRooms: targets.length,
            pendingRooms: changed.length - targets.length,
            truncatedRooms,
            // 오늘 방을 다 훑은 뒤에만 합계를 냅니다. 덜 훑은 합계는 «빠졌다»로 잘못 읽힙니다.
            todayParentCount:
              changed.length - targets.length === 0
                ? [...todayCountByRoom.values()].reduce((a, b) => a + b, 0)
                : null,
            totalRooms: all.length,
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
