import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { categorize, extractTargetDate, matchRosterStudents, todayKey, type RosterStudent } from "@/lib/attendanceDigest";
import { toKoreanDisplayName, type RosterEntry } from "@/lib/pickupParse";
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
    supabase
      .from("wr_classes")
      .select("id, grade, class_name, department, teacher_name, teacher_email, room")
      .eq("is_demo", false)
      .order("grade")
      .order("class_name"),
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
  const gradeGroups: {
    grade: string;
    classes: { id: string; className: string; homeroom: string | null; room: string | null; current: Lesson | null; next: Lesson | null }[];
  }[] = [];
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
      // 담임 이름 - 계정이 연결되기 전에는 명부에 적어둔 이름(teacher_name)을 그대로 보여줍니다.
      // 멀리서 보는 화면이라 "3학년 G3JU"보다 "G3JU · Ms. June"이 훨씬 빨리 읽힙니다.
      homeroom: (c.teacher_name as string | null) ?? null,
      room: (c.room as string | null) ?? null,
      current: currentPeriod ? lessonByClassPeriod.get(`${c.id}|${currentPeriod.id}`) ?? null : null,
      next: nextPeriod ? lessonByClassPeriod.get(`${c.id}|${nextPeriod.id}`) ?? null : null,
    });
  }

  // ── ② 출결 + 픽업 ──────────────────────────────────────────────────────────
  const { data: students } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade, class_name, department")
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

  type Absence = { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean };
  const absenceByKey = new Map<string, Absence>();

  // (1) 교사가 출결 화면에서 직접 입력한 것.
  for (const a of attendance ?? []) {
    if (!deptStudentIds.has(a.student_id)) continue;
    const s = studentById.get(a.student_id);
    absenceByKey.set(`${s?.name}-${a.status}`, {
      name: s?.name ?? "?",
      grade: s?.grade ?? null,
      className: s?.class_name ?? null,
      status: a.status as string,
      note: (a.note as string | null) ?? null,
      contacted: !!a.contacted_guardian,
    });
  }

  // (2) 구글챗 출결알림에서 뽑은 것.
  //
  // 요청: "출결,지각 상황 표시 안되는거 같아 구글에서 긁어오는데 문제가 있는지 확인해주고
  // 없다면 실시간으로 반영해줘"
  //
  // 원인: 대시보드는 attendance_records(교사가 직접 입력) 만 읽고 있었고, 구글챗 출결알림은
  // 그 표에 들어가지 않아 화면에 안 떴습니다. 그래서 여기서 미러 메시지를 같은 규칙으로
  // 파싱해 함께 올립니다. 업무 화면의 출결내역과 같은 로직(attendanceDigest)을 씁니다.
  const nowKst = new Date();
  const todayK = todayKey(nowKst);
  const scanFrom = new Date(nowKst.getTime() - 14 * 24 * 60 * 60 * 1000);
  const { data: mirror } = await supabase
    .from("google_chat_mirror_messages")
    .select("id, content, created_at_google, source_key")
    .eq("source_key", "attendance")
    .gte("created_at_google", scanFrom.toISOString())
    .order("created_at_google", { ascending: false })
    .limit(300);

  // 영문명까지 넘겨야 "Diane Lim 결석"처럼 영어로 온 출결도 대조됩니다(업무 화면 출결내역은
  // 이미 이렇게 합니다). 이게 빠져서 대시보드에만 안 떴습니다.
  const roster: RosterStudent[] = deptStudents.map((s) => ({
    name: (s.name as string) ?? "",
    grade: (s.grade as string | null) ?? null,
    nameEn: (s.name_en as string | null) ?? null,
  }));

  for (const m of mirror ?? []) {
    const content = (m.content as string | null) ?? "";
    const category = categorize(content);
    // 대시보드 출결 칸에는 결석·지각·조퇴만 올립니다(픽업은 아래 별도 칸에서 다룹니다).
    if (!category || category === "픽업") continue;
    const sentAt = new Date(m.created_at_google as string);
    const targetDate = extractTargetDate(content, sentAt) ?? todayKey(sentAt);
    if (targetDate !== todayK) continue; // 오늘 것만
    const matched = matchRosterStudents(content, roster);
    if (matched.length === 0) continue; // 이 부서 학생과 대조되지 않으면 넘어갑니다.
    for (const st of matched) {
      const key = `${st.name}-${category}`;
      // 교사가 이미 직접 입력한 학생이면 그 값을 존중하고 덮어쓰지 않습니다.
      if (absenceByKey.has(key)) continue;
      const full = deptStudents.find((s) => s.name === st.name);
      absenceByKey.set(key, {
        name: st.displayName,
        grade: st.grade,
        className: (full?.class_name as string | null) ?? null,
        status: category,
        note: null,
        contacted: false,
      });
    }
  }

  const absences = [...absenceByKey.values()].sort(
    (a, b) => a.status.localeCompare(b.status, "ko") || a.name.localeCompare(b.name, "ko")
  );

  // 하원 픽업(부모님이 직접 데려가심)은 하원 체크표에서 찍힌 값입니다.
  const { data: boardings } = await supabase
    .from("shuttle_boardings")
    .select("assignment_id, status")
    .eq("service_date", today)
    .in("status", ["픽업", "결석"]);
  const pickupAssignmentIds = (boardings ?? []).filter((b) => b.status === "픽업").map((b) => b.assignment_id);
  const { data: pickupAssignments } = pickupAssignmentIds.length
    ? await supabase.from("shuttle_assignments").select("id, student_id, student_name_raw").in("id", pickupAssignmentIds)
    : { data: [] as { id: string; student_id: string | null; student_name_raw: string }[] };
  // 요청: "꼭 이름만 뜨지않고 성까지 뜨도록" - 탑승표에 적힌 이름(성이 빠졌을 수 있음) 대신,
  // 학생 번호로 명부의 전체 이름(성+이름)을 씁니다. 같은 이름 아이를 성으로 구분합니다.
  const pickups = (pickupAssignments ?? [])
    .map((a) => {
      const full = a.student_id ? (studentById.get(a.student_id) as { name?: string } | undefined)?.name : null;
      return full || a.student_name_raw;
    })
    .sort((a, b) => a.localeCompare(b, "ko"));

  // ── 학부모 문의사항 ────────────────────────────────────────────────────────
  // 요청: "운영 대시보드에 이 학부모 문의사항도 띄워줘"
  //
  // 아직 답하지 않은 것만, 급한 것부터 올립니다. 이 화면은 사무실에서 멀찍이 두고 보는
  // 화면이라 "지금 손대야 할 것"만 보여야 합니다 - 처리된 것까지 섞이면 훑어보는 의미가
  // 없어집니다.
  // 문의 이름을 한글로 바꾸기 위한 전체 명부(부서 무관). 학부모 채널 이름이 영어라
  // "Diane & Sunwoo Lim"으로 뜨는 것을 "임다이앤 & 임선우"로 바꿔줍니다.
  const { data: allRoster } = await supabase
    .from("wr_students")
    .select("id, name, name_en, grade")
    .eq("status", "active")
    .eq("is_demo", false);
  const nameRoster: RosterEntry[] = (allRoster ?? []).map((s) => ({
    id: s.id as string,
    name: (s.name as string) ?? "",
    name_en: (s.name_en as string | null) ?? null,
    grade: (s.grade as string | null) ?? null,
  }));

  const { data: inquiryRows } = await supabase
    .from("pickup_requests")
    // 칸을 콕 집어 달라고 하면, 마이그레이션이 아직 안 걸린 동안 조회가 통째로 실패해
    // 대시보드가 오류 화면이 됩니다. 전부 달라고 하면 있는 것만 돌아옵니다.
    .select("*")
    .eq("kind", "문의")
    .is("answered_at", null)
    .gte("received_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .order("received_at", { ascending: false })
    .limit(40);

  const inquiries = (inquiryRows ?? [])
    .map((r) => ({
      id: r.id as string,
      student:
        toKoreanDisplayName(
          (r.matched_name as string | null) ?? (r.ai_student_name as string | null),
          r.channel_label as string | null,
          nameRoster
        ) ??
        (r.channel_label as string | null) ??
        "미확인",
      type: (r.inquiry_type as string | null) ?? null,
      summary: (r.summary as string | null) ?? "",
      urgent: r.urgency === "높음",
      at: r.received_at as string,
      // 답글이 달렸지만 아직 처리로 넘기지 않은 건. 이름 뒤에 초록 체크가 붙습니다.
      replied: !!r.replied_at,
      // 터치하면 토들 원문으로 바로 갈 수 있게(요청: "터치가능하게").
      url: (r.source_url as string | null) ?? null,
      // 짧게 누르면 작은 창에 이 원문을 보여줍니다(요청). 토들에 다시 접속하지 않아도 됩니다.
      raw: (r.raw_text as string | null) ?? (r.summary as string | null) ?? null,
      channel: (r.channel_label as string | null) ?? null,
    }))
    // 요청: "예전문의보다 최근문의가 위로 올라오게" - 급한 것 우선이 아니라 순수 최신순으로
    // 둡니다. 급한 것은 화면에서 빨간 테두리로 이미 구분되므로, 위에 올릴 필요까지는 없습니다.
    .sort((a, b) => b.at.localeCompare(a.at));

  // 수집기가 살아 있는지.
  //
  // 요청: "토들을 이제 긁어오기때문에 실시간으로 토들긁어오는거 반영해줘"
  // 문의가 안 뜨는 것이 "문의가 없어서"인지 "수집기가 멈춰서"인지는 전혀 다른 얘기인데,
  // 화면에는 똑같이 비어 보입니다. 그래서 마지막 신호 시각을 함께 내려보내 5분 넘게
  // 소식이 없으면 화면에 빨갛게 알립니다.
  const { data: hb } = await supabase
    .from("integration_heartbeats")
    .select("last_seen_at, status, detail")
    .eq("key", "toddle-collector")
    .maybeSingle();

  const lastSeen = (hb?.last_seen_at as string | null) ?? null;
  const collector = {
    lastSeen,
    status: (hb?.status as string | null) ?? null,
    stale: !lastSeen || Date.now() - new Date(lastSeen).getTime() > 5 * 60 * 1000,
  };

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
    // 지금 서버에 올라가 있는 앱 버전.
    //
    // 이 화면은 공용 모니터에 며칠씩 그대로 켜져 있습니다. 그래서 새 버전을 배포해도 화면은
    // 예전 코드를 계속 씁니다 - 누군가 가서 F5를 눌러야 바뀝니다. 화면 쪽에서 이 값을 자기
    // 버전과 견주어 보고, 다르면 스스로 새로고침합니다.
    appVersion: APP_VERSION,
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
    inquiries,
    collector,
    taskSummary: { statusCounts, todayTasks: todayTasks.slice(0, 20), todayTotal: todayTasks.length },
    shuttle: {
      mode: shuttleMode,
      boardToken: (link.shuttle_board_token as string | null) ?? null,
      switchLabel: `${String(link.shuttle_switch_hour).padStart(2, "0")}:${String(link.shuttle_switch_minute).padStart(2, "0")}`,
      endLabel: `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`,
    },
  });
}
