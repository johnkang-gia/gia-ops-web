// 노선 번호 정렬 기준.
//
// 담당자: "셔틀관리에서 등원·하원 모두 호수 오름차순으로 정렬되도록 해줘."
//
// 지금까지는 sort_order(엑셀에 적힌 순서)로 줄을 세웠습니다. 엑셀은 지역별로 묶여 있어서
// 화면에서 "4-2호 다음이 12호"처럼 튑니다. 사람이 호차를 찾을 때는 번호순으로 훑기 때문에
// 번호가 기준이어야 합니다.
//
// 문자열로 정렬하면 "10"이 "2"보다 앞에 옵니다. 그래서 숫자로 갈라서 비교합니다.
//
//   "1" → 1.00      "1-1" → 1.01      "1-2" → 1.02
//   "2" → 2.00      "4-2" → 4.02      "10"  → 10.00
//
// 소수 두 자리를 가지 번호에 씁니다. 가지가 100개를 넘을 일은 없습니다.
export function routeNoSortKey(no: string | null | undefined): number {
  if (!no) return 9999;
  const nums = String(no).match(/\d+/g);
  if (!nums || nums.length === 0) return 9999;
  const main = Number(nums[0]);
  const sub = nums.length > 1 ? Number(nums[1]) : 0;
  return main + Math.min(sub, 99) / 100;
}

/** 호차 오름차순 비교기. `list.sort(byRouteNo(r => r.route_no))` 형태로 씁니다. */
export function byRouteNo<T>(pick: (item: T) => string | null | undefined) {
  return (a: T, b: T) => routeNoSortKey(pick(a)) - routeNoSortKey(pick(b));
}
