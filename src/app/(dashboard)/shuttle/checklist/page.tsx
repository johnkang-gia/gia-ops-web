import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import ShuttleChecklistClient, { type ChecklistRoute, type ChecklistItem } from "@/components/shuttle/ShuttleChecklistClient";
import type { GoogleChatMirrorMessage } from "@/lib/types";

export const dynamic = "force-dynamic";

// 하원 차량 체크표 - 사용자가 올려준 PDF(하원차량 체크표)와 같은 형태로, 노선(차량)별 오늘의
// 학생 명단을 한 화면에서 볼 수 있게 만든 화면입니다(요청: "하원차량 체크표를 내가 준
// 표처럼 페이지를 만들어주고"). 이름을 클릭하면 "픽업"(부모님이 직접 데려가심 - 셔틀을
// 타지 않음)·"결석" 상태로 바뀌고, 이름을 다른 노선 칸으로 끌어다 놓으면 계속 유지할지
// 오늘 하루만 옮길지 물어봅니다(요청: "차량을 수정하면 계속 수정된채로 있을건지, 오늘만
// 차량이 바뀌는 건지 물어보고"). 이 상태는 shuttle_boardings/shuttle_assignments에 바로
// 저장되어(RLS가 로그인한 교직원 전체의 쓰기를 허용) 실시간 셔틀(/shuttle/live)과
// 안내보드(/shuttle-board)에도 그대로 반영됩니다.
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
  let assignmentsData: {
    id: string;
    stop_id: string;
    student_name_raw: string;
    weekdays: number[];
    override_route_id: string | null;
    note: string | null;
  }[] = [];
  if (routeIds.length > 0) {
    const stopsRes = await supabase.from("shuttle_stops").select("id, route_id, seq").in("route_id", routeIds).order("seq");
    stopsData = stopsRes.data ?? [];
    const stopIds = stopsData.map((s) => s.id);
    if (stopIds.length > 0) {
      const assignRes = await supabase
        .from("shuttle_assignments")
        .select("id, stop_id, student_name_raw, weekdays, override_route_id, note")
        .in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  const todayWeekday = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const routeIdSet = new Set(routeIds);
  const relevant = assignmentsData.filter((a) => a.weekdays.includes(todayWeekday));
  const assignmentIds = relevant.map((a) => a.id);

  const boardingsRes = assignmentIds.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", assignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };
  const boardingByAssignment = new Map((boardingsRes.data ?? []).map((b) => [b.assignment_id, b]));

  // 그룹핑은 클라이언트에서 하도록, 노선별로 나누지 않은 평평한 목록으로 넘깁니다 - 드래그로
  // 옮길 때마다 서버를 다시 안 거치고 화면에서 바로 다시 묶어 보여주기 위해서입니다.
  // homeRouteId는 정류장 기준 절대 원래 노선(불변), permanentRouteId는 계속 유지되는 영구
  // 이동, overrideRouteId는 오늘 하루만의 이동입니다.
  const items: ChecklistItem[] = relevant
    .map((a) => {
      const stop = stopById.get(a.stop_id);
      if (!stop) return null;
      const boarding = boardingByAssignment.get(a.id);
      const item: ChecklistItem = {
        assignmentId: a.id,
        studentName: a.student_name_raw,
        stopSeq: stop.seq,
        homeRouteId: stop.route_id,
        permanentRouteId: a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : null,
        overrideRouteId: boarding?.override_route_id ?? null,
        status: (boarding?.status as ChecklistItem["status"]) ?? "예정",
        note: a.note ?? null,
      };
      return item;
    })
    .filter((x): x is ChecklistItem => !!x)
    .sort((x, y) => x.stopSeq - y.stopSeq || x.studentName.localeCompare(y.studentName, "ko"));

  // 왼쪽 사이드바용 - 업무 메뉴의 출결내역(구글챗 출결알림)과 같은 자료를 다시 훑어 오늘
  // 픽업·결석 학생을 보여줍니다(요청: "업무메뉴에있는 결석과 픽업아이들이 목록으로 떴으면
  // 좋겠어... 업무쪽으로 가지 않아도 알수 있도록"). 셔틀은 초등부 한정 기능이라 부서는
  // 항상 초등부로 고정합니다.
  const mirrorRes = await supabase
    .from("google_chat_mirror_messages")
    .select("*")
    .order("created_at_google", { ascending: false })
    .limit(200);
  const { data: rosterData } = await supabase.from("wr_students").select("name, grade, name_en").eq("status", "active");
  const roster = ((rosterData as { name: string; grade: string | null; name_en: string | null }[] | null) ?? []).map((s) => ({
    name: s.name,
    grade: s.grade,
    nameEn: s.name_en,
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 print:hidden">
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
      <p className="mb-4 text-xs text-slate-500 print:hidden">
        오늘 하원 차량별 학생 명단입니다. 부모님이 직접 데리러 오셔서 셔틀을 타지 않는 학생은 🚗(픽업), 결석한 학생은
        🚫(결석)을 눌러주세요 - 다시 누르면 취소됩니다. 다른 차를 타야 하는 학생은 이름을 눌러 원하는 노선 칸으로 끌어다
        놓고, 계속 유지할지 오늘만 바꿀지 골라주세요.
      </p>
      <p className="mb-2 hidden text-sm font-bold print:block">GIA 하원 체크표 · {today}</p>
      <ShuttleChecklistClient routes={routes} items={items} roster={roster} initialMessages={(mirrorRes.data as GoogleChatMirrorMessage[] | null) ?? []} term={term} />
    </div>
  );
}
