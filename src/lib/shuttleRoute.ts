/**
 * **이 아이는 어느 차를 타는가** — 판정은 여기 한 곳에서만 합니다.
 *
 * ── 무엇이 났나 ─────────────────────────────────────────────────────────────
 *
 * 셔틀 명단에서 이예온을 28호에 넣었는데 하원 체크표에는 28호에 없었습니다. 자료는 멀쩡했고,
 * **두 화면이 서로 다른 질문에 답하고 있었습니다.**
 *
 *   · 셔틀 명단   — 「이 배정 줄의 **정류장**이 어느 노선에 속하나」 → 28호
 *   · 하원 체크표 — 「오늘만 이동 ?? 계속 이동 ?? 정류장의 노선」    → 계속 이동이 걸려 있어 다른 호차
 *
 * 이예온에게는 예전에 걸어둔 **계속 이동**(`shuttle_assignments.override_route_id`)이 남아
 * 있었습니다. 명단 화면은 그 칸을 아예 안 읽었고, 그래서 그런 것이 있다는 사실조차 화면에
 * 나타나지 않았습니다. 명단에서 아무리 고쳐도 체크표는 계속 다른 답을 했습니다.
 *
 * 화면에는 오류가 아니라 **「그냥 다른 명단」**으로 보입니다. 그리고 체크표는 인쇄해서 씁니다 -
 * 종이에 없는 아이는 아무도 안 찾고, 엉뚱한 줄에 있는 아이는 엉뚱한 차에 탑니다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────────
 *
 * 센 것부터. 오늘만 > 계속 > 원래.
 *
 *   ① `overrideRouteId`  — 오늘 하루만 옮긴 것(`shuttle_boardings.override_route_id`).
 *   ② `permanentRouteId` — 계속 옮긴 것(`shuttle_assignments.override_route_id`).
 *   ③ `homeRouteId`      — 배정 줄의 정류장이 속한 노선. 바뀌지 않는 기준점.
 *
 * **모르는 노선을 가리키는 이동은 없는 것으로 봅니다**(`isKnownRoute`). 지난 학기 노선이나
 * 꺼진 노선으로 옮겨둔 줄이 남아 있는데, 그 노선은 지금 화면에 없습니다. 그대로 쓰면 그
 * 아이는 **어느 카드에도 안 뜹니다** - 명단에서 사라지는데 오류는 안 납니다. 원래 자리로
 * 돌려보내는 편이 안전합니다.
 *
 * 이 순서를 화면마다 다시 쓰지 않습니다. 다시 쓰면 한 곳을 고치고 나머지를 잊고, 잊은 화면은
 * 오류를 내지 않습니다 - 그냥 다른 답을 합니다.
 */

export type RouteChoice = {
  /** 배정 줄의 정류장이 속한 노선. */
  homeRouteId: string;
  /** 계속 이동(`shuttle_assignments.override_route_id`). 없으면 null. */
  permanentRouteId?: string | null;
  /** 오늘 하루만 이동(`shuttle_boardings.override_route_id`). 없으면 null. */
  overrideRouteId?: string | null;
};

/** 지금 화면이 아는 노선인가. 안 넘기면 전부 안다고 봅니다. */
export type KnownRoute = ((routeId: string) => boolean) | undefined;

/** 모르는 노선을 가리키는 이동은 없는 것으로. */
function valid(id: string | null | undefined, known: KnownRoute): string | null {
  if (!id) return null;
  if (known && !known(id)) return null;
  return id;
}

/**
 * 배정 줄·정류장·오늘 탑승 기록에서 **판정 재료**를 한 덩어리로 만듭니다.
 *
 * 화면마다 `a.override_route_id && routeIdSet.has(...) ? ... : stop.route_id` 를 손으로 다시
 * 쓰고 있었습니다. 여덟 군데였고, 괄호 위치가 조금씩 달랐습니다. 재료를 만드는 일도 한 곳에서
 * 합니다.
 */
export function routeChoiceOf(
  args: {
    /** 배정 줄의 정류장이 속한 노선. */
    stopRouteId: string;
    /** `shuttle_assignments.override_route_id` */
    assignmentOverride?: string | null;
    /** `shuttle_boardings.override_route_id` (그날치). */
    boardingOverride?: string | null;
  },
  isKnownRoute?: KnownRoute,
  // 돌려주는 칸은 **반드시 null 이거나 값**입니다. undefined 를 섞어 보내면 「안 정했다」와
  // 「없다」가 구별되지 않고, 받는 쪽 타입이 매번 어긋납니다.
): { homeRouteId: string; permanentRouteId: string | null; overrideRouteId: string | null } {
  return {
    homeRouteId: args.stopRouteId,
    permanentRouteId: valid(args.assignmentOverride, isKnownRoute),
    overrideRouteId: valid(args.boardingOverride, isKnownRoute),
  };
}

/** 지금 이 아이가 타는 노선. **모든 화면이 이 함수만 씁니다.** */
export function effectiveRouteId(c: RouteChoice, isKnownRoute?: KnownRoute): string {
  return valid(c.overrideRouteId, isKnownRoute) ?? valid(c.permanentRouteId, isKnownRoute) ?? c.homeRouteId;
}

/** 원래 자리에서 옮겨져 있는가. 옮겨졌으면 화면이 그 사실을 적어야 합니다. */
export function isMoved(c: RouteChoice): boolean {
  return effectiveRouteId(c) !== c.homeRouteId;
}

/** 오늘 하루만 옮긴 것인가(내일이면 돌아옵니다). */
export function isMovedToday(c: RouteChoice): boolean {
  return !!c.overrideRouteId && c.overrideRouteId !== (c.permanentRouteId ?? c.homeRouteId);
}

/** 계속 옮긴 것인가(사람이 풀기 전까지 유지됩니다). */
export function isMovedPermanently(c: RouteChoice): boolean {
  return !!c.permanentRouteId && c.permanentRouteId !== c.homeRouteId;
}

/**
 * 「원래 28호에서 계속 옮김」처럼 사람이 읽는 한 줄.
 *
 * **어디서 왔는지를 반드시 적습니다.** 옮겨졌다는 사실만 적으면 어디로 가서 풀어야 하는지
 * 모르고, 그러면 아무도 안 풉니다.
 */
export function moveNote(c: RouteChoice, routeNoOf: (id: string) => string | null): string | null {
  if (!isMoved(c)) return null;
  const home = routeNoOf(c.homeRouteId);
  const kind = isMovedToday(c) ? "오늘만 옮김" : "계속 옮김";
  return home ? `원래 ${home}호 · ${kind}` : kind;
}
