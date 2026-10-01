import type { SupabaseClient } from "@supabase/supabase-js";
import { CURRENT_SHUTTLE_TERM, type ShuttleTerm } from "@/lib/shuttleTerm";
import type { ShuttleAssignment, ShuttleDirection, ShuttleRoute, ShuttleStop } from "@/lib/types";

/**
 * **셔틀 노선·정류장·배정을 한 벌로 읽습니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 세 표를 함께 읽는 자리가 열아홉 곳이고 각자 `term` 과 `active` 를 다르게 걸었습니다. 그래서
 * 노선 관리·탑승 배정은 켠 노선만 읽어 대기 노선이 어디에도 안 보였고, 다른 화면은 지난
 * 학기 노선까지 읽어 같은 호차가 두 번 보였습니다. 한 벌을 고치면 나머지 열여덟은 그대로
 * 남고, 그건 오류가 아니라 「다른 명단」으로 보입니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 읽는 조건을 **인자로** 받고, 거르는 일은 여기서 한 번만 합니다. 재무의 `loadLedgerWorld`
 * 와 같은 꼴입니다.
 *
 *   term            학기. 기본은 지금 학기.
 *   direction       등원·하원 중 하나만. 비우면 둘 다.
 *   includeDormant  꺼둔(대기) 노선도. 노선 관리·탑승 배정처럼 **고치는** 화면만 켭니다 -
 *                   체크표·안내보드·지도 같은 운영 화면은 켠 노선만 봅니다.
 *   assignments     "none" | "basic"(이름·요일만) | "full"(표 전체). 정류장·배정은 받은 노선에
 *                   딸린 것만 남깁니다.
 */
export type ShuttleWorldOpts = {
  term?: ShuttleTerm;
  direction?: ShuttleDirection;
  includeDormant?: boolean;
  assignments?: "none" | "basic" | "full";
};

export type ShuttleAssignmentBasic = Pick<ShuttleAssignment, "id" | "stop_id" | "student_name_raw" | "weekdays" | "student_id">;

export type ShuttleWorld<A = ShuttleAssignment> = {
  routes: ShuttleRoute[];
  stops: ShuttleStop[];
  assignments: A[];
  routeById: Map<string, ShuttleRoute>;
  stopById: Map<string, ShuttleStop>;
  errors: string[];
};

export async function loadShuttleWorld(supabase: SupabaseClient, opts: ShuttleWorldOpts & { assignments: "full" }): Promise<ShuttleWorld<ShuttleAssignment>>;
export async function loadShuttleWorld(supabase: SupabaseClient, opts: ShuttleWorldOpts & { assignments: "basic" }): Promise<ShuttleWorld<ShuttleAssignmentBasic>>;
export async function loadShuttleWorld(supabase: SupabaseClient, opts?: ShuttleWorldOpts): Promise<ShuttleWorld<ShuttleAssignment>>;
export async function loadShuttleWorld(supabase: SupabaseClient, opts: ShuttleWorldOpts = {}): Promise<ShuttleWorld<ShuttleAssignment | ShuttleAssignmentBasic>> {
  const term = opts.term ?? CURRENT_SHUTTLE_TERM;
  const want = opts.assignments ?? "full";
  const errors: string[] = [];

  let rq = supabase.from("shuttle_routes").select("*").eq("term", term).order("direction").order("sort_order");
  if (!opts.includeDormant) rq = rq.eq("active", true);
  if (opts.direction) rq = rq.eq("direction", opts.direction);

  // 정류장·배정은 표 전체를 받아 메모리에서 거릅니다. 노선 번호로 `in` 을 걸면 왕복이 하나 늘고,
  // 표가 수백 줄이라 통째로 받는 쪽이 빠릅니다(앞서 용량 화면에서 실측).
  const [routesRes, stopsRes, asgRes] = await Promise.all([
    rq,
    supabase.from("shuttle_stops").select("*").order("seq"),
    want === "none"
      ? Promise.resolve({ data: [] as ShuttleAssignment[], error: null })
      : want === "basic"
        ? supabase.from("shuttle_assignments_basic").select("id, stop_id, student_name_raw, weekdays, student_id")
        : supabase.from("shuttle_assignments").select("*"),
  ]);
  if (routesRes.error) errors.push(`노선: ${routesRes.error.message}`);
  if (stopsRes.error) errors.push(`정류장: ${stopsRes.error.message}`);
  if (asgRes.error) errors.push(`배정: ${asgRes.error.message}`);

  const routes = (routesRes.data as ShuttleRoute[] | null) ?? [];
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const stops = (((stopsRes.data as ShuttleStop[] | null) ?? [])).filter((s) => routeById.has(s.route_id));
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const assignments = (((asgRes.data as (ShuttleAssignment | ShuttleAssignmentBasic)[] | null) ?? [])).filter((a) => stopById.has(a.stop_id));

  return { routes, stops, assignments, routeById, stopById, errors };
}
