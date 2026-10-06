import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **이 아이는 하원 때 차를 타는가 — 한 칸 표시.**
 *
 * 학부모 문의는 대부분 하원 이야기입니다(「오늘 데리러 갈게요」·「학원 차로 보내주세요」). 그런데
 * 문의 목록에는 이름만 있어서, 셔틀을 타는 아이인지 원래 보호자가 데려가는 아이인지 알려면 학생
 * 프로필이나 셔틀 화면을 따로 열어야 했습니다. 셔틀 아이의 「픽업」 연락은 체크표를 고쳐야 하는
 * 일이고, 원래 픽업인 아이의 같은 연락은 할 일이 없습니다 - 둘을 가르는 것이 첫 판단입니다.
 *
 * 읽는 것은 **학생 프로필과 같은 자료**(정규학기 셔틀 배정 + 요일별 하원수단)입니다. 오늘 하루의
 * 예외(오늘만 픽업·결석)는 여기서 보지 않습니다 - 그건 하원 체크표의 일이고, 이 표시는 «원래
 * 어떤 아이인가»를 말합니다.
 */
export type RideBadge = {
  /** 「🚗 12호」 · 「🚗 12호(월수) · 일부」. 셔틀이 없으면 화면이 🚗✕ 로 그립니다(label 은 설명용). */
  label: string;
  rides: boolean;
  /** 마우스를 올렸을 때 풀어 쓴 설명. */
  title: string;
};

const WD = ["일", "월", "화", "수", "목", "금", "토"];

export async function loadRideBadges(supabase: SupabaseClient, studentIds: readonly string[]): Promise<Map<string, RideBadge>> {
  const out = new Map<string, RideBadge>();
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return out;

  const [asgRes, planRes] = await Promise.all([
    supabase
      .from("shuttle_assignments")
      .select("student_id, weekdays, shuttle_stops(shuttle_routes(route_no, direction, term))")
      .in("student_id", ids),
    // dismissal-ok: 오늘 무엇을 타는지 정하는 자리가 아니라, 요일별로 «원래» 무엇인지 적어 보여주는 자리입니다.
    supabase
      .from("student_dismissal_plans")
      .select("student_id, weekday, kind, week_start")
      .in("student_id", ids)
      .is("week_start", null),
  ]);
  if (asgRes.error) console.error("[차량 여부] 셔틀 배정을 읽지 못했습니다:", asgRes.error.message);
  if (planRes.error) console.error("[차량 여부] 하원수단을 읽지 못했습니다:", planRes.error.message);

  type Asg = {
    student_id: string;
    weekdays: number[] | null;
    shuttle_stops: { shuttle_routes: { route_no: string; direction: string; term: string } | null } | null;
  };
  const routesOf = new Map<string, { no: string; days: number[] }[]>();
  for (const a of ((asgRes.data as unknown as Asg[] | null) ?? [])) {
    const r = a.shuttle_stops?.shuttle_routes;
    if (!r || r.term !== "정규학기" || r.direction !== "하원") continue;
    routesOf.set(a.student_id, [...(routesOf.get(a.student_id) ?? []), { no: r.route_no, days: (a.weekdays ?? []).filter((d) => d >= 1 && d <= 5) }]);
  }
  const plansOf = new Map<string, { wd: number; kind: string }[]>();
  for (const p of ((planRes.data as { student_id: string; weekday: number; kind: string }[] | null) ?? [])) {
    if (p.kind === "셔틀") continue;
    plansOf.set(p.student_id, [...(plansOf.get(p.student_id) ?? []), { wd: p.weekday, kind: p.kind }]);
  }

  for (const id of ids) {
    const routes = routesOf.get(id) ?? [];
    const plans = (plansOf.get(id) ?? []).sort((a, b) => a.wd - b.wd);
    const planText = plans.map((p) => `${WD[p.wd] ?? "?"} ${p.kind}`).join(" · ");
    if (routes.length > 0) {
      const nos = [...new Set(routes.map((r) => `${r.no}호`))].join("·");
      // 요일이 적힌 배정은 그날만 탑니다. 매일 타면 요일을 안 적습니다 - 다 적으면 예외가 안 보입니다.
      const days = [...new Set(routes.flatMap((r) => r.days))].sort();
      const dayText = days.length > 0 && days.length < 5 ? `(${days.map((d) => WD[d]).join("")})` : "";
      out.set(id, {
        label: `🚗 ${nos}${dayText}${plans.length ? " · 일부" : ""}`,
        rides: true,
        title: `하원 셔틀을 탑니다: ${nos}${dayText}${planText ? ` / 요일별 다른 수단: ${planText}` : ""}`,
      });
    } else {
      const kinds = [...new Set(plans.map((p) => p.kind))];
      out.set(id, {
        label: kinds.length ? `🚶 ${kinds.join("·")}` : "🚶 셔틀 없음",
        rides: false,
        title: kinds.length ? `하원 셔틀 배정이 없습니다. 하원수단: ${planText}` : "하원 셔틀 배정이 없고 하원수단도 적혀 있지 않습니다.",
      });
    }
  }
  return out;
}
