import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import Link from "next/link";
import ShuttleChecklistClient, { type ChecklistRoute, type ChecklistItem, type PersistentNote, type AutoSource } from "@/components/shuttle/ShuttleChecklistClient";
import type { GoogleChatMirrorMessage } from "@/lib/types";
import { categorize } from "@/lib/attendanceDigest";
import GuideButton from "@/components/common/GuideButton";
import ChecklistSubTabs from "@/components/shuttle/ChecklistSubTabs";

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
    .select("id, route_no, name, driver_name, driver_phone, vehicle_no")
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

  // 예전에는 PDF에서 통째로 들어온 배정(유치부 포함)을 초등부 명부+허용목록으로 걸러냈지만,
  // 하원 명단 재세팅(v0.228, 사용자 원문 1-1호~31호 그대로) 이후에는 shuttle_assignments 자체가
  // 확정 명단입니다. 필터를 걸면 오히려 구분표기 이름(김재이(G2A)·이준서(중등)·에이바(일라이아나)
  // 등)이 명부 이름과 달라 떨어져 나가므로, 배정된 학생을 전부 그대로 보여줍니다(요청: "내가
  // 보내준 정규학기 하원명단하고 달라 체크해서 반영해줘").

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
        .select("assignment_id, status, override_route_id, checked_by, updated_by, checked_at")
        .eq("service_date", today)
        .in("assignment_id", allAssignmentIds)
    : { data: [] as { assignment_id: string; status: string; override_route_id: string | null; checked_by: string | null; updated_by: string | null; checked_at: string | null }[] };
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
  // 이름만 뽑지 않고 **어느 연락에서 왔는지**를 함께 들고 갑니다.
  //
  // 담당자: "픽업 처리된 애들 어떤 토들이나 구글챗으로 분류되었는지 (...) 자동으로
  //          분류되는 거 이유가 뭔지 보고 싶어."
  //
  // 지금까지는 이름만 넘겨서, 표에 사선이 그어진 이유를 확인하려면 인박스로 넘어가
  // 그 아이를 다시 찾아야 했습니다. 근거가 결과 옆에 없으면 사람은 결과를 못 믿습니다.
  const pickupNames: string[] = [];
  const absentNames: string[] = [];
  const autoSourceByName = new Map<string, AutoSource>();
  for (const r of preqRows ?? []) {
    const name = ((r.matched_name as string | null) ?? (r.ai_student_name as string | null) ?? "").trim();
    if (!name) continue;
    const text = ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString();
    const cat = categorize(text);
    const isPickup = r.kind === "픽업" || cat === "픽업";
    const isAbsent = !isPickup && cat === "결석";
    if (!isPickup && !isAbsent) continue;
    if (isPickup) pickupNames.push(name);
    else absentNames.push(name);
    // 같은 아이에게 여러 연락이 왔으면 가장 최근 것을 씁니다.
    const prev = autoSourceByName.get(norm(name));
    const at = (r.received_at as string | null) ?? "";
    if (prev && prev.receivedAt >= at) continue;
    autoSourceByName.set(norm(name), {
      requestId: r.id as string,
      kind: isPickup ? "픽업" : "결석",
      source: (r.source as string | null) ?? "토들",
      channelLabel: (r.channel_label as string | null) ?? null,
      senderName: (r.sender_name as string | null) ?? null,
      receivedAt: at,
      rawText: text,
      aiNote: (r.ai_note as string | null) ?? null,
      matchedName: (r.matched_name as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      sourceChatId: (r.source_chat_id as string | null) ?? null,
    });
  }

  // 토들 주소는 "학교 주소 + /messaging/ + 방 id" 형태입니다. 주소 칸이 비어 있는 줄이
  // 많아서(수집기가 못 읽은 경우), 주소가 있는 가장 최근 기록 하나에서 학교 주소만 뽑아
  // 나머지에 그대로 씁니다 - 학부모 문의사항 화면과 같은 방식입니다.
  const { data: baseRow } = await supabase
    .from("pickup_requests")
    .select("source_url")
    .not("source_url", "is", null)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const toddleBase =
    ((baseRow?.source_url as string | null) ?? "").match(/^(https:\/\/[^/]+\/platform\/[^/]+)/)?.[1] ?? null;

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
      //
      // 판단 기준은 **줄이 있는지**이지 값이 '예정'인지가 아닙니다.
      // 담당자: "잘못 표기된 애들 더블클릭하면 다시 돌아오게 해줘 (...) 지우면 전부 반영되게."
      // 되돌리기는 '예정' 줄을 남기는 방식인데, 값만 보면 그게 "아무도 안 누름"과 똑같이 보여
      // 다음에 화면을 열 때 자동 표시가 되살아납니다. 사람이 되돌린 것을 기계가 다시 뒤집는
      // 셈이라, 줄이 하나라도 있으면 사람 판단으로 봅니다.
      let autoSource: AutoSource | null = null;

      // 사람이나 크론이 찍은 경우에도 **근거를 남깁니다.**
      //
      // 담당자: "자동으로 체크한 애들 전부 다, 그 체크한 근거를 볼 수 있도록."
      //
      // 예전에는 토들에서 자동으로 붙은 것만 근거가 있었습니다. 그런데 아침 크론이
      // 지속 특이사항·예약 픽업으로 찍어놓은 것도 "누가 왜 찍었는지" 모르기는 마찬가지입니다.
      // 표에 사선이 그어져 있는데 이유를 모르면, 결국 사람이 전화로 확인하게 됩니다.
      if (boarding && (boarding.status === "픽업" || boarding.status === "결석")) {
        const who = (boarding.updated_by as string | null) ?? (boarding.checked_by as string | null) ?? "";
        autoSource = {
          requestId: "",
          kind: boarding.status as "픽업" | "결석",
          source: who || "사람",
          channelLabel: null,
          senderName: who || null,
          receivedAt: (boarding.checked_at as string | null) ?? "",
          rawText: who.includes("AI") || who.includes("자동")
            ? `${who}이(가) 오늘 ${boarding.status}으로 표시했습니다.`
            : `${who || "담당자"}가 체크표에서 ${boarding.status}으로 표시했습니다.`,
          aiNote: null,
          matchedName: a.student_name_raw,
          sourceUrl: null,
          sourceChatId: null,
        };
      }

      if (ridingToday && !boarding) {
        const hit = (list: string[]) => list.find((n) => nameMatch(n, a.student_name_raw));
        const p = hit(pickupNames);
        const b = p ? null : hit(absentNames);
        if (p) {
          status = "픽업";
          autoSource = autoSourceByName.get(norm(p)) ?? null;
        } else if (b) {
          status = "결석";
          autoSource = autoSourceByName.get(norm(b)) ?? null;
        }
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
        weekdays: a.weekdays ?? [],
        autoSource,
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
  const { data: rosterData } = await supabase.from("wr_students_basic").select("name, grade, name_en, birth_date, class_name").eq("status", "active");
  const roster = ((rosterData as { name: string; grade: string | null; name_en: string | null; birth_date: string | null; class_name: string | null }[] | null) ?? []).map((s) => ({
    name: s.name,
    grade: s.grade,
    nameEn: s.name_en,
    birthDate: s.birth_date,
    // 동명이인을 화면에 "김재이(G3JA)"로 보여주려면 반이 있어야 합니다(담당자 요청).
    className: s.class_name,
  }));

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 print:max-w-none print:p-0">
      <ChecklistSubTabs />
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
      <ShuttleChecklistClient routes={routes} items={items} roster={roster} initialMessages={(mirrorRes.data as GoogleChatMirrorMessage[] | null) ?? []} term={term} persistentNotes={persistentNotes} toddleBase={toddleBase} />
    </div>
  );
}
