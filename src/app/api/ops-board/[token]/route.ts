import { NextResponse } from "next/server";
import { checkRevision, parseSince } from "@/lib/boardRevision";
import { cached } from "@/lib/ttlCache";
import { APP_VERSION } from "@/lib/version";
import { buildStaffNames, categorize, extractTargetDate, matchRosterStudents, todayKey, type RosterStudent } from "@/lib/attendanceDigest";
import { loadActiveEntries, loadUpcomingEntries } from "@/lib/attendanceEntries";
import { markIfAmbiguous, toKoreanDisplayName, toRosterEntries, ROSTER_SELECT, type RosterEntry } from "@/lib/pickupParse";
import { loadTodayPickups } from "@/lib/pickups";
import { displayInquiryType } from "@/lib/inquiryType";
import { createClient } from "@supabase/supabase-js";
import { kstParts } from "@/lib/shuttleTracking";
import { departmentOf, gradeSortKey, isVisibleDepartment, VISIBLE_DEPARTMENTS, type VisibleDepartment } from "@/lib/department";
import { loadDismissalForDay, DISMISSAL_SELECT, isMissingWeekStart, type DismissalRow } from "@/lib/dismissalToday";
import { addDays, nextWeekStart, weekStartOf } from "@/lib/dismissalWeek";

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
  // ── 바뀌었는지부터 물어봅니다 ─────────────────────────────────────────────
  //
  // 이 화면은 30초마다 스스로 다시 물어보는데, 그 30초 동안 **대부분 아무것도 안 바뀝니다.**
  // 그런데도 명부·반·교시·시간표·출결·픽업·체크표·쪽지·문의·업무를 매번 통째로 다시
  // 읽고 계산했습니다.
  //
  // 이제 화면이 자기가 들고 있는 번호를 함께 보냅니다. 번호가 같으면 여기서 **한 줄만
  // 읽고 바로 돌아갑니다** - 아래 계산은 시작조차 하지 않습니다.
  //
  // 번호를 올리는 일은 자료를 바꾸는 쪽이 합니다. 코드가 아니라 표에 걸린 트리거가 하므로
  // 빠뜨릴 수가 없습니다(20260916000000_board_revisions.sql).
  const requested = new URL(req.url).searchParams.get("department");
  const department: VisibleDepartment = isVisibleDepartment(requested)
    ? requested
    : isVisibleDepartment(link.default_department)
      ? (link.default_department as VisibleDepartment)
      : VISIBLE_DEPARTMENTS[0];

  const rev = await checkRevision(supabase, "ops", parseSince(req.url), department);
  if (!rev.stale) {
    // **여기서 끝냅니다.** 화면은 들고 있던 것을 그대로 쓰면 됩니다.
    return NextResponse.json(
      { unchanged: true, revision: rev.revision },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }

  const now = new Date();
  const { iso: today, weekday, hour } = kstParts(now);
  const minute = new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCMinutes();
  const nowMinutes = hour * 60 + minute;

  // ── ① 시간표 ────────────────────────────────────────────────────────────────
  const [{ data: periods }, { data: classes }] = await Promise.all([
    // 교시·반·명부는 **30초마다 바뀔 것이 아닙니다.** 잠깐 들고 있습니다(ttlCache).
    cached(`periods:${department}`, async () =>
      supabase.from("wr_periods").select("id, period_no, label, start_time, end_time").eq("department", department).order("start_time"),
    ),
    // is_demo=false - 신입교사 오리엔테이션용 가짜 반/학생은 사무실 대시보드에 절대 나오면
    // 안 됩니다. 이 API는 service role 키로 조회해서 DB 보안규칙을 통과해버리므로(로그인 없는
    // 토큰 링크라 그래야 합니다), 여기서는 조건을 직접 붙여 걸러냅니다.
    cached("classes", async () =>
      supabase
        .from("wr_classes")
        .select("id, grade, class_name, department, teacher_name, teacher_email, room")
        .eq("is_demo", false)
        .order("grade")
        .order("class_name"),
    ),
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
  // ── 명부는 **한 번만** 읽습니다 ───────────────────────────────────────
  //
  // 예전에는 여기서 한 번(재학생), 아래 문의 이름을 한글로 바꾸는 데서 또 한 번(재학+보류)
  // 읽었습니다. 같은 137명을 30초마다 두 벌씩 실어 날랐습니다. 넓은 쪽으로 한 번 읽고
  // 좁은 쪽은 걸러 씁니다.
  const { data: everyone } = await cached("students:all", async () =>
    supabase
      .from("wr_students")
      .select("id, name, name_en, grade, class_name, department, birth_date, status")
      .in("status", ["active", "보류"])
      .eq("is_demo", false),
  );
  const students = (everyone ?? []).filter((s) => s.status === "active");
  const deptStudents = students.filter((s) => departmentOf(s) === department);
  const studentById = new Map(students.map((s) => [s.id, s]));
  // 부서를 가리지 않은 전체 명부 이름. 「이 이름이 다른 부서 아이인가, 아예 못 찾는 이름인가」를
  // 가르는 데 씁니다 - 둘을 같이 다루면 다른 부서 아이가 이 화면에 겹쳐 뜹니다.
  const allStudentNames = new Set(students.map((s) => (s.name as string) ?? "").filter(Boolean));
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

  // 멘션(@…)을 지울 때 쓸 교직원 성함.
  //
  // 담당자: "@Carina Ann John까지가 이름인데 carina ann까지만 읽어서 john이 요한이로 매칭돼."
  // 낱말 수로는 "@Janelle Story Maya"(마야는 학생)와 구별할 수 없습니다. 실제 성함인지가
  // 유일한 근거라, 계정 명단을 그대로 씁니다 - 선생님이 오시면 저절로 반영됩니다.

  // ── 여기서 구글챗 원문을 읽던 자리 ──────────────────────────────────────
  //
  // 14일치 메시지 300건의 **본문을 통째로** 읽고 있었습니다. 그런데 파싱은 이미 위
  // (2-a)로 옮겨져서, **읽어놓고 아무 데도 안 쓰고 버렸습니다.** 교직원 명단(app_users)도
  // 그 파싱에만 쓰이던 것이라 같이 죽어 있었습니다.
  //
  // 이 화면은 30초마다 스스로 다시 물어봅니다. 하루 1,500번 넘게 쓰지도 않을 메시지
  // 본문을 실어 나른 셈이고, 그게 Supabase 무료 한도(월 5GB)를 거의 통째로 먹었습니다.
  // 안 쓰는 조회는 느려지는 것으로도 안 보이고 오류로도 안 보입니다 - 청구서에만 보입니다.

  // 영문명까지 넘겨야 "Diane Lim 결석"처럼 영어로 온 출결도 대조됩니다(업무 화면 출결내역은
  // 이미 이렇게 합니다). 이게 빠져서 대시보드에만 안 떴습니다.
  const roster: RosterStudent[] = deptStudents.map((s) => ({
    name: (s.name as string) ?? "",
    grade: (s.grade as string | null) ?? null,
    nameEn: (s.name_en as string | null) ?? null,
    birthDate: (s.birth_date as string | null) ?? null,
    className: (s.class_name as string | null) ?? null,
  }));

  // (2-a) 행정실이 등록한 출결(attendance_entries) - 기간이 오늘을 품는 것만.
  //
  // 이게 이제 **구글챗·토들에서 온 출결의 유일한 통로**입니다.
  //
  // 예전에는 아래에서 구글챗 메시지를 매번 다시 파싱해 올렸는데, 원본 메시지에는 "처리했다"는
  // 개념이 없어서 업무보드에서 아무리 지워도 다음 새로고침에 되살아났습니다
  // (담당자: "기존게 계속 남아있어"). 지울 자리가 없었던 게 원인이라, 등록 여부를 담는 표를
  // 따로 두고 대시보드는 그 표만 보게 했습니다. 지우면 지워진 채로 남습니다.
  //
  // 픽업은 여기서 다루지 않습니다 - 갈래가 셋이라 `loadTodayPickups` 한 곳에서 정합니다.
  for (const e of await loadActiveEntries(supabase, todayK)) {
    if (e.status === "픽업") continue;
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

  // ── 오늘 픽업 ──────────────────────────────────────────────────────────────
  //
  // 픽업은 **들어오는 길이 셋인데 도착하는 표도 셋**입니다(학부모 연락 · 출결내역 등록 ·
  // 체크표 클릭). 이 자리에서 그중 둘만 읽고 있어서, 출결내역에서 등록한 픽업이 끝내
  // 안 떴습니다. 화면마다 다른 조합을 읽으면 답도 화면마다 달라집니다.
  //
  // 이제 `loadTodayPickups` 한 곳에서만 정합니다. 「사람이 체크표에서 정한 것이 이긴다」는
  // 규칙도 거기 한 벌만 있습니다 - 두 벌로 만들면 한쪽만 고치고 다른 쪽을 잊습니다.
  const allPickups = await loadTodayPickups(
    supabase,
    todayK,
    (sid) => ((studentById.get(sid) as { name?: string } | undefined)?.name ?? null),
  );

  const absences = [...absenceByKey.values()].sort(
    (a, b) => a.status.localeCompare(b.status, "ko") || a.name.localeCompare(b.name, "ko")
  );

  // ── 예정된 변동사항 ────────────────────────────────────────────────────────
  //
  // 「이연우 9/21~23 결석」처럼 미리 알려온 것은 등록만 되어 있고, 그날이 와야 화면에 뜹니다.
  // 그때까지는 아무 데도 안 보여서 정작 그날 아침에 «몰랐다»가 됩니다. 며칠 전부터 눈에
  // 담아둘 수 있도록 오늘 명단 위에 세웁니다. 시작일이 지나면 저절로 오늘 명단으로 넘어가고
  // 여기서는 빠집니다 - 지우는 일을 사람이 하지 않습니다.
  const upcoming = (await loadUpcomingEntries(supabase, todayK))
    .filter((e) => {
      const sid = e.student_id as string | null;
      return sid ? deptStudentIds.has(sid) : deptStudents.some((s) => s.name === e.student_name);
    })
    .map((e) => ({
      name: e.student_name as string,
      status: e.status as string,
      from: e.date_from as string,
      to: e.date_to as string,
      note: (e.note as string | null) ?? null,
    }));

  // 반까지 함께 보냅니다. 시각이 됐을 때 행정실이 실제로 하는 일은 «교실에 가서 데려오기»라,
  // 이름만으로는 움직일 수 없습니다 - 어느 반이 지금 어느 교실에서 무슨 수업 중인지까지
  // 알아야 합니다. 반 id 가 있으면 화면이 시간표에서 그 반의 지금 수업을 바로 찾습니다.
  //
  // **번호로 찾습니다.** 이름을 열쇠로 한 지도는 김재이 셋이 한 칸을 나눠 쓰게 만들어,
  // 마지막에 넣은 한 명의 반이 셋 모두에게 붙습니다(CLAUDE.md 2-4). 번호가 없는 옛 줄만
  // 이름으로 찾고, 그때도 **그 이름이 한 명뿐일 때만** 답합니다 - 겹치는 이름인데 번호가
  // 없으면 반을 비워 두는 편이 엉뚱한 반을 적는 것보다 낫습니다.
  type Where = { grade: string | null; className: string | null };
  const whereById = new Map<string, Where>();
  const whereByName = new Map<string, Where | null>();
  for (const s of deptStudents) {
    const w: Where = { grade: (s.grade as string | null) ?? null, className: (s.class_name as string | null) ?? null };
    whereById.set(s.id as string, w);
    const nm = (s.name as string) ?? "";
    whereByName.set(nm, whereByName.has(nm) ? null : w);
  }
  /** 이 이름이 부서 명부에 둘 이상 있는가. 겹치면 화면이 반을 반드시 붙입니다. */
  const homonymNames = new Set([...whereByName.entries()].filter(([, w]) => w === null).map(([n]) => n));
  const classByName = new Map([...whereByName.entries()].filter(([, w]) => !!w) as [string, Where][]);
  const classIdByGradeName = new Map(deptClasses.map((c) => [`${c.grade ?? ""}|${c.class_name ?? ""}`, c.id as string]));

  // 이 대시보드가 맡은 부서 학생 + **어느 부서인지 모르는 건**.
  //
  // 앞 판은 명부에서 못 찾은 픽업을 조용히 뺐습니다. 그런데 학부모 연락은 이름이 영문이거나
  // 형제방이라 학생을 못 잇는 경우가 실제로 있고(신민하), 그 아이는 픽업 목록 어디에도
  // 안 떴습니다. **연락은 왔는데 화면에 없는 것**이 가장 나쁜 실패입니다 - 아무도 데리러
  // 가지 않습니다. 부서를 몰라도 올리고, 「학생 미연결」이라고 적어 사람이 잇게 합니다.
  const pickups = allPickups
    .filter((p) => {
      if (p.studentId) return deptStudentIds.has(p.studentId);
      // 이름이 다른 부서 명부에 있으면 그 부서 것입니다 - 여기서는 뺍니다.
      if (allStudentNames.has(p.name)) return classByName.has(p.name);
      return true; // 어느 명부에도 없는 이름 → 확인이 필요하니 올립니다.
    })
    .map((p) => {
      // 번호가 있으면 번호로, 없으면 한 명뿐인 이름일 때만.
      const c = (p.studentId ? whereById.get(p.studentId) : null) ?? classByName.get(p.name) ?? null;
      return {
        name: p.name,
        time: p.time,
        /**
         * 겹치는 이름인가. 화면이 이 값을 보고 이름 옆에 반을 붙입니다.
         *
         * 대시보드는 로그인 영역 밖(토큰 링크)이라 앱의 동명이인 표시(`<Who>`)를 쓸 수
         * 없습니다. 그래서 「겹치는 이름인가」를 서버가 판단해 함께 보냅니다 - 화면이
         * 명부를 따로 읽어 스스로 판단하게 두면, 그 준비를 빠뜨린 화면에서만 표시가
         * 사라집니다(CLAUDE.md 2-4-2).
         */
        homonym: homonymNames.has(p.name),
        // 하원수단(학원차·보호자하원)과 **같은 아이인지** 가리는 열쇠입니다.
        studentId: p.studentId ?? null,
        // 평소 하원수단이 있는 아이면 그것도 함께 적습니다(아래에서 채웁니다).
        plan: null as string | null,
        grade: c?.grade ?? null,
        className: c?.className ?? null,
        classId: c ? classIdByGradeName.get(`${c.grade ?? ""}|${c.className ?? ""}`) ?? null : null,
        // 왜 이 아이가 떴는지. 「어디에도 없는데 계속 떠 있어」를 화면에서 바로 답합니다.
        source: p.source,
        // 명부와 못 이은 건. 화면이 「학생 미연결」로 적어 사람이 확인하게 합니다.
        unmatched: !p.studentId && !classByName.has(p.name),
      };
    });

  // ── 학부모 문의사항 ────────────────────────────────────────────────────────
  // 요청: "운영 대시보드에 이 학부모 문의사항도 띄워줘"
  //
  // 아직 답하지 않은 것만, 급한 것부터 올립니다. 이 화면은 사무실에서 멀찍이 두고 보는
  // 화면이라 "지금 손대야 할 것"만 보여야 합니다 - 처리된 것까지 섞이면 훑어보는 의미가
  // 없어집니다.
  // 문의 이름을 한글로 바꾸기 위한 전체 명부(부서 무관). 학부모 채널 이름이 영어라
  // "Diane & Sunwoo Lim"으로 뜨는 것을 "임다이앤 & 임선우"로 바꿔줍니다.
  // 위에서 이미 읽은 명부(재학+보류)를 그대로 씁니다 - 같은 137명을 두 번 실어 나르던
  // 자리였습니다. 생일까지 함께 읽어둡니다: 「김재이 (190510)」처럼 생일로 알려주시는
  // 경우가 있고, 같은 학년 동명이인은 그것 말고는 갈릴 방법이 없습니다.
  //
  // **손으로 옮기지 않습니다.** 예전에는 여기서 map 을 직접 썼고, 조회에는 있던 birth_date 가
  // 그 map 에서 빠져 있었습니다. 생일로 가르는 규칙은 멀쩡했는데 재료가 없어서, 김재이 셋이
  // 화면에는 그냥 「김재이」로 떴습니다. 빠뜨려도 오류가 아니라 «그냥 이름»으로 보입니다.
  const nameRoster: RosterEntry[] = toRosterEntries(everyone);

  const { data: inquiryRows } = await supabase
    .from("pickup_requests")
    // 칸을 콕 집어 달라고 하면, 마이그레이션이 아직 안 걸린 동안 조회가 통째로 실패해
    // 대시보드가 오류 화면이 됩니다. 전부 달라고 하면 있는 것만 돌아옵니다.
    .select("*")
    .eq("kind", "문의")
    // 담당자: "업무 대시보드에도 안 떠."
    //
    // answered_at만 비었는지 보면, **기계가 토들 답글을 찾아 표시한 건까지 통째로 빠집니다.**
    // 그건 아직 사람이 확인한 것이 아닙니다. 사람이 체크한 것(answered_via='수동')만 뺍니다.
    .or("answered_at.is.null,answered_via.eq.답글")
    .gte("received_at", new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString())
    .order("received_at", { ascending: false })
    .limit(40);

  const inquiries = (inquiryRows ?? [])
    .filter((r) => !r.is_demo) // 데모 연습용 문의 제외.
    .map((r) => ({
      id: r.id as string,
      // 학생이 연결돼 있으면 **그 아이가 답입니다.** 이름으로 다시 짐작하지 않습니다 -
      // 사람이 인박스에서 고른 것을 기계가 뒤집으면 안 됩니다.
      student: (() => {
        const sid = r.student_id as string | null;
        const linked = sid ? (studentById.get(sid) as { name?: string; class_name?: string | null } | undefined) : undefined;
        if (linked?.name) {
          const same = nameRoster.filter((o) => o.name === linked.name);
          const cls = (linked.class_name ?? "").trim();
          return same.length > 1 && cls ? `${linked.name}(${cls})` : linked.name;
        }
        // 연결이 없으면 이름으로 찾되, 동명이인이면 **못 정했다고 적습니다.**
        // 그냥 「김재이」로 띄우면 보는 사람이 정해진 이름이라고 믿고 엉뚱한 아이를 찾습니다.
        const guessed = toKoreanDisplayName(
          (r.matched_name as string | null) ?? (r.ai_student_name as string | null),
          r.channel_label as string | null,
          nameRoster,
          // 원문도 함께 봅니다. 「G2C 김재이」처럼 본문에 적어 오시는 경우가 가장 많습니다.
          `${(r.summary as string | null) ?? ""} ${(r.raw_text as string | null) ?? ""}`,
        );
        return markIfAmbiguous(guessed, nameRoster) ?? (r.channel_label as string | null) ?? "미확인";
      })(),
      // 분류가 비어 있으면 화면에 이름만 뜹니다 - 멀리서 보는 사람에게 «뭔가 왔다» 말고는
      // 아무것도 아닙니다. 저장된 값이 있으면 그대로 쓰고, 없을 때만 글에서 짐작합니다.
      type: displayInquiryType(r.inquiry_type as string | null, (r.summary as string | null) ?? (r.raw_text as string | null)).label,
      // 짐작한 것인지. 화면에서 확실한 분류와 구별해 보여줍니다.
      typeGuessed: displayInquiryType(r.inquiry_type as string | null, (r.summary as string | null) ?? (r.raw_text as string | null)).guessed,
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

  // ── 아직 손 안 댄 인박스 ───────────────────────────────────────────────────
  //
  // 픽업 요청은 «확인대기»로 들어와서, 사람이 인박스에서 한 번 눌러야 하원 체크표로
  // 넘어갑니다. 안 누르면 **아무 일도 일어나지 않습니다** - 오류도 안 뜨고, 화면은 평소와
  // 똑같이 보이고, 그대로 하원 시각이 옵니다. 이 저장소에서 반복해 나온 «조용한 실패»의
  // 전형이라, 사무실에 늘 켜둔 화면에 숫자로 세워둡니다.
  //
  // 부서로 거르지 않습니다. 확인대기로 남는 건은 대개 **학생이 아직 안 붙은** 건이고,
  // 학생이 없으면 부서도 알 수 없습니다. 거르면 정작 봐야 할 것이 사라집니다.
  //
  // 날짜가 지난 확인대기는 뺍니다. 그날은 이미 끝나서 지금 할 수 있는 일이 없는데, 쌓이면
  // 숫자가 늘 크게 남아 아무도 안 보게 됩니다. 날짜가 아예 없는 건은 «언제인지도 모르는»
  // 것이라 오히려 남깁니다.
  const { data: pendingRows } = await supabase
    .from("pickup_requests")
    .select("id, service_date, pickup_time, status, kind, is_demo, matched_name, ai_student_name, channel_label")
    .eq("status", "확인대기")
    .or(`service_date.gte.${todayK},service_date.is.null`)
    .limit(60);

  const pendingInbox = (pendingRows ?? [])
    .filter((r) => !r.is_demo && r.kind === "픽업")
    .map((r) => ({
      name:
        toKoreanDisplayName(
          (r.matched_name as string | null) ?? (r.ai_student_name as string | null),
          r.channel_label as string | null,
          nameRoster
        ) ??
        (r.channel_label as string | null) ??
        "이름 미확인",
      date: (r.service_date as string | null) ?? null,
      time: (r.pickup_time as string | null) ?? null,
      today: r.service_date === todayK,
    }))
    // 오늘 것이 먼저, 그중에서도 이른 시각부터. 날짜 미정은 맨 뒤.
    .sort(
      (a, b) =>
        Number(b.today) - Number(a.today) ||
        (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") ||
        (a.time ?? "99:99").localeCompare(b.time ?? "99:99")
    );

  // ── 오늘 학원차·보호자 하원 ──────────────────────────────────────────────
  //
  // 매주 같은 요일에 학원 차를 타는 아이가 있습니다(월·금 14:40 와이키키짐). 셔틀을 안 타니
  // 하원 체크표에 줄이 없고, 학사일정도 아니라 달력에도 안 뜹니다. **반복되는 일이라
  // 오히려 잊힙니다** - 매주 있는 일은 «오늘도 있다»고 말해주는 자리가 없으면 어느 주에
  // 그냥 지나갑니다.
  //
  // 자료는 이미 있습니다(학생 → 하원수단, 요일별). 여기서는 오늘 요일의 «셔틀이 아닌 것»만
  // 꺼내 시각 순으로 세웁니다. 새 표를 만들지 않습니다 - 같은 사실을 두 곳에 적으면 언젠가
  // 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다.
  const { rows: planRows, byStudent: planPicked } = await loadDismissalForDay(supabase, {
    dayIso: todayK,
    weekday,
    excludeShuttle: true,
  });

  // 같은 아이가 「하원 픽업」과 「학원차·보호자 하원」 두 곳에 따로 뜨고 있었습니다.
  //
  //   · 하원 픽업        - 오늘 학부모가 보낸 연락(오늘 이 아이를 데리러 온다)
  //   · 학원차·보호자하원 - 매주 그 요일마다 그렇게 하기로 되어 있는 것
  //
  // 둘은 같은 사실의 두 얼굴입니다. 두 줄로 두면 데려올 아이가 몇인지 셀 수 없고, 한 아이를
  // 두 번 부르게 됩니다. **오늘 온 연락이 이깁니다** - 평소 규칙보다 오늘 적어준 것이
  // 구체적입니다. 대신 평소 수단(어디 차·몇 시)을 픽업 줄에 붙여 정보는 잃지 않습니다.
  const planByStudent = planPicked;
  for (const pk of pickups) {
    if (!pk.studentId) continue;
    const plan = planByStudent.get(pk.studentId);
    if (!plan) continue;
    // **무슨 차인지만** 적습니다. 학교 앞에서 타는 것이라 «어디로 가는 차인가»만 알면 되고,
    // 시각은 이미 왼쪽에 크게 있습니다. 길게 적으면 그만큼 이름이 밀립니다.
    pk.plan = ((plan.label as string | null) ?? "").trim() || (plan.kind as string);
    // **시각을 물려받습니다.** 학부모 연락에 시각이 없어도 평소 하원수단에 「14:40」이
    // 적혀 있으면 그 시각이 곧 이 아이의 픽업 시각입니다. 시각이 없으면 화면에 「시각 미정」
    // 으로만 뜨고 5분 전 알람도 울릴 수 없습니다 - 알릴 때를 모르니까요.
    if (!pk.time) pk.time = ((plan.depart_time as string | null) ?? "").slice(0, 5) || null;
  }
  const pickedUpIds = new Set(pickups.map((p) => p.studentId).filter(Boolean) as string[]);
  const pickedUpNames = new Set(pickups.map((p) => p.name));

  const dismissalToday = [...planByStudent.values()]
    .filter((p) => deptStudentIds.has(p.student_id as string))
    // 오늘 픽업 연락이 온 아이는 위 「하원 픽업」에 이미 있습니다. 여기서는 뺍니다.
    .filter((p) => {
      if (pickedUpIds.has(p.student_id as string)) return false;
      const st = studentById.get(p.student_id as string) as { name?: string } | undefined;
      return !(st?.name && pickedUpNames.has(st.name));
    })
    .map((p) => {
      const st = studentById.get(p.student_id as string) as { name?: string; grade?: string; class_name?: string } | undefined;
      return {
        name: st?.name ?? "?",
        className: [st?.grade ? `${st.grade}학년` : null, st?.class_name].filter(Boolean).join(" "),
        // 알람 팝업이 「지금 어느 교실에 있는지」를 찾는 열쇠입니다. 이름만으로는 데리러
        // 갈 수 없습니다.
        classId: classIdByGradeName.get(`${st?.grade ?? ""}|${st?.class_name ?? ""}`) ?? null,
        kind: p.kind as string,
        label: (p.label as string | null) ?? null,
        time: (p.depart_time as string | null) ?? null,
        note: (p.note as string | null) ?? null,
      };
    })
    .sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99") || a.name.localeCompare(b.name, "ko"));

  // ── 앞으로 예약된 하원수단 ────────────────────────────────────────────────
  //
  // 「다음 주 화요일만 할머니가 데리러 갑니다」를 넣어두면, 지금까지는 그 화요일 아침까지
  // **아무 데도 안 보였습니다.** 넣은 사람만 알고 있는 상태라, 그 사람이 그날 쉬면 아무도
  // 모릅니다.
  //
  // 오늘이면 위의 픽업·학원차 목록으로 가고, 앞날이면 여기로 옵니다 - 결석 「예정」과 같은
  // 자리에 서서 며칠 전부터 모두가 눈에 담습니다. 지우는 일은 사람이 하지 않습니다.
  // 그날이 되면 저절로 오늘 목록으로 넘어갑니다.
  // 칸이 아직 없으면(마이그레이션 전) 예약이라는 개념 자체가 없습니다. 빈 목록이 맞습니다 -
  // 여기서 오류를 내면 대시보드 전체가 멈춥니다.
  const { data: aheadRows, error: aheadErr } = await supabase
    .from("student_dismissal_plans")
    .select(DISMISSAL_SELECT)
    .in("week_start", [weekStartOf(todayK), nextWeekStart(todayK)])
    .neq("kind", "셔틀");
  if (aheadErr && !isMissingWeekStart(aheadErr)) {
    console.error("[ops-board] 예약된 하원수단 조회 실패:", aheadErr.message);
  }
  const dismissalAhead = ((aheadRows as DismissalRow[] | null) ?? [])
    .map((p) => ({ ...p, date: addDays(p.week_start as string, p.weekday - 1) }))
    // 오늘·지난 날은 뺍니다. 오늘 것은 이미 위에 있고, 지난 것은 지금 할 수 있는 일이 없습니다.
    .filter((p) => p.date > todayK && deptStudentIds.has(p.student_id))
    .map((p) => {
      const st = studentById.get(p.student_id) as { name?: string; grade?: string; class_name?: string } | undefined;
      return {
        name: st?.name ?? "?",
        className: [st?.grade ? `${st.grade}학년` : null, st?.class_name].filter(Boolean).join(" "),
        date: p.date,
        kind: p.kind,
        label: p.label,
        time: p.depart_time,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  // ── 교실에서 온 것 ────────────────────────────────────────────────────────
  //
  // 선생님이 태블릿에서 보낸 특이사항·문의입니다. 아직 안 읽었거나 오늘 읽은 것을 올립니다 -
  // 처리한 것은 내려갑니다.
  //
  // **반 이름을 크게 보냅니다.** 행정실이 먼저 아는 것은 «무슨 일»이 아니라 «어느 교실»입니다.
  // 그리로 가야 하니까요. 반 이름은 이미 영문 코드(G2C·G3JU)라 한국인·외국인 직원 모두
  // 같은 글자를 읽습니다.
  const { data: noteRows } = await supabase
    .from("classroom_notes")
    .select("id, class_id, kind, student_name, body, urgency, created_at, read_at, reply, done_at")
    .is("done_at", null)
    .gte("created_at", `${todayK}T00:00:00+09:00`)
    .order("created_at", { ascending: false })
    .limit(20);

  const classLabelById = new Map(
    (classes ?? []).map((c) => [c.id as string, `${c.grade ?? ""} ${c.class_name ?? ""}`.trim()])
  );
  const classroomNotes = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    className: classLabelById.get(n.class_id as string) ?? "반 미확인",
    kind: n.kind as string,
    studentName: (n.student_name as string | null) ?? null,
    body: n.body as string,
    urgent: n.urgency === "급함",
    at: n.created_at as string,
    readAt: (n.read_at as string | null) ?? null,
    reply: (n.reply as string | null) ?? null,
  }));

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
    // 화면이 다음에 물어볼 때 이 번호를 그대로 보냅니다.
    revision: rev.revision,
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
    upcoming,
    dismissalToday,
    dismissalAhead,
    classroomNotes,
    inquiries,
    pendingInbox,
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
