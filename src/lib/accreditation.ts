import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudents, type Student } from "@/lib/students";
import { departmentOf } from "@/lib/department";
import { readAll } from "@/lib/financeFetch";
import { loadShuttleWorld } from "@/lib/shuttleWorld";
import { summarizeAll, summarizeGroup, type GroupSummary, type RegisterRecord } from "@/lib/attendanceRegister";
import { kstDateOffset, todayKst } from "@/lib/kst";

/**
 * **인증(Ai/MSA-CESS) 증거 자료** — 앱에 쌓인 기록을 심사단이 읽을 영문 한 장으로 꺼냅니다.
 *
 * 앱 화면은 한국어이고 화면 안에만 있어서 그대로는 증거로 못 냅니다. 여기서 같은 자료를 읽어 숫자·표로 정리하고, 화면은
 * 인쇄(PDF 저장)만 합니다. 판정은 원래 함수를 그대로 씁니다(출석률은 `attendanceRegister`, 셔틀은 `shuttleWorld`) -
 * 증거용으로 따로 세면 앱 화면과 종이의 숫자가 달라지고, 심사단 앞에서 어느 쪽이 맞는지 설명할 수 없습니다.
 *
 * **학생 이름·연락처는 담지 않습니다.** 외부 기관과 드라이브로 공유되는 자료입니다. 숫자와 반 단위로만 적습니다.
 */

export { EXHIBITS, type ExhibitKey } from "@/lib/accreditationExhibits";

export const DEPT_EN: Record<string, string> = { 초등부: "Elementary", 중고등부: "Middle & High School", 유치부: "Kindergarten" };
export const deptEn = (d: string | null | undefined) => (d ? DEPT_EN[d] ?? d : "Unassigned");

export type TermRange = { id: string | null; label: string; from: string; to: string };

/** 진행 중인 학기. 없으면 올해 3월 1일 ~ 오늘(증거가 «언제부터 언제까지»인지는 종이에 늘 적힙니다). */
export async function loadTermRange(supabase: SupabaseClient): Promise<TermRange> {
  const { data } = await supabase.from("terms").select("id, year, term_type, start_date, end_date").eq("status", "진행중").limit(1);
  const t = ((data as { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null }[] | null) ?? [])[0];
  const today = todayKst();
  if (!t) return { id: null, label: `Academic Year ${today.slice(0, 4)}`, from: `${today.slice(0, 4)}-03-01`, to: today };
  const to = t.end_date && t.end_date < today ? t.end_date : today;
  const year = /^\d{2}-\d{2}$/.test(t.year) ? `20${t.year}` : t.year;
  return { id: t.id, label: `${year} ${TERM_EN[t.term_type] ?? t.term_type}`, from: t.start_date ?? `${today.slice(0, 4)}-03-01`, to };
}
const TERM_EN: Record<string, string> = { "1학기": "Term 1", "2학기": "Term 2", "3학기": "Term 3", 정규학기: "Regular Term" };

const gradeKey = (g: string | null) => {
  const n = Number(String(g ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 99;
};
const gradeLabel = (g: string | null) => (g ? (/^\d+$/.test(g) ? `Grade ${g}` : g) : "—");

// ── 1. 재학생 구성 ────────────────────────────────────────────────────────────

export async function loadEnrollment(supabase: SupabaseClient) {
  const { rows, error } = await loadStudents(supabase);
  if (error) throw new Error(error);
  const byDept = countBy(rows, (s) => deptEn(departmentOf(s)));
  const byGrade = countBy(rows, (s) => `${deptEn(departmentOf(s))}|${s.grade ?? ""}`);
  const byClass = countBy(rows, (s) => `${deptEn(departmentOf(s))}|${s.grade ?? ""}|${s.class_name ?? "Unassigned"}`);
  const gradeRows = [...byGrade.entries()]
    .map(([k, n]) => ({ dept: k.split("|")[0], grade: gradeLabel(k.split("|")[1] || null), sort: gradeKey(k.split("|")[1] || null), n }))
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.sort - b.sort);
  const classRows = [...byClass.entries()]
    .map(([k, n]) => {
      const [dept, grade, cls] = k.split("|");
      return { dept, grade: gradeLabel(grade || null), sort: gradeKey(grade || null), cls, n };
    })
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.sort - b.sort || a.cls.localeCompare(b.cls));
  const sizes = classRows.filter((c) => c.cls !== "Unassigned").map((c) => c.n);
  return {
    total: rows.length,
    byDept: [...byDept.entries()].sort(),
    gradeRows,
    classRows,
    avgClassSize: sizes.length ? Math.round((sizes.reduce((a, b) => a + b, 0) / sizes.length) * 10) / 10 : null,
    maxClassSize: sizes.length ? Math.max(...sizes) : null,
  };
}

function countBy<T>(rows: readonly T[], key: (r: T) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
}

// ── 2. 반 편성·담임·과목 ──────────────────────────────────────────────────────

export async function loadFaculty(supabase: SupabaseClient) {
  const [cls, subj, users, stu] = await Promise.all([
    supabase.from("wr_classes").select("id, grade, class_name, department, teacher_email, teacher_name, sub_teacher_email, sub_teacher_name, room").eq("is_demo", false),
    supabase.from("wr_subjects").select("id, name, teacher_email, teacher_name, class_id"),
    supabase.from("app_users").select("email, name, position, status").eq("status", "approved"),
    loadStudents(supabase),
  ]);
  const bad = cls.error?.message ?? subj.error?.message ?? users.error?.message ?? stu.error;
  if (bad) throw new Error(bad);
  type C = { id: string; grade: string | null; class_name: string | null; department: string | null; teacher_email: string | null; teacher_name: string | null; sub_teacher_email: string | null; sub_teacher_name: string | null; room: string | null };
  type S = { id: string; name: string; teacher_email: string | null; teacher_name: string | null; class_id: string | null };
  type U = { email: string; name: string | null; position: string | null };
  const nameOf = new Map(((users.data as U[] | null) ?? []).map((u) => [u.email, u.name ?? u.email]));
  const who = (email: string | null, name: string | null) => (email ? nameOf.get(email) ?? name ?? email : name) ?? "—";
  const size = countBy(stu.rows, (s) => s.class_id ?? "");
  const classes = ((cls.data as C[] | null) ?? [])
    .map((c) => ({
      id: c.id,
      dept: deptEn(departmentOf({ department: c.department, grade: c.grade })),
      grade: gradeLabel(c.grade),
      sort: gradeKey(c.grade),
      cls: c.class_name ?? "—",
      homeroom: who(c.teacher_email, c.teacher_name),
      assistant: c.sub_teacher_email || c.sub_teacher_name ? who(c.sub_teacher_email, c.sub_teacher_name) : "",
      room: c.room ?? "",
      students: size.get(c.id) ?? 0,
    }))
    .filter((c) => c.students > 0 || c.homeroom !== "—")
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.sort - b.sort || a.cls.localeCompare(b.cls));
  const classById = new Map(classes.map((c) => [c.id, c]));
  const subjects = ((subj.data as S[] | null) ?? [])
    .map((s) => ({ name: s.name, teacher: who(s.teacher_email, s.teacher_name), cls: s.class_id ? classById.get(s.class_id)?.cls ?? "" : "All classes" }))
    .sort((a, b) => a.teacher.localeCompare(b.teacher) || a.name.localeCompare(b.name));
  const teachers = new Set([...classes.map((c) => c.homeroom), ...subjects.map((s) => s.teacher)].filter((t) => t && t !== "—"));
  return { classes, subjects, teacherCount: teachers.size, studentTotal: stu.rows.length };
}

// ── 3. 출석 ───────────────────────────────────────────────────────────────────

export async function loadAttendance(supabase: SupabaseClient, term: TermRange) {
  const [stu, days, cov] = await Promise.all([
    loadStudents(supabase),
    supabase.from("school_days").select("day, is_school_day").gte("day", term.from).lte("day", term.to).order("day"),
    supabase.from("attendance_coverage").select("starts_on").eq("id", true).maybeSingle(),
  ]);
  if (stu.error) throw new Error(stu.error);
  if (days.error) throw new Error(days.error.message);
  const coverageStart = (cov.data as { starts_on: string | null } | null)?.starts_on ?? null;
  const rec = await readAll<RegisterRecord>((a, b) =>
    supabase
      .from("attendance_records")
      .select("student_id, date, status, reason_type, source, confirmed_by_human")
      .gte("date", term.from)
      .lte("date", term.to)
      .order("date")
      .order("student_id")
      .range(a, b),
  );
  if (rec.error) throw new Error(rec.error);
  // 수업일 달력이 비어 있으면 평일(월~금)로 셉니다. 달력이 없다고 출석률을 못 내면 증거가 한 장 비고, 공휴일이 섞여
  // 출석률이 실제보다 조금 높게 나오는 편이 «0일»보다 정직합니다 - 대신 종이에 그렇게 셌다고 적습니다(`calendarFallback`).
  const calendar = ((days.data as { day: string; is_school_day: boolean }[] | null) ?? []).filter((d) => d.is_school_day).map((d) => d.day);
  const firstRecord = rec.rows.reduce<string | null>((m, r) => (!m || r.date < m ? r.date : m), null);
  const start = coverageStart ?? (calendar.length ? null : firstRecord);
  const calendarFallback = calendar.length === 0;
  const schoolDays = (calendarFallback ? weekdaysBetween(start ?? term.from, term.to) : calendar).filter((d) => !start || d >= start);
  const per = summarizeAll(stu.rows.map((s) => s.id), rec.rows, schoolDays, coverageStart);
  const group = (pick: (s: Student) => string) => {
    const m = new Map<string, Student[]>();
    for (const s of stu.rows) (m.get(pick(s)) ?? m.set(pick(s), []).get(pick(s))!).push(s);
    return [...m.entries()].map(([k, list]) => ({ key: k, g: summarizeGroup(list.map((s) => per.get(s.id)!)) }));
  };
  const school = summarizeGroup([...per.values()]);
  const byDept = group((s) => deptEn(departmentOf(s))).sort((a, b) => a.key.localeCompare(b.key));
  const byClass = group((s) => `${deptEn(departmentOf(s))}|${s.grade ?? ""}|${s.class_name ?? "Unassigned"}`)
    .map(({ key, g }) => {
      const [dept, grade, cls] = key.split("|");
      return { dept, grade: gradeLabel(grade || null), sort: gradeKey(grade || null), cls, g };
    })
    .sort((a, b) => a.dept.localeCompare(b.dept) || a.sort - b.sort || a.cls.localeCompare(b.cls));
  // 달마다 — 그 달의 수업일만으로 다시 셉니다.
  const months = [...new Set(schoolDays.map((d) => d.slice(0, 7)))];
  const byMonth = months.map((m) => {
    const md = schoolDays.filter((d) => d.startsWith(m));
    const pm = summarizeAll(stu.rows.map((s) => s.id), rec.rows, md, coverageStart);
    return { month: m, g: summarizeGroup([...pm.values()]) };
  });
  return { schoolDays: schoolDays.length, coverageStart: start, calendarFallback, school, byDept, byClass, byMonth, truncated: rec.truncated };
}
export type { GroupSummary };

function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    const w = d.getUTCDay();
    if (w >= 1 && w <= 5) out.push(d.toISOString().slice(0, 10)); // kst-ok: 정오(UTC) 기준 날짜 글자만 만들어 시간대 영향이 없습니다.
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ── 4. 주간 관찰기록 ──────────────────────────────────────────────────────────

export async function loadProgress(supabase: SupabaseClient, term: TermRange) {
  const stu = await loadStudents(supabase);
  if (stu.error) throw new Error(stu.error);
  type R = { student_id: string; status: string; report_date: string; subject: string };
  const rep = await readAll<R>((a, b) =>
    supabase
      .from("wr_reports")
      .select("student_id, status, report_date, subject")
      .gte("report_date", term.from)
      .lte("report_date", term.to)
      .eq("is_archived", false)
      .order("report_date")
      .order("student_id")
      .range(a, b),
  );
  if (rep.error) throw new Error(rep.error);
  const byStudent = new Map<string, R[]>();
  for (const r of rep.rows) (byStudent.get(r.student_id) ?? byStudent.set(r.student_id, []).get(r.student_id)!).push(r);
  const classes = new Map<string, { dept: string; grade: string; sort: number; cls: string; students: number; covered: number; reports: number; published: number; last: string }>();
  for (const s of stu.rows) {
    const k = `${s.class_id ?? s.class_name ?? "?"}`;
    const c = classes.get(k) ?? { dept: deptEn(departmentOf(s)), grade: gradeLabel(s.grade), sort: gradeKey(s.grade), cls: s.class_name ?? "Unassigned", students: 0, covered: 0, reports: 0, published: 0, last: "" };
    const mine = byStudent.get(s.id) ?? [];
    c.students += 1;
    if (mine.length) c.covered += 1;
    c.reports += mine.length;
    c.published += mine.filter((r) => r.status === "published").length;
    for (const r of mine) if (r.report_date > c.last) c.last = r.report_date;
    classes.set(k, c);
  }
  const rows = [...classes.values()].sort((a, b) => a.dept.localeCompare(b.dept) || a.sort - b.sort || a.cls.localeCompare(b.cls));
  const subjects = countBy(rep.rows.filter((r) => byStudent.has(r.student_id)), (r) => r.subject || "General");
  const total = rows.reduce((n, r) => n + r.reports, 0);
  return {
    rows,
    total,
    published: rows.reduce((n, r) => n + r.published, 0),
    covered: rows.reduce((n, r) => n + r.covered, 0),
    students: stu.rows.length,
    subjects: [...subjects.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// ── 5. 셔틀·하원 안전 ─────────────────────────────────────────────────────────

export async function loadSafety(supabase: SupabaseClient) {
  const since = kstDateOffset(-30);
  const [world, arrivals, checklog, devices, safety] = await Promise.all([
    loadShuttleWorld(supabase, { assignments: "basic" }),
    supabase.from("shuttle_stop_arrivals").select("service_date, route_id").gte("service_date", since),
    supabase.from("shuttle_checklist_log").select("service_date").gte("service_date", since),
    supabase.from("shuttle_tracker_devices").select("route_id, enabled"),
    supabase.from("shuttle_safety_events").select("event_type, recorded_at").gte("recorded_at", `${since}T00:00:00+09:00`),
  ]);
  if (world.errors.length) throw new Error(world.errors.join(" · "));
  const students = new Set(world.assignments.map((a) => a.student_id).filter(Boolean));
  const dir = countBy(world.routes, (r) => (r.direction === "등원" ? "Morning (to school)" : r.direction === "하원" ? "Afternoon (dismissal)" : r.direction));
  const arr = (arrivals.data as { service_date: string; route_id: string }[] | null) ?? [];
  const logs = (checklog.data as { service_date: string }[] | null) ?? [];
  const dev = (devices.data as { route_id: string | null; enabled: boolean }[] | null) ?? [];
  const ev = (safety.data as { event_type: string }[] | null) ?? [];
  return {
    since,
    routes: world.routes.length,
    byDirection: [...dir.entries()],
    stops: world.stops.length,
    assignedStudents: students.size,
    // 지난 학기 노선에 붙어 있던 기기는 세지 않습니다 - 지금 노선 수보다 많은 «추적 노선»이 찍힙니다.
    trackedRoutes: new Set(dev.filter((d) => d.enabled && d.route_id && world.routeById.has(d.route_id)).map((d) => d.route_id)).size,
    gpsArrivals: arr.length,
    gpsDays: new Set(arr.map((a) => a.service_date)).size,
    checklistEntries: logs.length,
    checklistDays: new Set(logs.map((l) => l.service_date)).size,
    hardBrake: ev.filter((e) => e.event_type === "급감속").length,
    hardAccel: ev.filter((e) => e.event_type === "급가속").length,
    readErrors: [arrivals.error, checklog.error, devices.error, safety.error].filter(Boolean).map((e) => e!.message),
  };
}

// ── 6. 회의·사건·행사 ─────────────────────────────────────────────────────────

export async function loadGovernance(supabase: SupabaseClient, term: TermRange) {
  const [m, i, e] = await Promise.all([
    supabase.from("meetings").select("date, status, next_agenda").gte("date", term.from).lte("date", term.to),
    supabase.from("incidents").select("date, manual_cat, status, resolution_note").gte("date", term.from).lte("date", term.to),
    supabase.from("events").select("date, kind, good, lack, suggest").gte("date", term.from).lte("date", term.to),
  ]);
  const bad = m.error?.message ?? i.error?.message ?? e.error?.message;
  if (bad) throw new Error(bad);
  type M = { date: string; status: string | null; next_agenda: string | null };
  type I = { date: string; manual_cat: string | null; status: string | null; resolution_note: string | null };
  type E = { date: string; kind: string; good: string | null; lack: string | null; suggest: string | null };
  const meetings = (m.data as M[] | null) ?? [];
  const incidents = (i.data as I[] | null) ?? [];
  const events = (e.data as E[] | null) ?? [];
  const months = [...new Set([...meetings, ...incidents, ...events].map((r) => r.date.slice(0, 7)))].sort();
  const per = (rows: { date: string }[], mo: string) => rows.filter((r) => r.date.startsWith(mo)).length;
  return {
    byMonth: months.map((mo) => ({ month: mo, meetings: per(meetings, mo), incidents: per(incidents, mo), events: per(events, mo) })),
    meetings: { total: meetings.length, withFollowUp: meetings.filter((x) => (x.next_agenda ?? "").trim()).length },
    incidents: {
      total: incidents.length,
      withAction: incidents.filter((x) => (x.resolution_note ?? "").trim()).length,
      byCategory: [...countBy(incidents, (x) => x.manual_cat || "Uncategorized").entries()].sort((a, b) => b[1] - a[1]),
      byStatus: [...countBy(incidents, (x) => x.status || "Open").entries()],
    },
    events: {
      total: events.length,
      regular: events.filter((x) => x.kind === "regular").length,
      reviewed: events.filter((x) => [x.good, x.lack, x.suggest].some((v) => (v ?? "").trim())).length,
    },
  };
}

// ── 7. 학부모 소통 ────────────────────────────────────────────────────────────

export async function loadParents(supabase: SupabaseClient, term: TermRange) {
  type P = { kind: string; status: string | null; received_at: string | null; answered_at: string | null; inquiry_type: string | null };
  const pr = await readAll<P>((a, b) =>
    supabase
      .from("pickup_requests")
      .select("kind, status, received_at, answered_at, inquiry_type")
      .eq("is_demo", false)
      .gte("received_at", `${term.from}T00:00:00+09:00`)
      .lte("received_at", `${term.to}T23:59:59+09:00`)
      .order("received_at")
      .order("id")
      .range(a, b),
  );
  if (pr.error) throw new Error(pr.error);
  const real = pr.rows.filter((r) => r.status !== "무시");
  const inq = real.filter((r) => r.kind === "문의");
  const hours = inq
    .filter((r) => r.answered_at && r.received_at)
    .map((r) => (new Date(r.answered_at!).getTime() - new Date(r.received_at!).getTime()) / 3600000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length ? Math.round(hours[Math.floor(hours.length / 2)] * 10) / 10 : null;

  const ev = await supabase.from("consult_events").select("id, name, event_date, end_date, status").gte("event_date", term.from).lte("event_date", term.to);
  type CE = { id: string; name: string; event_date: string | null; end_date: string | null; status: string };
  const events = (ev.data as CE[] | null) ?? [];
  const ap = events.length
    ? await supabase.from("consult_appointments").select("event_id, status").in("event_id", events.map((x) => x.id))
    : { data: [], error: null };
  const apps = (ap.data as { event_id: string; status: string }[] | null) ?? [];
  return {
    messages: real.length,
    byKind: [...countBy(real, (r) => KIND_EN[r.kind] ?? r.kind).entries()],
    inquiries: inq.length,
    answered: inq.filter((r) => r.answered_at).length,
    medianHours: median,
    byType: [...countBy(inq, (r) => r.inquiry_type || "General").entries()].sort((a, b) => b[1] - a[1]),
    conferences: events.map((x) => {
      const mine = apps.filter((a) => a.event_id === x.id);
      return { name: x.name, date: x.event_date ?? "", end: x.end_date, booked: mine.filter((a) => a.status !== "취소").length, done: mine.filter((a) => a.status === "완료" || a.status === "전화상담").length };
    }),
    readErrors: [ev.error, ap.error].filter(Boolean).map((e) => e!.message),
  };
}
const KIND_EN: Record<string, string> = { 픽업: "Pick-up / dismissal changes", 문의: "Parent inquiries", 기타: "Other" };

// ── 방문 일정표(수업 참관) ─────────────────────────────────────────────────────

export type VisitCell = { subject: string; teacher: string; room: string };
export async function loadVisitSchedule(supabase: SupabaseClient, weekday: number) {
  const [cls, per, tt] = await Promise.all([
    supabase.from("wr_classes").select("id, grade, class_name, department, room, teacher_name, teacher_email").eq("is_demo", false),
    supabase.from("wr_periods").select("id, department, period_no, label, start_time, end_time").order("period_no"),
    supabase.from("wr_timetable").select("class_id, weekday, period_id, subject_name, teacher_name, room").eq("weekday", weekday),
  ]);
  const bad = cls.error?.message ?? per.error?.message ?? tt.error?.message;
  if (bad) throw new Error(bad);
  type C = { id: string; grade: string | null; class_name: string | null; department: string | null; room: string | null };
  type P = { id: string; department: string; period_no: number; label: string | null; start_time: string; end_time: string };
  type T = { class_id: string; period_id: string; subject_name: string; teacher_name: string | null; room: string | null };
  const entries = (tt.data as T[] | null) ?? [];
  const usedClass = new Set(entries.map((e) => e.class_id));
  const classes = ((cls.data as C[] | null) ?? [])
    .filter((c) => usedClass.has(c.id))
    .map((c) => ({ ...c, dept: departmentOf({ department: c.department, grade: c.grade }) ?? "기타" }))
    .sort((a, b) => gradeKey(a.grade) - gradeKey(b.grade) || String(a.class_name).localeCompare(String(b.class_name)));
  const periods = (per.data as P[] | null) ?? [];
  const cell = new Map(entries.map((e) => [`${e.class_id}|${e.period_id}`, e]));
  const depts = [...new Set(classes.map((c) => c.dept))];
  return depts.map((d) => {
    const dc = classes.filter((c) => c.dept === d);
    const dp = periods.filter((p) => p.department === d);
    return {
      dept: deptEn(d),
      classes: dc.map((c) => ({ id: c.id, label: c.class_name ?? "—", room: c.room ?? "" })),
      periods: dp.map((p) => ({
        no: p.period_no,
        // 교시 이름은 한국어(「1교시」)라 영문 종이에는 번호로 적습니다.
        label: p.label && !/[가-힣]/.test(p.label) ? p.label : `Period ${p.period_no}`,
        time: `${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}`,
        cells: dc.map((c) => {
          const e = cell.get(`${c.id}|${p.id}`);
          return e ? ({ subject: e.subject_name, teacher: e.teacher_name ?? "", room: e.room ?? c.room ?? "" } as VisitCell) : null;
        }),
      })),
    };
  });
}
