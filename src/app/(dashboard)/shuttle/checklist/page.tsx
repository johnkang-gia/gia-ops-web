import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import ShuttleChecklistClient, { type ChecklistRoute, type ChecklistRosterItem } from "@/components/shuttle/ShuttleChecklistClient";

export const dynamic = "force-dynamic";

// 하원 차량 체크표 - 사용자가 올려준 PDF(하원차량 체크표)와 같은 형태로, 노선(차량)별 오늘의
// 학생 명단을 한 화면에서 볼 수 있게 만든 화면입니다(요청: "하원차량 체크표를 내가 준
// 표처럼 페이지를 만들어주고"). 이름을 클릭하면 "픽업"(부모님이 직접 데려가심 - 셔틀을
// 타지 않음) 상태로 바뀌고, 이 상태는 shuttle_boardings에 바로 저장되어 실시간 셔틀
// (/shuttle/live)과 안내보드(/shuttle-board)에도 그대로 반영됩니다(요청: "픽업인 아이들
// 클릭해서 픽업으로 전환하면 바로 실시간 셔틀 판에 반영되도록").
export default async function ShuttleChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ term?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const { term: termParam } = await searchParams;
  const term: "정규학기" | "여름캠프2" = termParam === "정규학기" ? "정규학기" : "여름캠프2";

  const supabase = await createClient();
  const routesRes = await supabase
    .from("shuttle_routes")
    .select("id, route_no, name, driver_name")
    .eq("active", true)
    .eq("direction", "하원")
    .eq("term", term)
    .order("sort_order");
  const routes = (routesRes.data as ChecklistRoute[] | null) ?? [];
  const routeIds = routes.map((r) => r.id);

  let stopsData: { id: string; route_id: string; seq: number }[] = [];
  let assignmentsData: { id: string; stop_id: string; student_name_raw: string; weekdays: number[] }[] = [];
  if (routeIds.length > 0) {
    const stopsRes = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds).order("seq");
    stopsData = stopsRes.data ?? [];
    const stopIds = stopsData.map((s) => s.id);
    if (stopIds.length > 0) {
      const assignRes = await supabase.from("shuttle_assignments").select("id, stop_id, student_name_raw, weekdays").in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  const todayWeekday = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const relevant = assignmentsData.filter((a) => a.weekdays.includes(todayWeekday));
  const assignmentIds = relevant.map((a) => a.id);

  const boardingsRes = assignmentIds.length
    ? await supabase.from("shuttle_boardings").select("assignment_id, status").eq("service_date", today).in("assignment_id", assignmentIds)
    : { data: [] as { assignment_id: string; status: string }[] };
  const statusByAssignment = new Map((boardingsRes.data ?? []).map((b) => [b.assignment_id, b.status]));

  const rosterByRoute: Record<string, ChecklistRosterItem[]> = {};
  for (const a of relevant) {
    const stop = stopById.get(a.stop_id);
    if (!stop) continue;
    const list = rosterByRoute[stop.route_id] ?? (rosterByRoute[stop.route_id] = []);
    list.push({
      assignmentId: a.id,
      studentName: a.student_name_raw,
      stopSeq: stop.seq,
      status: (statusByAssignment.get(a.id) as ChecklistRosterItem["status"]) ?? "예정",
    });
  }
  for (const key of Object.keys(rosterByRoute)) {
    rosterByRoute[key].sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📋 하원 체크표</h1>
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Link
            href="/shuttle/checklist?term=정규학기"
            className={"rounded-lg px-2.5 py-1 " + (term === "정규학기" ? "bg-gia-navy text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")}
          >
            정규학기
          </Link>
          <Link
            href="/shuttle/checklist?term=여름캠프2"
            className={"rounded-lg px-2.5 py-1 " + (term === "여름캠프2" ? "bg-amber-500 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")}
          >
            여름캠프2
          </Link>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        오늘 하원 차량별 학생 명단입니다. 부모님이 직접 데리러 오셔서 셔틀을 타지 않는 학생은 이름을 눌러 &apos;픽업&apos;으로
        바꿔주세요 - 실시간 셔틀·안내보드에서 그 학생은 바로 빠집니다. 다시 누르면 취소됩니다.
      </p>
      <ShuttleChecklistClient routes={routes} rosterByRoute={rosterByRoute} />
    </div>
  );
}
