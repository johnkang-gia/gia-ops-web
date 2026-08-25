import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import TimetableClient, {
  type TtPeriod,
  type TtCell,
  type TtClass,
  type RoomStatus,
  type TeacherHours,
} from "@/components/school/TimetableClient";

export const dynamic = "force-dynamic";

// 수업·시간표(요청 ③): 공간(식당·체육관·컴퓨터실·미술실 등) 사용 현황, 전체 시간표(요일·부서별),
// 선생님별 수업 시수·지금 수업 없는 선생님, 담임·과목 관리 바로가기를 한 화면에 모읍니다.
const SPECIAL_ROOMS = ["식당", "체육관", "컴퓨터실", "미술실", "음악실", "도서관", "과학실", "강당"];

function kstNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wd = wdMap[p.find((x) => x.type === "weekday")?.value ?? "Mon"] ?? 1;
  const h = Number(p.find((x) => x.type === "hour")?.value ?? "0");
  const m = Number(p.find((x) => x.type === "minute")?.value ?? "0");
  return { weekday: wd, minutes: h * 60 + m };
}
function toMin(t: string) {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export default async function TimetablePage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [{ data: periodsRaw }, { data: ttRaw }, { data: classesRaw }, { data: studsRaw }] = await Promise.all([
    supabase.from("wr_periods").select("id, department, period_no, label, start_time, end_time").order("start_time"),
    supabase.from("wr_timetable").select("class_id, weekday, period_id, subject_name, teacher_name, room"),
    supabase.from("wr_classes").select("id, grade, class_name, department"),
    supabase.from("wr_students").select("class_id, status"),
  ]);
  // 반별 재학생 수(요청 ③: 각 반 몇 명인지 뱃지로). '재학'/active만 셉니다.
  const classCount = new Map<string, number>();
  for (const s of studsRaw ?? []) {
    const st = (s.status as string | null) ?? null;
    if (st === "졸업" || st === "graduated" || st === "퇴학" || st === "전출" || st === "withdrawn") continue;
    const cid = s.class_id as string | null;
    if (cid) classCount.set(cid, (classCount.get(cid) ?? 0) + 1);
  }

  const periods: TtPeriod[] = (periodsRaw ?? []).map((p) => ({
    id: p.id as string,
    department: (p.department as string) ?? "",
    periodNo: (p.period_no as number) ?? 0,
    label: (p.label as string | null) ?? `${p.period_no}교시`,
    start: (p.start_time as string) ?? "",
    end: (p.end_time as string) ?? "",
  }));
  const periodById = new Map(periods.map((p) => [p.id, p]));
  const classById = new Map((classesRaw ?? []).map((c) => [c.id as string, c]));
  const classes: TtClass[] = (classesRaw ?? []).map((c) => ({
    id: c.id as string,
    grade: (c.grade as string | null) ?? "",
    className: (c.class_name as string | null) ?? "",
    department: (c.department as string | null) ?? "",
    students: classCount.get(c.id as string) ?? 0,
  }));

  const cells: TtCell[] = (ttRaw ?? []).map((t) => {
    const c = classById.get(t.class_id as string);
    const p = periodById.get(t.period_id as string);
    return {
      classId: t.class_id as string,
      grade: (c?.grade as string | null) ?? "",
      className: (c?.class_name as string | null) ?? "",
      department: (c?.department as string | null) ?? p?.department ?? "",
      weekday: (t.weekday as number) ?? 0,
      periodId: t.period_id as string,
      subject: (t.subject_name as string) ?? "",
      teacher: (t.teacher_name as string | null) ?? null,
      room: (t.room as string | null) ?? null,
    };
  });

  // ── 지금 상황 ──────────────────────────────────────────────────────────────
  const { weekday: nowWd, minutes: nowMin } = kstNow();
  // 부서별로 "지금 교시"를 찾습니다(부서마다 시간표가 달라서).
  const currentPeriodIds = new Set(periods.filter((p) => p.start && p.end && toMin(p.start) <= nowMin && nowMin < toMin(p.end)).map((p) => p.id));
  const nowCells = cells.filter((c) => c.weekday === nowWd && currentPeriodIds.has(c.periodId));

  // 공간(방) 사용 현황
  const roomInUse = new Map<string, TtCell>();
  for (const c of nowCells) if (c.room) roomInUse.set((c.room as string).trim(), c);
  const allRoomNames = new Set<string>([...SPECIAL_ROOMS]);
  for (const c of cells) if (c.room) allRoomNames.add((c.room as string).trim());
  const rooms: RoomStatus[] = [...allRoomNames]
    .filter((r) => r)
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => {
      const use = roomInUse.get(name);
      return {
        name,
        inUse: !!use,
        by: use ? `${use.grade || ""} ${use.className || ""}`.trim() : null,
        subject: use?.subject ?? null,
        teacher: use?.teacher ?? null,
      };
    });

  // 선생님별 시수 + 지금 수업 있는/없는 선생님
  const teacherSet = new Set<string>();
  const hours = new Map<string, number>();
  for (const c of cells) if (c.teacher) { teacherSet.add(c.teacher); hours.set(c.teacher, (hours.get(c.teacher) ?? 0) + 1); }
  const busyNow = new Set(nowCells.map((c) => c.teacher).filter(Boolean) as string[]);
  const teacherHours: TeacherHours[] = [...teacherSet]
    .map((t) => ({ teacher: t, hours: hours.get(t) ?? 0, busyNow: busyNow.has(t) }))
    .sort((a, b) => b.hours - a.hours || a.teacher.localeCompare(b.teacher, "ko"));
  const freeNow = teacherHours.filter((t) => !t.busyNow).map((t) => t.teacher);

  const nowPeriodLabel = periods.find((p) => currentPeriodIds.has(p.id))?.label ?? null;
  const weekdayLabel = ["일", "월", "화", "수", "목", "금", "토"][nowWd];

  return (
    <div className="p-4 sm:p-6">
      <TimetableClient
        periods={periods}
        cells={cells}
        classes={classes}
        rooms={rooms}
        teacherHours={teacherHours}
        freeNow={freeNow}
        nowInfo={{ weekdayLabel, periodLabel: nowPeriodLabel, inSession: currentPeriodIds.size > 0 }}
      />
    </div>
  );
}
