/**
 * **한 아이가 요일마다 다른 차를 탈 수 있습니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 셔틀 명단은 「이 아이가 이미 어느 노선에 있으면 다른 노선에 못 넣는다」로 막고 있었습니다.
 * 한 아이가 두 줄이면 체크표에 같은 아이가 두 번 뜨니까요.
 *
 * 그런데 실제 운영은 그렇지 않습니다. 황이안은 **월·화·수는 지금 타는 차**를 타고,
 * **목요일에는 다른 곳으로 가는 차**를 탑니다. 목요일 노선이 새로 생겨서 넣으려는데
 * 「이미 배정됨」으로 막혔습니다.
 *
 * ── 무엇이 진짜 규칙인가 ────────────────────────────────────────────────────
 *
 * 막아야 하는 것은 **「한 아이가 두 줄」**이 아니라 **「같은 요일에 두 차」**입니다. 그건
 * 있을 수 없는 일이고(아이는 한 명이니까), 그대로 두면 그 요일에 두 기사님이 같은 아이를
 * 기다립니다.
 *
 * 요일이 안 겹치면 줄이 둘이어도 아무 문제가 없습니다 - 체크표는 그날 타는 아이만 그립니다.
 *
 * ── 왜 떼어놨나 ─────────────────────────────────────────────────────────────
 *
 * 「이 아이의 목요일이 이미 찼는가」는 화면을 눈으로 봐서는 확인하기 어렵습니다. 노선이
 * 마흔여덟 개이고 아이마다 요일이 다릅니다. 순수 함수로 두면 시험으로 확인합니다.
 */

/** 월~금. 주말 하원 셔틀은 없습니다. */
export const WEEK_DAYS = [1, 2, 3, 4, 5] as const;

export type RosterSlot = {
  /** 이 줄이 속한 노선(호차). 사람에게 「몇 호에 이미 있다」고 말하기 위한 값입니다. */
  routeNo: string;
  /** 배정 줄의 번호. 자기 자신은 겹침에서 빼야 하므로 필요합니다. */
  assignmentId: string;
  studentId: string | null;
  weekdays: number[];
};

/**
 * 그 아이의 요일이 **이미 어느 노선에 잡혀 있는가.**
 *
 * 열쇠는 **학생 번호**입니다. 이름으로 묶으면 김재이 셋의 요일이 한 칸에 섞입니다
 * (CLAUDE.md 2-4-1). 번호가 없는 옛 줄은 셈에 넣지 않습니다 - 누구인지 모르는 줄로 남의
 * 요일을 막으면, 멀쩡한 등록이 이유 없이 거절됩니다.
 */
export function takenDays(slots: readonly RosterSlot[], studentId: string, exceptAssignmentId?: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const s of slots) {
    if (s.studentId !== studentId) continue;
    if (exceptAssignmentId && s.assignmentId === exceptAssignmentId) continue;
    for (const d of s.weekdays) {
      // 먼저 잡은 노선이 그 요일의 주인입니다. 뒤에 온 것으로 덮으면 사람에게 엉뚱한
      // 호차를 알려주게 됩니다.
      if (!out.has(d)) out.set(d, s.routeNo);
    }
  }
  return out;
}

/** 아직 안 잡힌 요일. 새로 넣을 때 기본으로 켜 둘 요일입니다. */
export function freeDays(slots: readonly RosterSlot[], studentId: string): number[] {
  const taken = takenDays(slots, studentId);
  return WEEK_DAYS.filter((d) => !taken.has(d));
}

export const DAY_LABEL = ["", "월", "화", "수", "목", "금"] as const;

/** 「월·화·수(20호)」처럼 사람이 읽는 말로. 어느 호차인지가 있어야 가서 고칩니다. */
export function describeTaken(taken: Map<number, string>): string {
  const byRoute = new Map<string, number[]>();
  for (const [day, route] of taken) {
    const list = byRoute.get(route) ?? [];
    list.push(day);
    byRoute.set(route, list);
  }
  return [...byRoute.entries()]
    .map(([route, days]) => `${days.sort().map((d) => DAY_LABEL[d]).join("·")}(${route}호)`)
    .join(" / ");
}
