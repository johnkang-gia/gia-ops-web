import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { categorize, extractTargetDate, matchRosterStudents, todayKey, type RosterStudent } from "@/lib/attendanceDigest";
import { loadActiveEntries } from "@/lib/attendanceEntries";
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
    .select("id, name, name_en, grade, class_name, department, birth_date")
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
    birthDate: (s.birth_date as string | null) ?? null,
  }));

  // (2-a) 행정실이 등록한 출결(attendance_entries) - 기간이 오늘을 품는 것만.
  //
  // 이게 이제 **구글챗·토들에서 온 출결의 유일한 통로**입니다.
  //
  // 예전에는 아래에서 구글챗 메시지를 매번 다시 파싱해 올렸는데, 원본 메시지에는 "처리했다"는
  // 개념이 없어서 업무보드에서 아무리 지워도 다음 새로고침에 되살아났습니다
  // (담당자: "기존게 계속 남아있어"). 지울 자리가 없었던 게 원인이라, 등록 여부를 담는 표를
  // 따로 두고 대시보드는 그 표만 보게 했습니다. 지우면 지워진 채로 남습니다.
  for (const e of await loadActiveEntries(supabase, todayK)) {
    if (e.status === "픽업") continue; // 픽업은 아래 별도 칸에서 다룹니다.
    const sid = e.student_id as string | null;
    // 이 대시보드가 맡은 부서 학생이 아니면 올리지 않습니다.
    if (sid ? !deptStudentIds.has(sid) : !deptStudents.some((s) => s.name === e.student_name)) continue;
    const key = `${e.student_name}-${e.status}`;
    if (absenceByKey.has(key)) continue; // 선생님이 직접 입력한 값을 덮어쓰지 않습니다.
    absenceByKey.set(key, {
      name: e.student_name as string,
      grade: (e.grade as string | null) ?? null,
      className: (e.class_name as string | null) ?? null,
      status: e.status as string,
      note: (e.note as string | null) ?? null,
      contacted: false,
    });
  }

  // 구글챗 메시지를 여기서 직접 파싱하던 자리였습니다. 위 (2-a)로 옮겼습니다 - 원본을 매번
  // 다시 읽는 방식으로는 "처리했음"을 남길 데가 없어, 업무보드에서 지운 것이 계속 되살아났습니다.

  // (3) 학부모 문의(pickup_requests)에서 온 픽업.
  //
  // 요청: "문의에서도 결석이나, 픽업 등 다 올라오는데 결석은 아직도 업무 대시보드에 1로 떠
  // 픽업은 심지어 0이야 제대로 반영해줘".
  //
  // 원인: 결석 칸은 attendance_records + 구글챗 미러만, 픽업 칸은 하원 체크표(shuttle_boardings)
  // 만 읽고 있었습니다. 그런데 토들로 들어온 학부모 연락은 pickup_requests에 쌓일 뿐 두 곳
  // 어디에도 들어가지 않아, 문의 목록엔 떠도 결석·픽업 숫자엔 반영되지 않았습니다. 그래서
  // 여기서 pickup_requests도 같은 규칙(categorize + 명부대조)으로 함께 집계합니다.
  const pickupNamesFromReq = new Set<string>();
  const { data: reqRows } = await supabase
    .from("pickup_requests")
    .select("*")
    .neq("status", "무시")
    .gte("received_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order("received_at", { ascending: false })
    .limit(400);

  for (const r of reqRows ?? []) {
    if (r.is_demo) continue; // 데모 연습용 문의는 실제 대시보드 집계에서 제외.
    const text = ((r.raw_text as string | null) ?? (r.summary as string | null) ?? "").toString();
    const category = categorize(text);
    // kind='픽업'은 AI가 이미 픽업으로 확정한 건이라, 본문에 픽업 키워드가 없어도 픽업으로 봅니다.
    const treatAsPickup = r.kind === "픽업" || category === "픽업";
    // 결석·지각은 여기서 다루지 않습니다 - attendance_entries(2-a)를 거쳐야 지운 것이 지워진
    // 채로 남습니다. 이 칸은 픽업만 맡습니다.
    if (!treatAsPickup) continue;

    const receivedAt = new Date((r.received_at as string) ?? Date.now());
    // 대상 날짜: 본문에 적힌 날짜(내일·금요일 등) > AI가 계산한 service_date > 받은 날.
    const targetDate =
      extractTargetDate(text, receivedAt) ?? ((r.service_date as string | null) ?? todayKey(receivedAt));
    if (targetDate !== todayK) continue; // 오늘 것만

    // 학생 확정: AI가 명부와 연결해둔 student_id를 최우선으로 씁니다(가장 정확). 이 부서 학생이
    // 아니면 이 대시보드에는 올리지 않습니다. 연결이 없으면 본문을 명부와 대조해 찾습니다.
    type R = { name: string; grade: string | null; className: string | null; display: string };
    const resolved: R[] = [];
    const sid = r.student_id as string | null;
    if (sid && deptStudentIds.has(sid)) {
      const s = studentById.get(sid) as { name?: string; grade?: string | null; class_name?: string | null } | undefined;
      if (s?.name) resolved.push({ name: s.name, grade: s.grade ?? null, className: s.class_name ?? null, display: s.name });
    }
    if (resolved.length === 0) {
      for (const st of matchRosterStudents(text, roster)) {
        const full = deptStudents.find((s) => s.name === st.name);
        resolved.push({ name: st.name, grade: st.grade, className: (full?.class_name as string | null) ?? null, display: st.displayName });
      }
    }
    if (resolved.length === 0) continue;

    for (const st of resolved) pickupNamesFromReq.add(st.display);
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
  const boardingPickups = (pickupAssignments ?? []).map((a) => {
    const full = a.student_id ? (studentById.get(a.student_id) as { name?: string } | undefined)?.name : null;
    return full || a.student_name_raw;
  });
  // 하원 체크표 픽업 + 문의로 들어온 픽업을 합치고, 같은 이름은 한 번만 셉니다.
  const pickups = [...new Set([...boardingPickups, ...pickupNamesFromReq])].sort((a, b) => a.localeCompare(b, "ko"));

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
    .filter((r) => !r.is_demo) // 데모 연습용 문의 제외.
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
  // ── 야간/하원 이후 정보(요청: "하원시간이 되면 시간표 자리 (...) 학교 정보 그리고 학사일정
  // 달력을 보이게") ────────────────────────────────────────────────────────────
  // 다가오는 학사일정과 이번 주 위클리 리포트 작성 건수를 함께 내려, 저녁~다음날 아침에는
  // 시간표 대신 이 정보를 보여줍니다.
  const sinceWeek = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [{ data: eventRows }, reportsCountRes] = await Promise.all([
    supabase.from("events").select("date, name").gte("date", today).order("date", { ascending: true }).limit(12),
    supabase.from("wr_reports").select("id", { count: "exact", head: true }).eq("status", "published").gte("report_date", sinceWeek),
  ]);
  const nightInfo = {
    events: (eventRows ?? []).map((e) => ({ date: e.date as string, name: e.name as string })),
    reportsThisWeek: reportsCountRes.count ?? 0,
  };

  const switchMinutes = link.shuttle_switch_hour * 60 + link.shuttle_switch_minute;
  const endHour = (link as { shuttle_end_hour?: number }).shuttle_end_hour ?? 17;
  const endMinute = (link as { shuttle_end_minute?: number }).shuttle_end_minute ?? 30;
  const endMinutes = endHour * 60 + endMinute;
  // 종료 시각을 시작 시각보다 앞으로 잘못 넣어두면 하원 화면이 아예 뜨지 않게 되므로, 그런
  // 경우에는 종료 시각을 무시하고 예전처럼 "시작 시각 이후 계속"으로 둡니다.
  const shuttleMode = nowMinutes >= switchMinutes && (endMinutes <= switchMinutes || nowMinutes < endMinutes);

  // 서버 쪽에서도 캐시를 막습니다. dynamic = "force-dynamic"은 "이 라우트를 미리 만들어두지
  // 말라"는 뜻일 뿐, 만들어진 응답이 CDN·브라우저에 캐시되는 것까지 막아주지는 않습니다.
  // 늘 같은 주소로 오는 요청이라 한 번 캐시되면 처리한 문의가 계속 남아 보입니다.
  return NextResponse.json(
    {
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
    nightInfo,
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
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
