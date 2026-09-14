/**
 * **두 창구를 맞대어 봅니다** — 토들(학부모) ↔ 구글챗(직원방).
 *
 * ── 왜 이 파일이 있나 ───────────────────────────────────────────────────────
 *
 * 토들과 구글챗은 같은 연락이 두 번 들어오는 **중복이 아닙니다.** 토들 수집은 API가 아니라
 * 화면을 긁어 오는 것이라 놓칠 수 있고, 그래서 직원방(구글챗)에 결석을 한 번 더 올리는
 * **이중 확인**을 두었습니다.
 *
 * 그런데 두 자료가 서로를 못 찾아서, **보험이 맞았는지 틀렸는지 아무도 볼 수 없었습니다.**
 * 실측(2026-09-14): 구글챗에서 온 결석 판정 45건 중 같은 학생·같은 날의 토들 줄이 있는 것은
 * 10건뿐이고 35건은 구글챗에만 있었습니다. 그 35건이 「수집기가 놓친 것」인지 「토들에 오긴
 * 왔는데 결석으로 안 읽힌 것」인지가 갈리지 않으면 고칠 곳을 정할 수 없습니다.
 *
 * ── 맞추는 열쇠는 학생 번호입니다 ───────────────────────────────────────────
 *
 * 이름으로 맞추면 안 됩니다. 구글챗 줄의 이름이 「마야(Maya Amelia Dowding)」·
 * 「강하늘(Skye (Haneul) Kang)」처럼 적혀 있어서, 같은 45건을 글자로 맞추면 **4건**밖에
 * 안 잡힙니다(번호로는 10건). 김재이가 셋인 학교에서 이름으로 고르면 안 된다는 규칙
 * (CLAUDE.md 2-4-1)과도 같은 이야기입니다.
 *
 * **번호가 없는 줄은 「한쪽에만 있다」로 세지 않습니다.** 없어서 못 맞춘 것과 정말 한쪽에만
 * 있는 것은 다른 사실인데, 섞으면 수집기가 멀쩡한데도 놓치는 것처럼 보입니다. 따로
 * `unmatchable` 로 셉니다 - 지금 토들 525줄 중 211줄이 여기 해당합니다.
 *
 * ── 날짜는 점이 아니라 기간입니다 ───────────────────────────────────────────
 *
 * 「16일부터 28일까지 결석합니다」 한 건이 출결내역에는 기간 한 줄로 들어가고, 토들에는 그
 * 사이 어느 날의 연락으로 남습니다. 그래서 토들 날짜가 **기간 안에 들어오면** 같은 건으로
 * 봅니다. 날짜를 딱 맞추면 기간 결석이 전부 「토들에 없음」이 됩니다.
 */

/** `attendance_entries` 한 줄 — 연락을 읽어 만든 **판정**입니다. */
export type CrossEntry = {
  id: string;
  /** "googlechat" | "toddle" | "manual" */
  source: string | null;
  student_id: string | null;
  student_name: string | null;
  status: string | null;
  date_from: string | null;
  date_to: string | null;
  /** "등록" | "확인필요" | "무시" */
  state: string | null;
  raw_text: string | null;
  registered_at: string | null;
  created_at: string | null;
};

/** `pickup_requests` 한 줄 — 토들에서 받은 **원문**입니다(판정 이전). */
export type CrossPickup = {
  id: string;
  student_id: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  /** 그 연락이 가리키는 날. 없으면 받은 날로 봅니다. */
  service_date: string | null;
  received_at: string | null;
  raw_text: string | null;
  summary: string | null;
  /** "확인대기" | "확정" | "무시" */
  status: string | null;
  source_url: string | null;
};

export type ChannelHit = {
  /** 그 줄의 id. 화면이 원문으로 건너뛸 때 씁니다. */
  ref: string;
  at: string;
  text: string;
  /** 그 창구에서의 상태. 「확인대기」인데 반대쪽은 등록이면 그것도 어긋남입니다. */
  state: string;
  url?: string | null;
};

/**
 * 맞대어 본 결과 한 줄.
 *
 * `verdict` 가 셋인 것이 요점입니다. 「토들에 없음」을 한 덩어리로 두면 **고칠 곳을 못
 * 고릅니다** - 아예 안 들어온 것은 수집기 문제이고, 들어왔는데 결석으로 안 읽힌 것은 읽는
 * 규칙 문제입니다.
 */
export type Verdict =
  /** 두 창구가 같은 말을 했습니다. 가장 믿을 만한 줄입니다. */
  | "양쪽 확인"
  /** 토들에 그날 그 아이 연락이 **있는데** 결석으로 안 읽혔습니다 → 읽는 규칙 문제. */
  | "토들은 못 읽음"
  /** 토들에 그날 그 아이 연락이 **아예 없습니다** → 수집기가 놓쳤거나 학부모가 안 알림. */
  | "구글챗에만"
  /** 학부모는 알렸는데 직원방에 안 올라왔습니다 → 공유가 빠진 것. */
  | "토들에만";

export type CrossRow = {
  key: string;
  studentId: string;
  studentName: string;
  /** 판정이 가리키는 기간. 하루면 둘이 같습니다. */
  from: string;
  to: string;
  kind: string;
  chat: ChannelHit | null;
  toddle: ChannelHit | null;
  /** 결석으로 읽히지는 않았지만 그날 토들에 온 연락. `토들은 못 읽음` 의 근거입니다. */
  toddleRaw: ChannelHit | null;
  verdict: Verdict;
};

export type CrossSummary = {
  total: number;
  both: number;
  chatOnly: number;
  unreadByToddle: number;
  toddleOnly: number;
  /** 학생 번호가 없어 대조에 못 들어간 줄. **한쪽에만 있는 것과 다릅니다.** */
  unmatchable: number;
};

const cut = (s: string | null | undefined, n = 140) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/** 날짜 글자 비교. 문자열 산술이라 시간대에 흔들리지 않습니다(CLAUDE.md 4). */
const within = (day: string, from: string, to: string) => day >= from && day <= to;

const dayOf = (p: CrossPickup) => (p.service_date ?? p.received_at ?? "").slice(0, 10);

/**
 * 맞대어 봅니다.
 *
 * @param kinds 볼 종류. 기본은 결석 - 직원방에 다시 올리기로 한 것이 결석이기 때문입니다.
 */
export function buildCrossCheck(input: {
  entries: CrossEntry[];
  pickups: CrossPickup[];
  kinds?: string[];
  /** 이 날짜부터. 없으면 전부. */
  since?: string;
}): { rows: CrossRow[]; summary: CrossSummary } {
  const kinds = input.kinds ?? ["결석"];
  const since = input.since ?? null;

  // 무시한 줄은 뺍니다. 사람이 「이건 아니다」라고 정한 것을 다시 대조 목록에 올리면,
  // 치운 것이 매일 되살아납니다.
  const live = input.entries.filter(
    (e) =>
      e.state !== "무시" &&
      kinds.includes(e.status ?? "") &&
      (e.date_from ?? "") !== "" &&
      (!since || (e.date_to ?? e.date_from ?? "") >= since),
  );

  // 번호 없는 줄은 대조에서 빼고 **따로 셉니다.**
  const unmatchableEntries = live.filter((e) => !e.student_id);
  const matched = live.filter((e) => e.student_id);

  const chatSide = matched.filter((e) => e.source === "googlechat");
  const toddleSide = matched.filter((e) => e.source !== "googlechat");

  // 토들 원문(판정 이전). 번호 없는 줄은 어느 아이 것인지 모르므로 쓰지 않습니다.
  const rawByStudent = new Map<string, CrossPickup[]>();
  let unmatchablePickups = 0;
  for (const p of input.pickups) {
    if (p.status === "무시") continue;
    const day = dayOf(p);
    if (!day) continue;
    if (since && day < since) continue;
    if (!p.student_id) {
      unmatchablePickups += 1;
      continue;
    }
    const list = rawByStudent.get(p.student_id) ?? [];
    list.push(p);
    rawByStudent.set(p.student_id, list);
  }

  const hitOfEntry = (e: CrossEntry): ChannelHit => ({
    ref: e.id,
    at: e.registered_at ?? e.created_at ?? "",
    text: cut(e.raw_text),
    state: e.state ?? "",
  });
  const hitOfPickup = (p: CrossPickup): ChannelHit => ({
    ref: p.id,
    at: p.received_at ?? "",
    text: cut(p.raw_text ?? p.summary),
    state: p.status ?? "",
    url: p.source_url,
  });

  const rows: CrossRow[] = [];
  const usedToddleEntry = new Set<string>();

  for (const c of chatSide) {
    const from = c.date_from as string;
    const to = c.date_to ?? from;
    const sid = c.student_id as string;

    // 같은 아이·겹치는 기간·같은 종류의 **토들 판정**.
    const t = toddleSide.find(
      (x) =>
        x.student_id === sid &&
        x.status === c.status &&
        // 기간이 한 날이라도 겹치면 같은 건으로 봅니다.
        (x.date_from as string) <= to &&
        (x.date_to ?? x.date_from) !== null &&
        ((x.date_to ?? x.date_from) as string) >= from,
    );
    if (t) usedToddleEntry.add(t.id);

    // 판정은 없지만 그날 토들에 온 연락이 있는가.
    const raw = (rawByStudent.get(sid) ?? []).find((p) => within(dayOf(p), from, to)) ?? null;

    rows.push({
      key: `${sid}|${from}|${c.status}`,
      studentId: sid,
      studentName: c.student_name ?? "",
      from,
      to,
      kind: c.status ?? "",
      chat: hitOfEntry(c),
      toddle: t ? hitOfEntry(t) : null,
      toddleRaw: raw ? hitOfPickup(raw) : null,
      verdict: t ? "양쪽 확인" : raw ? "토들은 못 읽음" : "구글챗에만",
    });
  }

  // 학부모는 알렸는데 직원방에 안 올라온 건.
  for (const t of toddleSide) {
    if (usedToddleEntry.has(t.id)) continue;
    const from = t.date_from as string;
    const to = t.date_to ?? from;
    const sid = t.student_id as string;
    const raw = (rawByStudent.get(sid) ?? []).find((p) => within(dayOf(p), from, to)) ?? null;
    rows.push({
      key: `${sid}|${from}|${t.status}`,
      studentId: sid,
      studentName: t.student_name ?? "",
      from,
      to,
      kind: t.status ?? "",
      chat: null,
      toddle: hitOfEntry(t),
      toddleRaw: raw ? hitOfPickup(raw) : null,
      verdict: "토들에만",
    });
  }

  // 봐야 할 것이 위로. 「양쪽 확인」은 이미 끝난 일이라 맨 아래입니다.
  const rank: Record<Verdict, number> = { "구글챗에만": 0, "토들은 못 읽음": 1, "토들에만": 2, "양쪽 확인": 3 };
  rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.from > a.from ? 1 : b.from < a.from ? -1 : 0));

  return {
    rows,
    summary: {
      total: rows.length,
      both: rows.filter((r) => r.verdict === "양쪽 확인").length,
      chatOnly: rows.filter((r) => r.verdict === "구글챗에만").length,
      unreadByToddle: rows.filter((r) => r.verdict === "토들은 못 읽음").length,
      toddleOnly: rows.filter((r) => r.verdict === "토들에만").length,
      unmatchable: unmatchableEntries.length + unmatchablePickups,
    },
  };
}

/** 사람에게 그대로 보여줄 한 줄. 무엇을 고쳐야 하는지까지 말합니다. */
export function verdictNote(v: Verdict): string {
  switch (v) {
    case "양쪽 확인":
      return "학부모 연락과 직원방 알림이 모두 있습니다.";
    case "토들은 못 읽음":
      return "토들에 그날 연락은 왔는데 결석으로 읽지 못했습니다 — 읽는 규칙을 고쳐야 합니다.";
    case "구글챗에만":
      return "토들에 그날 이 아이 연락이 아예 없습니다 — 수집기가 놓쳤거나 학부모가 토들로 알리지 않았습니다.";
    case "토들에만":
      return "학부모는 알렸는데 직원방에 올라오지 않았습니다.";
  }
}
