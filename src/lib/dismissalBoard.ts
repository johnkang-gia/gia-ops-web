/**
 * **오늘 하원체크 — 한 아이는 한 줄.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 「오늘 하원체크」가 두 갈래를 따로 세어 더해서, 백서아·황이안이 두 번 세어졌습니다
 * (일곱 명이 아홉 명으로).
 *
 * 그런데 자료를 열어보니 **두 번 등록된 것이 아니었습니다.** 그 아이들의 체크표 픽업 줄은
 * `checked_by` 가 「하원수단(외부버스 3:35 블루웨일버스)」였습니다 - 아침 크론이 학생
 * 프로필의 하원수단을 읽어 그날 픽업으로 걸어준 줄입니다.
 *
 * 즉 **하원수단 → 오늘 픽업**은 이미 한 방향으로 흐르고 있었고, 화면이 그 흐름의 **출발점과
 * 도착점을 나란히 보여준 것**이 중복의 정체였습니다.
 *
 * ── 그래서 자료를 복사하지 않습니다 ─────────────────────────────────────────
 *
 * 하원수단을 오늘 픽업 표로 **베껴 넣는** 길도 있습니다. 그러면 목록은 하나가 되지만,
 * 같은 사실이 두 곳에 적히므로 반드시 어긋납니다 - 규칙을 고쳐도 이미 베낀 날은 안 따라오고,
 * 베낀 줄을 지워도 다음 날 아침에 규칙이 다시 만들어냅니다.
 *
 * 이미 있는 흐름을 그대로 쓰되, **어디서 왔는지(`via`)를 함께 들고 다닙니다.**
 *
 * ── 세 칸으로 나눕니다 ──────────────────────────────────────────────────────
 *
 *   ① 오늘      — `loadTodayPickups` 가 낸 목록 그대로. 하원수단에서 온 것도 이미 여기
 *                  들어와 있으므로 **더할 것이 없습니다.** 한 아이는 한 줄입니다.
 *   ② 아직 안 걸림 — 오늘 하원수단이 있는데 ①에 없는 아이. 셔틀 배정이 없어 걸 자리가
 *                  없었거나 아침 크론이 못 돈 경우입니다. **이것이 진짜 알아야 할 것**입니다 -
 *                  조용히 빠지면 아무도 그 아이를 안 데리러 갑니다.
 *   ③ 예정      — 앞날(이번 주 남은 날·다음 주)의 하원수단. 화면이 따로 그립니다.
 */

import type { PickupVia } from "@/lib/pickups";

/** 미리 등록해 둔 하원수단 한 건(오늘 것). */
export type PlanEntry = {
  studentId: string;
  name: string;
  className: string;
  kind: string;
  label: string | null;
  time: string | null;
  note: string | null;
};

/** 오늘 픽업 한 건. `loadTodayPickups` 가 내는 모양입니다. */
export type PickupEntry = {
  studentId: string | null;
  name: string;
  time: string | null;
  source: string;
  via: PickupVia;
};

export type BoardRow = {
  key: string;
  studentId: string | null;
  name: string;
  className: string;
  time: string | null;
  via: PickupVia;
  source: string;
  /** 이 아이의 하원수단. 붙어 있으면 「무엇을 타고 가는지」를 줄에 적을 수 있습니다. */
  plan: { kind: string; label: string | null; note: string | null } | null;
};

export type DismissalBoard = {
  /** 오늘 셔틀이 아닌 방법으로 가는 아이. **이 길이가 곧 오늘 챙길 사람 수**입니다. */
  today: BoardRow[];
  /** 하원수단은 있는데 오늘 픽업으로 안 걸린 아이. 빠진 것이라 눈에 띄어야 합니다. */
  notApplied: PlanEntry[];
};

function keyOf(studentId: string | null, name: string): string {
  // 이름으로 묶으면 김재이 셋이 한 줄이 됩니다(CLAUDE.md 2-4-1). 번호가 없는 옛 줄만
  // 이름으로 묶고, 그런 줄은 하원수단과 잇지 않습니다 - 누구인지 모르는 채로 이으면
  // 엉뚱한 아이의 학원차 정보가 붙습니다.
  return studentId ? `id:${studentId}` : `name:${name}`;
}

export function buildDismissalBoard(plans: PlanEntry[], pickups: PickupEntry[]): DismissalBoard {
  const planById = new Map(plans.map((p) => [p.studentId, p]));
  const covered = new Set<string>();

  const today: BoardRow[] = pickups.map((q) => {
    const plan = q.studentId ? planById.get(q.studentId) : undefined;
    if (plan) covered.add(plan.studentId);
    return {
      key: keyOf(q.studentId, q.name),
      studentId: q.studentId,
      name: q.name,
      className: plan?.className ?? "",
      // 오늘 들은 시각이 먼저입니다. 없으면 등록해 둔 시각이라도 남깁니다 - 시각이 통째로
      // 비면 몇 시에 나가는지를 다시 찾아봐야 합니다.
      time: q.time ?? plan?.time ?? null,
      via: q.via,
      source: q.source,
      plan: plan ? { kind: plan.kind, label: plan.label, note: plan.note } : null,
    };
  });

  today.sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko"));

  return { today, notApplied: plans.filter((p) => !covered.has(p.studentId)) };
}
