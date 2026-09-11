/**
 * **오류를 줄이 아니라 「같은 오류」 단위로 봅니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 오류 화면이 최근 50줄을 그냥 늘어놓았습니다. 한 가지가 고장 나면 같은 줄이 수십 개 쌓이고,
 * 그 아래 있던 **다른 종류의 오류는 화면 밖으로 밀려납니다.** 고쳐도 목록은 그대로라,
 * 고쳤는지 안 고쳤는지 화면만 봐서는 알 수 없었습니다. 그래서 아무도 그 화면을 안 보게 됩니다.
 *
 * ── 「해결됐다」를 어떻게 아는가 ─────────────────────────────────────────────
 *
 * 사람이 「해결」을 누른 것은 **주장**이지 사실이 아닙니다. 사실은 하나뿐입니다 -
 * **그 뒤로 다시 안 났는가.**
 *
 * 그래서 해결 표시는 「언제 해결했다고 했는가」만 적어두고, 화면은 매번 **그 시각 이후에 또
 * 났는지**를 봅니다. 또 났으면 눌렀든 말든 다시 미해결로 올라옵니다. 사람이 기억하거나
 * 되돌릴 필요가 없습니다(CLAUDE.md - 기억이 아니라 검사로).
 *
 * ── 왜 라우트를 다시 불러보지 않는가 ────────────────────────────────────────
 *
 * 「다시 확인」이 그 창구를 실제로 불러보는 것이면 가장 확실하겠지만, 오류가 나는 창구는
 * 대개 자료를 바꾸는 자리(POST)입니다. 확인하려다 진짜 자료를 건드리게 됩니다. 확인은
 * **다시 안 났다는 사실**로 합니다.
 */

export type RawErrorLog = {
  id: string;
  route: string;
  message: string;
  stack: string | null;
  user_email: string | null;
  created_at: string;
};

export type ErrorResolution = {
  fingerprint: string;
  resolved_at: string;
  resolved_by: string | null;
  note: string | null;
};

export type ErrorGroup = {
  fingerprint: string;
  route: string;
  /** 가장 최근 줄의 원문. 묶을 때 지운 숫자가 여기에는 그대로 남아 있습니다. */
  message: string;
  stack: string | null;
  userEmail: string | null;
  hits: number;
  firstAt: string;
  lastAt: string;
  /** 해결로 표시한 시각. 없으면 한 번도 표시한 적이 없습니다. */
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  /** **표시한 뒤로 다시 안 났는가.** 이것만이 「해결됨」의 근거입니다. */
  resolved: boolean;
  /** 해결로 표시했는데 그 뒤에 또 난 경우. 화면이 「다시 났습니다」로 알립니다. */
  regressed: boolean;
};

/**
 * 메시지에서 **매번 달라지는 부분**을 지웁니다.
 *
 * 같은 고장인데 학생 번호·시각·줄 번호만 달라서 다른 오류로 세지면, 묶는 뜻이 없어집니다.
 * 반대로 너무 많이 지우면 서로 다른 고장이 한 묶음이 되어 하나를 고치고 「다 고쳤다」고
 * 착각하게 됩니다. 그래서 **값처럼 보이는 것만** 지웁니다.
 */
export function normalizeMessage(message: string): string {
  return message
    .slice(0, 500)
    // UUID
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "«번호»")
    // 날짜·시각
    .replace(/\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/g, "«날짜»")
    // 따옴표 안의 값
    .replace(/"[^"]{0,80}"/g, '"«값»"')
    // 남은 숫자
    .replace(/\d+/g, "«수»")
    .replace(/\s+/g, " ")
    .trim();
}

/** 같은 고장인지 가르는 열쇠. 창구 + 정규화한 메시지입니다. */
export function fingerprintOf(route: string, message: string): string {
  return `${route} :: ${normalizeMessage(message)}`;
}

/**
 * 줄을 묶고, 해결 표시와 맞대어 지금 상태를 냅니다.
 *
 * 정렬은 **마지막 발생이 최근인 순**입니다. 건수가 많은 것을 위로 올리면, 오래 전에 끝난
 * 고장이 계속 맨 위를 차지합니다.
 */
export function groupErrors(logs: RawErrorLog[], resolutions: ErrorResolution[]): ErrorGroup[] {
  const byFp = new Map<string, ErrorGroup>();
  const resByFp = new Map(resolutions.map((r) => [r.fingerprint, r]));

  for (const log of logs) {
    const fp = fingerprintOf(log.route, log.message);
    const cur = byFp.get(fp);
    if (!cur) {
      const r = resByFp.get(fp);
      byFp.set(fp, {
        fingerprint: fp,
        route: log.route,
        message: log.message,
        stack: log.stack,
        userEmail: log.user_email,
        hits: 1,
        firstAt: log.created_at,
        lastAt: log.created_at,
        resolvedAt: r?.resolved_at ?? null,
        resolvedBy: r?.resolved_by ?? null,
        note: r?.note ?? null,
        resolved: false,
        regressed: false,
      });
      continue;
    }
    cur.hits += 1;
    if (log.created_at > cur.lastAt) {
      cur.lastAt = log.created_at;
      // 보여줄 본문은 **가장 최근 줄**입니다. 첫 줄을 보여주면 그새 바뀐 사정이 안 보입니다.
      cur.message = log.message;
      cur.stack = log.stack;
      cur.userEmail = log.user_email;
    }
    if (log.created_at < cur.firstAt) cur.firstAt = log.created_at;
  }

  const out = [...byFp.values()];
  for (const g of out) {
    g.resolved = !!g.resolvedAt && g.lastAt <= g.resolvedAt;
    g.regressed = !!g.resolvedAt && g.lastAt > g.resolvedAt;
  }
  return out.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** 개발자에게 그대로 붙여 넣을 한 덩어리. 묶음이므로 몇 번 났는지가 함께 갑니다. */
export function formatGroup(g: ErrorGroup): string {
  const span =
    g.hits === 1
      ? g.lastAt.slice(0, 19).replace("T", " ")
      : `${g.firstAt.slice(0, 19).replace("T", " ")} ~ ${g.lastAt.slice(0, 19).replace("T", " ")} · ${g.hits}번`;
  return [
    `[${span}] ${g.route}${g.userEmail ? ` (${g.userEmail})` : ""}`,
    g.message,
    g.stack ?? "",
    g.regressed ? `※ ${g.resolvedAt?.slice(0, 19).replace("T", " ")}에 해결로 표시했는데 그 뒤에 또 났습니다.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
