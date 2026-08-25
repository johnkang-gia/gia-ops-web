import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import StopTimesClient from "@/components/shuttle/StopTimesClient";

export const dynamic = "force-dynamic";

function kstParts(iso: string) {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ym: `${g("year")}-${g("month")}`, date: `${g("year")}-${g("month")}-${g("day")}`, minutes: Number(g("hour")) * 60 + Number(g("minute")) };
}
function fmtMin(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
}

type MonthReportRow = {
  routeNo: string;
  name: string | null;
  runDays: number;
  avg: string | null;
  onTime: number;
  late: number;
  onTimeRate: number | null;
  avgDelay: number | null;
};

// 정류장 도착시간(기록·분석 탭). 요청 채택: 월별 운행 리포트 자동화(운행일수·정시율). 위에 이번 달
// 노선별 운행 리포트를 자동 집계해 보여주고, 아래는 기존 정류장 평균 도착시간 화면입니다.
export default async function StopTimesPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const now = new Date();
  const thisYm = kstParts(now.toISOString()).ym;
  const monthLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long" }).format(now);

  const { data: routesRaw } = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, sort_order")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", "정규학기")
    .order("sort_order");
  const routes = routesRaw ?? [];
  const routeIds = routes.map((r) => r.id as string);

  const rows: MonthReportRow[] = [];
  if (routeIds.length) {
    const { data: stops } = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds);
    const lastStopByRoute = new Map<string, string>();
    const maxSeq = new Map<string, number>();
    for (const s of stops ?? []) {
      const rid = s.route_id as string;
      if (!maxSeq.has(rid) || (s.seq as number) > (maxSeq.get(rid) as number)) {
        maxSeq.set(rid, s.seq as number);
        lastStopByRoute.set(rid, s.id as string);
      }
    }
    const lastStopIds = [...lastStopByRoute.values()];
    const stopToRoute = new Map([...lastStopByRoute.entries()].map(([rid, sid]) => [sid, rid]));
    const { data: arr } = lastStopIds.length
      ? await supabase.from("shuttle_stop_arrivals").select("stop_id, arrived_at").in("stop_id", lastStopIds).limit(3000)
      : { data: [] as { stop_id: string; arrived_at: string }[] };
    // 노선별 전체 평균(정시 기준) + 이번 달 일별 도착
    const allByRoute = new Map<string, number[]>();
    const monthByRoute = new Map<string, { date: string; minutes: number }[]>();
    for (const a of arr ?? []) {
      const rid = stopToRoute.get(a.stop_id as string);
      if (!rid) continue;
      const { ym, date, minutes } = kstParts(a.arrived_at as string);
      (allByRoute.get(rid) ?? allByRoute.set(rid, []).get(rid)!).push(minutes);
      if (ym === thisYm) (monthByRoute.get(rid) ?? monthByRoute.set(rid, []).get(rid)!).push({ date, minutes });
    }
    const ON_TIME_TOL = 5; // ±5분이면 정시
    for (const r of routes) {
      const rid = r.id as string;
      const all = allByRoute.get(rid) ?? [];
      const avg = all.length ? all.reduce((x, y) => x + y, 0) / all.length : null;
      const month = monthByRoute.get(rid) ?? [];
      const byDate = new Map<string, number>();
      for (const m of month) byDate.set(m.date, m.minutes); // 하루 한 번
      let onTime = 0, late = 0, delaySum = 0, delayCount = 0;
      for (const [, mins] of byDate) {
        if (avg == null) continue;
        const d = mins - avg;
        delaySum += d;
        delayCount += 1;
        if (d > ON_TIME_TOL) late += 1;
        else onTime += 1;
      }
      const runDays = byDate.size;
      rows.push({
        routeNo: r.route_no as string,
        name: (r.name as string | null) ?? null,
        runDays,
        avg: avg != null ? fmtMin(avg) : null,
        onTime,
        late,
        onTimeRate: runDays > 0 && avg != null ? Math.round((onTime / runDays) * 100) : null,
        avgDelay: delayCount > 0 ? Math.round(delaySum / delayCount) : null,
      });
    }
  }

  const totalRunDays = rows.reduce((s, r) => s + r.runDays, 0);
  const totalOnTime = rows.reduce((s, r) => s + r.onTime, 0);
  const overallRate = totalRunDays > 0 ? Math.round((totalOnTime / totalRunDays) * 100) : null;

  return (
    <div className="mx-auto w-full max-w-none p-4 sm:p-6">
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-700">📈 {monthLabel} 운행 리포트</h2>
          <div className="flex gap-3 text-xs">
            <span className="text-slate-500">
              총 운행 <b className="text-slate-800">{totalRunDays}</b>회
            </span>
            <span className="text-slate-500">
              전체 정시율 <b className={overallRate != null && overallRate >= 80 ? "text-emerald-600" : "text-amber-600"}>{overallRate ?? "-"}%</b>
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-semibold">호차</th>
                <th className="px-3 py-2 font-semibold">지역</th>
                <th className="px-3 py-2 text-center font-semibold">운행일수</th>
                <th className="px-3 py-2 text-center font-semibold">막차 평균</th>
                <th className="px-3 py-2 text-center font-semibold">정시/지연</th>
                <th className="px-3 py-2 text-center font-semibold">정시율</th>
                <th className="px-3 py-2 text-center font-semibold">평균 지연</th>
              </tr>
            </thead>
            <tbody>
              {rows.every((r) => r.runDays === 0) ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    이번 달 GPS 도착 기록이 아직 없습니다. 운행이 쌓이면 자동으로 집계됩니다.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.routeNo} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-1.5 font-bold text-slate-700">{r.routeNo}호</td>
                    <td className="px-3 py-1.5 text-xs text-slate-500">{r.name ?? "-"}</td>
                    <td className="px-3 py-1.5 text-center">{r.runDays}</td>
                    <td className="px-3 py-1.5 text-center text-slate-600">{r.avg ?? "-"}</td>
                    <td className="px-3 py-1.5 text-center text-xs">
                      <span className="text-emerald-600">{r.onTime}</span>
                      <span className="text-slate-300"> / </span>
                      <span className="text-red-500">{r.late}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center font-semibold">
                      {r.onTimeRate == null ? (
                        <span className="text-slate-300">-</span>
                      ) : (
                        <span className={r.onTimeRate >= 80 ? "text-emerald-600" : "text-amber-600"}>{r.onTimeRate}%</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center text-xs">
                      {r.avgDelay == null ? (
                        <span className="text-slate-300">-</span>
                      ) : r.avgDelay > 0 ? (
                        <span className="text-red-500">+{r.avgDelay}분</span>
                      ) : (
                        <span className="text-emerald-600">{r.avgDelay}분</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">정시 기준: 막차 평균 대비 ±5분 이내. GPS 도착기록이 쌓일수록 정확해집니다.</p>
      </div>

      <StopTimesClient />
    </div>
  );
}
