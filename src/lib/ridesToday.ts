/**
 * **오늘 이 차를 타는 아이는 누구인가** — 이 판단은 여기 한 곳에서만 합니다.
 *
 * ── 왜 한 곳이어야 하나 ──────────────────────────────────────────────
 *
 * 셔틀 명단을 그리는 화면이 여섯 곳입니다. 하원 체크표, 차량 도착·출발 체크, 안내보드,
 * 기사님 체크인, 실시간 셔틀, 운행일지. 여섯 곳이 각자 `weekdays.includes(오늘)` 을
 * 적어 두고 있었습니다. 같은 한 줄이라 같은 답이 나올 것 같지만, 그렇지 않았습니다.
 *
 * 하원 체크표는 **오늘 안 타는 아이도 옅은 회색으로 띄워 두고, 눌러서 「탑승」으로 바꿀 수
 * 있게** 만들어져 있습니다. "오늘만 태워 주세요" 연락이 오면 직원이 거기서 바꿉니다.
 * 그런데 나머지 화면은 요일로 먼저 걸러낸 다음에야 체크표를 읽었습니다. 요일이 안 맞는
 * 아이는 걸러진 뒤라 **체크표를 읽어보지도 않았습니다.**
 *
 * 그래서 직원이 탑승으로 바꾼 박지음·이라엘이 차량 도착·출발 체크 화면에 아예 없었습니다.
 * 빨간 줄도 안 뜹니다 - 그냥 명단에 없습니다. 기사님도 동승 선생님도 그 아이를 태워야
 * 하는지 알 방법이 없고, 하원 시간의 착오는 되돌릴 수 없습니다.
 *
 * ── 규칙 ─────────────────────────────────────────────────────────────
 *
 * **오늘 사람이 정한 것이 요일보다 먼저입니다.**
 *
 * - 요일이 맞으면 탑니다 (평소대로)
 * - 요일이 안 맞아도 오늘 체크표가 「탑승」이면 탑니다 (오늘만 태우는 아이)
 * - 요일이 맞아도 오늘 체크표가 「픽업」·「결석」이면 **여기서는 남깁니다.**
 *   빼는 일은 화면마다 다릅니다 - 도착 체크 화면은 빼고, 체크표 자신은 회색으로 남겨
 *   두어야 되돌릴 수 있습니다. 그 판단까지 여기서 하면 체크표가 자기 줄을 지웁니다.
 *
 * 그러므로 이 함수는 **명단에 올릴 후보**를 정하고, 「태울지 말지」는 부르는 쪽이 정합니다.
 */

/** 체크표에서 「오늘 이 아이는 탄다」를 뜻하는 값. 글자를 여기저기 적지 않습니다. */
export const RIDING = "탑승";

export type RideAssignment = { id: string; weekdays: number[] | null };
export type RideBoarding = { assignment_id: string; status: string | null };

/**
 * 오늘 체크표에서 「탑승」으로 눌러둔 배정 번호.
 *
 * **체크표를 먼저 읽어야 합니다.** 요일로 먼저 거른 뒤 그 아이들의 체크표만 읽으면,
 * 요일이 안 맞는 아이는 영영 안 읽힙니다 - 이 순서가 이 파일이 생긴 이유입니다.
 */
export function ridingIds(boardings: RideBoarding[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const b of boardings ?? []) if (b.status === RIDING) out.add(b.assignment_id);
  return out;
}

/** 오늘 명단에 올릴 배정. `boardings` 는 **오늘 전체 배정**의 체크표여야 합니다. */
export function ridesToday<T extends RideAssignment>(
  assignments: T[] | null | undefined,
  boardings: RideBoarding[] | null | undefined,
  weekday: number,
): T[] {
  const riding = ridingIds(boardings);
  return (assignments ?? []).filter((a) => (a.weekdays ?? []).includes(weekday) || riding.has(a.id));
}
