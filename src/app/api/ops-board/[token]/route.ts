import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/shuttleTracking";
import { departmentOf, gradeSortKey, isVisibleDepartment, VISIBLE_DEPARTMENTS, type VisibleDepartment } from "@/lib/department";

export const dynamic = "force-dynamic";

// 사무실 대형 모니터에 띄우는 통합 운영 대시보드용 데이터입니다(요청: "업무 탭을 사무실
// 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드"). 로그인 없이
// 토큰 하나로 접속하므로 안내보드(shuttle-board)와 같은 방식으로 service role 키를 서버에서만
// 씁니다. 화면이 주기적으로 이 API를 다시 불러 하루 종일 자동으로 갱신됩니다.
//
// 한 번에 내려주는 것
//   ① 지금 몇 교시이고 각 반이 무슨 수업 중인지(+다음 교시)
//   ② 오늘의 결석·지각·조퇴 학생과 하원 픽업 학생
//   ③ 오늘 업무 요약(상태별 개수 + 오늘 마감/오늘 등록된 업무 목록)
//   ④ 지금이 하원 차량 화면으로 전환할 시각인지

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: link } = await supabase
    .from("ops_board_links")
    .select(
      "label, default_department, shuttle_switch_hour, shuttle_switch_minute, shuttle_end_hour, shuttle_end_minute, shuttle_board_token, enabled"
    )
    .eq("token", token)
    .maybeSingle();
  if (!link || !link.enabled) return NextResponse.json({ error: "유효하지 않거나 종료된 링크입니다." }, { status: 403 });

  // 화면에서 부서를 바꾸면 ?department=초등부 로 다시 부릅니다. 유치부는 별도 프로그램으로
  // 분리하기로 해서 이 대시보드에서는 고를 수 없습니다(요청: "유치부는 우선 분리해서 표면적으로는
  // 안보이게") - 링크 기본값이 유치부로 남아 있어도 초등부로 대신 엽니다.
  const requested = new URL(req.url).searchParams.get("department");
  const department: VisibleDepartment = isVisibleDepartment(requested)
    ? requested
    : isVisibleDepartment(link.default_department)
      ? (link.default_department as VisibleDepartment)
      : VISIBLE_DEPARTMENTS[0];

  const now = new Date();
  const { iso: today, weekday, hour } = kstParts(now);
  const minute = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMinutes();
  const nowMinutes = hour * 60 + minute;

  // ── ① 시간표 ────────────────────────────────────────────────────────────────
  const [{ data: periods }, { data: classes }] = await Promise.all([
    supabase.from("wr_periods").select("id, period_no, label, start_time, end_time").eq("department", department).order("start_time"),
    // is_demo=false - 신입교사 오리엔테이션용 가짜 반/학생은 사무실 대시보드에 절대 나오면
    // 안 됩니다. 이 API는 service role 키로 조회해서 DB 보안규칙을 통과해버리므로(로그인 없는
    // 토큰 링크라 그래야 합니다), 여기서는 조건을 직접 붙여 걸러냅니다.
    supabase.from("wr_classes").select("id, grade, class_name, department").eq("is_demo", false).order("grade").order("class_name"),
  ]);

  const deptClasses = (classes ?? [])
    .filter((c) => departmentOf(c) === department)
    .sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || (a.class_name ?? "").localeCompare(b.class_name ?? "", "ko"));
  const classIds = deptClasses.map((c) => c.id);

  function toMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  }

  const periodList = (periods ?? []).map((p) => ({
    id: p.id as string,
    periodNo: p.period_no as number,
    label: (p.label as string | null) ?? `${p.period_no}교시`,
    startTime: (p.start_time as string).slice(0, 5),
    endTime: (p.end_time as string).slice(0, 5),
  }));

  const currentPeriod = periodList.find((p) => nowMinutes >= toMinutes(p.startTime) && nowMinutes < toMinutes(p.endTime)) ?? null;
  const nextPeriod = periodList.find((p) => toMinutes(p.startTime) > nowMinutes) ?? null;

  // 주말이면 시간표가 없으므로 조회 자체를 건너뜁니다(weekday 0=일, 6=토).
  const isWeekday = weekday >= 1 && weekday <= 5;
  const periodIds = [currentPeriod?.id, nextPeriod?.id].filter(Boolean) as string[];
  const { data: timetable } =
    isWeekday && classIds.length > 0 && periodIds.length > 0
      ? await supabase
          .from("wr_timetable")
          .select("class_id, period_id, subject_name, teacher_name, room")
          .in("class_id", classIds)
          .eq("weekday", weekday)
          .in("period_id", periodIds)
      : { data: [] as { class_id: string; period_id: string; subject_name: string; teacher_name: string | null; room: string | null }[] };

  const lessonByClassPeriod = new Map<string, { subjectName: string; teacherName: string | null; room: string | null }>();
  for (const t of timetable ?? []) {
    lessonByClassPeriod.set(`${t.class_id}|${t.period_id}`, {
      subjectName: t.subject_name,
      teacherName: t.teacher_name,
      room: t.room,
    });
  }

  // 요청: "각 학년과 반별로 어느수업이 진행되는지 뜨도록" - 학년 단위로 묶어서 내려줍니다.
  type Lesson = { subjectName: string; teacherName: string | null; room: string | null };
  const gradeGroups: { grade: string; classes: { id: string; className: string; current: Lesson | null; next: Lesson | null }[] }[] = [];
  for (const c of deptClasses) {
    const grade = (c.grade as string | null) ?? "";
    let group = gradeGroups.find((g) => g.grade === grade);
    if (!group) {
      group = { grade, classes: [] };
      gradeGroups.push(group);
    }
    group.classes.push({
      id: c.id as string,
      className: (c.class_name as string | null) ?? "",
      current: currentPeriod ? lessonByClassPeriod.get(`${c.id}|${currentPeriod.id}`) ?? null : null,
      next: nextPeriod ? lessonByClassPeriod.get(`${c.id}|${nextPeriod.id}`) ?? null : null,
    });
  }

  // ── ② 출결 + 픽업 ──────────────────────────────────────────────────────────
  const { data: students } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name, department")
    .eq("status", "active")
    .eq("is_demo", false);
  const deptStudents = (students ?? []).filter((s) => departmentOf(s) === department);
  const studentById = new Map((students ?? []).map((s) => [s.id, s]));
  const deptStudentIds = new Set(deptStudents.map((s) => s.id));

  const { data: attendance } = await supabase
    .from("attendance_records")
    .select("student_id, status, note, contacted_guardian")
    .eq("date", today)
    .neq("status", "출석");

  const absences = (attendance ?? [])
    .filter((a) => deptStudentIds.has(a.student_id))
    .map((a) => {
      const s = studentById.get(a.student_id);
      return {
        name: s?.name ?? "?",
        grade: s?.grade ?? null,
        className: s?.class_name ?? null,
        status: a.status as string,
        note: (a.note as string | null) ?? null,
        contacted: !!a.contacted_guardian,
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status, "ko") || a.name.localeCompare(b.name, "ko"));

  // 하원 픽업(부모님이 직접 데려가심)은 하원 체크표에서 찍힌 값입니다.
  const { data: boardings } = await supabase
    .from("shuttle_boardings")
    .select("assignment_id, status")
    .eq("service_date", today)
    .in("status", ["픽업", "결석"]);
  const pickupAssignmentIds = (boardings ?? []).filter((b) => b.status === "픽업").map((b) => b.assignment_id);
  const { data: pickupAssignments } = pickupAssignmentIds.length
    ? await supabase.from("shuttle_assignments").select("id, student_name_raw").in("id", pickupAssignmentIds)
    : { data: [] as { id: string; student_name_raw: string }[] };
  const pickups = (pickupAssignments ?? []).map((a) => a.student_name_raw).sort((a, b) => a.localeCompare(b, "ko"));

  // ── ③ 업무 요약 ────────────────────────────────────────────────────────────
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, department, due_at, priority, created_at")
    .is("archived_at", null)
    .is("deleted_at", null);

  const statusCounts: Record<string, number> = {};
  const todayTasks: {
    title: string;
    status: string;
    department: string | null;
    dueLabel: string | null;
    urgent: boolean;
    kind: "마감" | "지남" | "신규";
  }[] = [];
  for (const t of tasks ?? []) {
    statusCounts[t.status as string] = (statusCounts[t.status as string] ?? 0) + 1;
    // due_at은 시각까지 담긴 값이라 한국시간 기준 날짜로 바꿔서 오늘과 비교합니다.
    const dueIso = typeof t.due_at === "string" ? kstParts(new Date(t.due_at)).iso : null;
    const createdIso = typeof t.created_at === "string" ? kstParts(new Date(t.created_at)).iso : null;
    const overdue = !!dueIso && dueIso < today && t.status !== "완료";
    const dueToday = dueIso === today;
    const createdToday = createdIso === today;
    if (overdue || dueToday || createdToday) {
      todayTasks.push({
        title: t.title as string,
        status: t.status as string,
        department: (t.department as string | null) ?? null,
        dueLabel: dueIso,
        urgent: t.priority === "긴급",
        kind: overdue ? "지남" : dueToday ? "마감" : "신규",
      });
    }
  }
  // 기한이 지난 것 → 오늘 마감 → 오늘 등록 순으로, 같은 묶음 안에서는 긴급을 위로 올립니다.
  const kindOrder = { 지남: 0, 마감: 1, 신규: 2 } as const;
  todayTasks.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      Number(b.urgent) - Number(a.urgent) ||
      a.title.localeCompare(b.title, "ko")
  );

  // ── ④ 하원 차량 화면 전환 시각인지 ─────────────────────────────────────────
  // 전환 시각이 지나면 하원 운행 화면(지도 + 차량 체크)으로 바뀝니다. 예전에는 안내보드
  // 링크를 따로 골라야 전환됐지만, 이제 대시보드가 자체 하원 화면을 갖고 있어 별도 설정 없이
  // 시각만 지나면 전환됩니다.
  //
  // 종료 시각도 함께 봅니다(요청: "하원종료버튼을 누르거나 종료시간이 되면 다시 화면 되돌리게").
  // 예전에는 시작 시각만 있어서 한 번 하원 화면이 되면 자정까지 그대로 남아 있었습니다.
  // 종료 시각이 아직 DB에 반영되기 전이면 기본값(17:30)으로 계산해, 반영 전후 어느 쪽이든
  // 화면이 멈추지 않게 합니다.
  const switchMinutes = link.shuttle_switch_hour * 60 + link.shuttle_switch_minute;
  const endHour = (link as { shuttle_end_hour?: number }).shuttle_end_hour ?? 17;
  const endMinute = (link as { shuttle_end_minute?: number }).shuttle_end_minute ?? 30;
  const endMinutes = endHour * 60 + endMinute;
  // 종료 시각을 시작 시각보다 앞으로 잘못 넣어두면 하원 화면이 아예 뜨지 않게 되므로, 그런
  // 경우에는 종료 시각을 무시하고 예전처럼 "시작 시각 이후 계속"으로 둡니다.
  const shuttleMode = nowMinutes >= switchMinutes && (endMinutes <= switchMinutes || nowMinutes < endMinutes);

  return NextResponse.json({
    label: link.label,
    department,
    today,
    weekday,
    nowLabel: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    isWeekday,
    periods: periodList,
    currentPeriod,
    nextPeriod,
    // 요청: "각 학년과 반별로 어느수업이 진행되는지 뜨도록" - 학년으로 묶어서 내려주면
    // 화면에서 학년 제목 아래에 그 학년의 반들이 나란히 놓입니다.
    grades: gradeGroups,
    studentCount: deptStudents.length,
    absences,
    pickups,
    taskSummary: { statusCounts, todayTasks: todayTasks.slice(0, 20), todayTotal: todayTasks.length },
    shuttle: {
      mode: shuttleMode,
      boardToken: (link.shuttle_board_token as string | null) ?? null,
      switchLabel: `${String(link.shuttle_switch_hour).padStart(2, "0")}:${String(link.shuttle_switch_minute).padStart(2, "0")}`,
      endLabel: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
    },
  });
}
