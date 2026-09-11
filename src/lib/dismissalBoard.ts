/**
 * **오늘 하원체크를 한 목록으로.** — 한 아이는 한 줄입니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 「오늘 하원체크」가 두 갈래를 **따로 세어 더했습니다.**
 *
 *   · 미리 등록해 둔 하원수단(`student_dismissal_plans`) — 금요일은 메타프랩버스
 *   · 오늘 온 픽업(`loadTodayPickups`)                   — 오늘 부모님이 데리러 오심
 *
 * 백서아·황이안은 **양쪽에 다 있었습니다.** 그래서 9월 11일에 5 + 4 = 9명으로 떴는데 실제로는
 * 일곱 명이었습니다. 숫자는 「오늘 몇 명을 챙겨야 하나」를 보라고 있는 것인데, 그 숫자가
 * 틀리면 목록 전체를 못 믿게 됩니다.
 *
 * ── 왜 한쪽을 감추지 않는가 ─────────────────────────────────────────────────
 *
 * 백서아가 양쪽에 있는 것은 **자료가 잘못된 것이 아니라 실제로 부딪히는 상황**입니다 -
 * 금요일에는 학원차를 타기로 되어 있는데 오늘은 부모님이 데리러 오십니다. 한쪽을 감추면
 * 행정실은 나머지 한쪽만 보고 움직이고, 학원차는 안 오는 아이를 기다립니다.
 *
 * 그래서 **한 줄로 합치되 두 가지를 다 적고**, 서로 다른 이야기를 하고 있다는 표시를 답니다.
 * 사람이 그 자리에서 어느 쪽인지 정하면 됩니다.
 *
 * ── 열쇠는 학생 번호 ────────────────────────────────────────────────────────
 *
 * 이름으로 묶으면 김재이 셋이 한 줄이 됩니다(CLAUDE.md 2-4-1). 번호가 없는 옛 픽업 줄만
 * 이름으로 묶고, 그런 줄은 하원수단과 **합치지 않습니다** - 누구인지 모르는 채로 합치면
 * 엉뚱한 아이의 학원차 정보가 붙습니다.
 */

/** 미리 등록해 둔 하원수단 한 건. */
export type PlanEntry = {
  studentId: string;
  name: string;
  className: string;
  kind: string;
  label: string | null;
  time: string | null;
  note: string | null;
};

/** 오늘 온 픽업 한 건. */
export type PickupEntry = {
  studentId: string | null;
  name: string;
  time: string | null;
  source: string;
};

export type BoardRow = {
  key: string;
  studentId: string | null;
  name: string;
  className: string;
  /** 몇 시에 나가는가. 오늘 온 픽업 시각이 먼저입니다 - 오늘 들은 것이 더 새롭습니다. */
  time: string | null;
  plan: { kind: string; label: string | null; note: string | null } | null;
  pickup: { source: string } | null;
  /** 하원수단과 오늘 픽업이 **둘 다** 있는 아이. 사람이 어느 쪽인지 정해야 합니다. */
  conflict: boolean;
};

function keyOf(studentId: string | null, name: string): string {
  return studentId ? `id:${studentId}` : `name:${name}`;
}

export function mergeDismissalBoard(plans: PlanEntry[], pickups: PickupEntry[]): BoardRow[] {
  const out = new Map<string, BoardRow>();

  for (const p of plans) {
    const key = keyOf(p.studentId, p.name);
    out.set(key, {
      key,
      studentId: p.studentId,
      name: p.name,
      className: p.className,
      time: p.time,
      plan: { kind: p.kind, label: p.label, note: p.note },
      pickup: null,
      conflict: false,
    });
  }

  for (const q of pickups) {
    const key = keyOf(q.studentId, q.name);
    const cur = out.get(key);
    if (!cur) {
      out.set(key, {
        key,
        studentId: q.studentId,
        name: q.name,
        className: "",
        time: q.time,
        plan: null,
        pickup: { source: q.source },
        conflict: false,
      });
      continue;
    }
    // 이미 하원수단이 있는 아이. 한 줄로 합치되 **둘 다 적습니다.**
    cur.pickup = { source: q.source };
    cur.conflict = true;
    // 오늘 들은 시각이 먼저입니다. 없으면 등록해 둔 시각이라도 남깁니다 - 시각이 통째로
    // 비면 「몇 시에 나가나」를 다시 찾아봐야 합니다.
    cur.time = q.time ?? cur.time;
  }

  return [...out.values()].sort(
    (a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko"),
  );
}
