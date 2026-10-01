/**
 * **명단 줄 순서는 한 곳에서만 정합니다.**
 *
 * 체크표·인쇄본·셔틀명단·실시간 셔틀·도착체크가 각자 `stopSeq → 이름` 으로 정렬하고 있었습니다.
 * 손으로 정한 순서(`sort_order`)를 넣으면서 다섯 곳을 따로 고치면, 한 곳이 빠지는 날 그 화면만
 * 다른 순서의 명단을 냅니다 - 종이 체크표와 태블릿 순서가 다르면 현장에서 아이를 두 번 셉니다.
 *
 * 정류장 순서가 먼저, 그 안에서 사람이 정한 순서, 그것도 같으면 이름입니다. 0은 「정하지 않음」.
 */
export type RosterOrderable = { stopSeq: number; sortOrder?: number | null; studentName: string };

export function compareRoster(a: RosterOrderable, b: RosterOrderable): number {
  if (a.stopSeq !== b.stopSeq) return a.stopSeq - b.stopSeq;
  const ao = a.sortOrder ?? 0;
  const bo = b.sortOrder ?? 0;
  // 정한 아이가 안 정한 아이보다 앞입니다. 둘 다 정했으면 작은 수가 앞.
  if (ao !== bo) {
    if (ao === 0) return 1;
    if (bo === 0) return -1;
    return ao - bo;
  }
  return a.studentName.localeCompare(b.studentName, "ko");
}
