import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import ShuttleChecklistClient, { type ChecklistRoute, type ChecklistItem, type PersistentNote } from "@/components/shuttle/ShuttleChecklistClient";
import type { GoogleChatMirrorMessage } from "@/lib/types";
import { categorize } from "@/lib/attendanceDigest";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📋 하원 체크표란?",
    lines: [
      "오늘 하원 차량별로 누가 타는지 보여주는 명단입니다. 하루에도 여러 번 여는 화면이라 셔틀 메뉴 맨 위에 있습니다.",
      "부모님이 직접 데리러 오셔서 셔틀을 타지 않는 학생은 🚗(픽업), 결석한 학생은 🚫(결석)을 눌러주세요. 다시 누르면 취소됩니다.",
      "여기서 누른 내용은 안내보드·차량 도착체크·사무실 대시보드에 즉시 반영됩니다. 기사님과 동승 선생님이 기다리지 않습니다.",
      "담임 선생님이 [내 반 픽업 체크]에서 누른 것과, 구글챗에 올라온 픽업 글도 같은 칸에 자동으로 들어옵니다 - 세 방법을 함께 써도 충돌하지 않습니다.",
    ],
  },
  {
    title: "🚌 다른 차를 타야 할 때",
    lines: [
      "학생 이름을 눌러 원하는 노선 칸으로 끌어다 놓으면 차가 바뀝니다.",
      "옮긴 뒤 [계속 유지]와 [오늘만] 중에 고릅니다. 이사처럼 계속 바뀌는 경우는 [계속 유지], 오늘 하루 사정은 [오늘만]입니다.",
      "[오늘만]으로 옮긴 학생은 내일 원래 노선으로 돌아옵니다.",
    ],
  },
  {
    title: "🖨️ 인쇄와 학기 전환",
    lines: [
      "오른쪽 위 인쇄 버튼으로 종이 체크표를 뽑을 수 있습니다. 화면 버튼과 안내문은 인쇄본에서 빠집니다.",
      "상단에서 정규학기와 여름캠프2를 오갈 수 있습니다. 두 기간은 노선과 명단이 완전히 분리되어 있어 서로 섞이지 않습니다.",
    ],
  },
];

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
  // 요청: "하원체크표에 정규학기 애들 체크가 하나도 안되어 있어" - 여름캠프2가 끝났으므로
  // 기본을 정규학기로 둡니다(예전엔 기본이 여름캠프2라 정규학기 명단이 비어 보였습니다).
  const term: "정규학기" | "여름캠프2" = termParam === "여름캠프2" ? "여름캠프2" : "정규학기";

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
    student_id: string | null;
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
        .from("shuttle_assignments_basic")
        .select("id, stop_id, student_id, student_name_raw, weekdays, override_route_id, note")
        .in("stop_id", stopIds);
      assignmentsData = assignRes.data ?? [];
    }
  }

  // 요청: "유치부랑 다있는거 같은데 우리 명단만 보이게 (...) 명단에 없는 이름들은 전부 숨김".
  // 하원 셔틀은 초등부(우리 명부)만 다룹니다. 버스에 함께 실린 유치부·중고등부는 명부의 부서로
  // 걸러 숨깁니다. 배정에 student_id가 연결돼 있으면 그 학생의 부서로, 없으면 이름으로 대조합니다.
  const { data: elemStudents } = await supabase
    .from("wr_students_basic")
    .select("id, name, department")
    .eq("status", "active");
  const elemIdSet = new Set(
    (elemStudents ?? []).filter((s) => s.department === "초등부").map((s) => s.id as string)
  );
  const elemNameSet = new Set(
    (elemStudents ?? []).filter((s) => s.department === "초등부").map((s) => (s.name as string).replace(/\s+/g, ""))
  );
  // 요청: "내가 알려준 명단의 아이들만 숨기지 말고 보여달라" - 초등부 명부 외에, 아래 중고등부
  // 탑승 명단(직접 알려주신 이름)만 함께 보여주고, 그 밖의 이름(유치부 등)은 숨깁니다.
  const EXTRA_RIDERS = [
    "이준서", "이준우", "김도율", "김샤론", "이하은", "최온유", "위준완", "김승후",
    "노다은", "노다혜", "강하영", "박진우", "제이콥", "장하영", "에이바", "강하엘",
    // 요청: 초등 졸업으로 중등부가 되었지만 하원 셔틀은 계속 타므로 명단에 표시(숨기지 않음).
    "박준후", "문수민", "이도후", "곽호율", "박지음", "강여명", "정서안",
  ];
  const extraNameSet = new Set(EXTRA_RIDERS.map((n) => n.replace(/\s+/g, "")));
  // 유치부인데 초등부 동명이인 때문에 이름 대조로 잘못 딸려오는 학생을 콕 집어 숨깁니다
  // (요청: "2호 김사랑은 유치부야 하원 체크표에 있으면 안돼"). "호차:이름"으로 지정합니다.
  const HIDE_RIDERS = new Set(["2:김사랑"]);
  const routeNoById = new Map(routes.map((r) => [r.id, r.route_no]));
  const stopRouteNo = new Map(stopsData.map((s) => [s.id, routeNoById.get(s.route_id) ?? ""]));
  assignmentsData = assignmentsData.filter((a) => {
    const rawName = (a.student_name_raw ?? "").replace(/\s+/g, "");
    const rno = (stopRouteNo.get(a.stop_id) ?? "").replace(/호$/, "");
    if (HIDE_RIDERS.has(`${rno}:${rawName}`)) return false; // 유치부 동명이인 제외
    if (extraNameSet.has(rawName)) return true; // 알려주신 중고등·중등부 탑승자
    if (a.student_id) return elemIdSet.has(a.student_id); // 초등부(명부 연결)
    return elemNameSet.has(rawName); // 초등부(이름 대조)
  });

  const todayWeekday = new Date().getDay();
  const today = new Date().toISOString().slice(0, 10);
  const stopById = new Map(stopsData.map((s) => [s.id, s]));
  const routeIdSet = new Set(routeIds);

  // 요청: "안타는 아이도 옅은 회색으로 표시 (...) 갑자기 탑승하게 되면 눌러서 탑승으로" - 오늘
  // 요일에 안 타는 학생도 명단에 넣되, ridingToday=false로 표시해 회색으로 보여줍니다. 탑승 상태를
  // 저장할 수 있어야 하므로 오늘 탑승 기록도 전체 배정에 대해 함께 조회합니다.
  const allAssignmentIds = assignmentsData.map((a) => a.id);
  const boardingsRes = allAssignmentIds.length
    ? await supabase
        .from("shuttle_boardings")
        .select("assignment_id, status, override_route_id")
        .eq("service_date", today)
        .in("assignment_id", allAssignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null }[] };
  const boardingByAssignment = new Map((boardingsRes.data ?? []).map((b) => [b.assignment_id, b]));

  // 요청: "이제 토들도 가져오니까 하원체크표에 오늘픽업 결석에 여기도 반영" - 토들·전화·구글챗으로
  // 들어온 오늘 픽업/결석(pickup_requests)을 명단에 자동으로 얹습니다. 사람이 직접 누른 값이
  // 있으면 그걸 존중하고, 없을 때만 자동으로 채웁니다.
  const norm = (s: string) => (s ?? "").replace(/\s+/g, "").trim();
  const nameMatch = (a: string, b: string) => {
    const x = norm(a), y = norm(b);
    if (x.length < 2 || y.length < 2) return false;
    return x === y || x.includes(y) || y.includes(x);
  };
  const { data: preqRows } = await supabase
    .from("pickup_requests")
    .select("*")
    .eq("is_demo", false)
    .neq("status", "무시")
    .eq("service_date", today);
  const pickupNames: string[] = [];
  const absentNames: string[] = [];
  for (const r of preqRows ?? []) {
    const name = ((r.matched_name as string | null) ?? (r.ai_student_name as string | null) ?? "").trim();
    if (!name) continue;
    const text = ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString();
    const cat = categorize(text);
    if (r.kind === "픽업" || cat === "픽업") pickupNames.push(name);
    else if (cat === "결석") absentNames.push(name);
  }

  // 지속 특이사항(요청: 왼쪽 창구에 적으면 오른쪽에 요약으로 계속 뜨고, 차량 셔틀도 자동
  // 수정되며, 삭제하면 원래대로 복귀). 효과는 클라이언트에서 items에 덧씌우므로, 여기서는
  // 활성 행만 읽어 넘깁니다.
  const { data: noteRows } = await supabase
    .from("shuttle_persistent_notes")
    .select("id, term, student_name, student_id, route_no, content, effect_kind, effect_days, active")
    .eq("term", term)
    .eq("active", true)
    .order("created_at", { ascending: false });
  const persistentNotes: PersistentNote[] = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    studentName: (n.student_name as string) ?? "",
    studentId: (n.student_id as string | null) ?? null,
    routeNo: (n.route_no as string | null) ?? null,
    content: (n.content as string) ?? "",
    effectKind: (n.effect_kind as PersistentNote["effectKind"]) ?? "none",
    effectDays: (n.effect_days as number[] | null) ?? [],
  }));

  // 그룹핑은 클라이언트에서 하도록, 노선별로 나누지 않은 평평한 목록으로 넘깁니다.
  const items: ChecklistItem[] = assignmentsData
    .map((a) => {
      const stop = stopById.get(a.stop_id);
      if (!stop) return null;
      const boarding = boardingByAssignment.get(a.id);
      const ridingToday = a.weekdays.includes(todayWeekday);
      let status: ChecklistItem["status"] = (boarding?.status as ChecklistItem["status"]) ?? "예정";
      // 오늘 타는 학생 & 아직 사람이 안 누른 경우에만 토들 픽업/결석을 자동 반영.
      if (ridingToday && status === "예정") {
        if (pickupNames.some((n) => nameMatch(n, a.student_name_raw))) status = "픽업";
        else if (absentNames.some((n) => nameMatch(n, a.student_name_raw))) status = "결석";
      }
      const item: ChecklistItem = {
        assignmentId: a.id,
        studentId: a.student_id,
        studentName: a.student_name_raw,
        stopSeq: stop.seq,
        homeRouteId: stop.route_id,
        permanentRouteId: a.override_route_id && routeIdSet.has(a.override_route_id) ? a.override_route_id : null,
        overrideRouteId: boarding?.override_route_id ?? null,
        status,
        note: a.note ?? null,
        ridingToday,
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
  const { data: rosterData } = await supabase.from("wr_students_basic").select("name, grade, name_en").eq("status", "active");
  const roster = ((rosterData as { name: string; grade: string | null; name_en: string | null }[] | null) ?? []).map((s) => ({
    name: s.name,
    grade: s.grade,
    nameEn: s.name_en,
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-lg font-bold">📋 하원 체크표</h1>
        <GuideButton className="print:hidden flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[12px] font-bold text-slate-600 transition hover:bg-black/10" title="하원 체크표 사용 가이드" sections={GUIDE_SECTIONS} />
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
      <ShuttleChecklistClient routes={routes} items={items} roster={roster} initialMessages={(mirrorRes.data as GoogleChatMirrorMessage[] | null) ?? []} term={term} persistentNotes={persistentNotes} />
    </div>
  );
}
