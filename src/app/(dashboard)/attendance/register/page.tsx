import { redirect } from "next/navigation";
import Link from "next/link";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { summarizeAll, type RegisterRecord } from "@/lib/attendanceRegister";
import type { WrClass, WrStudent } from "@/lib/types";
import RegisterGrid from "@/components/attendance/RegisterGrid";

export const dynamic = "force-dynamic";

// 반별 출석부 - 학생 × 날짜 격자표.
//
// 종이 출석부와 같은 모양입니다. 담임이 한 달을 통째로 훑을 때는 카드가 아니라 격자여야
// 합니다 - "이 아이가 이번 달에 언제 빠졌나" 는 세로로 읽어야 보이고, "그 날 몇 명이
// 빠졌나" 는 가로로 읽어야 보입니다.

export default async function AttendanceRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; month?: string; cls?: string }>;
}) {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const sp = await searchParams;
  const base = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKst();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : base.slice(0, 7);
  const from = `${month}-01`;
  // 그 달의 마지막 날. 다음 달 0일이 이번 달 말일입니다.
  const [y, m] = month.split("-").map(Number);
  const to = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

  const supabase = await createClient();
  const teacherOnly = isTeacherOnly(me);

  const classesQuery = teacherOnly
    ? supabase
        .from("wr_classes")
        .select("*")
        .eq("is_demo", isDemoAccount(me.email))
        .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
    : supabase.from("wr_classes").select("*").eq("is_demo", isDemoAccount(me.email));

  const { data: classesData } = await classesQuery.order("grade").order("class_name");
  const classes = (classesData as WrClass[] | null) ?? [];
  // 고른 반이 없으면 첫 반. 교사는 대개 반이 하나라 고를 것도 없습니다.
  const selected = sp.cls && classes.some((c) => c.class_name === sp.cls) ? sp.cls : classes[0]?.class_name ?? null;

  let students: WrStudent[] = [];
  if (selected) {
    const cls = classes.find((c) => c.class_name === selected)!;
    const res = await supabase
      .from("wr_students_basic")
      .select("*")
      .eq("class_id", cls.id)
      .eq("status", "active")
      .order("name");
    students = (res.data as WrStudent[] | null) ?? [];
  }

  const [dayRes, recRes, coverageRes] = await Promise.all([
    supabase.from("school_days").select("day, is_school_day, label, closed_reason").gte("day", from).lte("day", to).order("day"),
    supabase
      .from("attendance_records")
      .select("student_id, date, status, reason_type, source, confirmed_by_human")
      .gte("date", from)
      .lte("date", to),
    supabase.from("attendance_coverage").select("starts_on").eq("id", true).maybeSingle(),
  ]);
  if (dayRes.error) console.error("[출석부 표] 수업일 달력을 읽지 못했습니다:", dayRes.error.message);
  if (recRes.error) console.error("[출석부 표] 출결을 읽지 못했습니다:", recRes.error.message);

  const days = (dayRes.data as { day: string; is_school_day: boolean; label: string | null; closed_reason: string | null }[] | null) ?? [];
  const schoolDayList = days.filter((d) => d.is_school_day).map((d) => d.day);
  const records = (recRes.data as RegisterRecord[] | null) ?? [];
  const coverageStart = (coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null;
  const summaries = summarizeAll(students.map((s) => s.id), records, schoolDayList, coverageStart);

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📋 반별 출석부</h1>
        <span className="text-xs text-slate-400">학생 × 날짜 · 종이 출석부와 같은 모양</span>
        <Link href="/attendance" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          ← 오늘 찍기로
        </Link>
      </div>

      {days.length === 0 && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          이 달의 <b>수업일 달력이 비어 있습니다.</b> 며칠이 수업일인지 모르면 표에 세울 날짜가 없습니다 —{" "}
          <Link href="/attendance/calendar" className="font-bold underline">
            달력 만들기
          </Link>
        </p>
      )}

      <RegisterGrid
        month={month}
        classes={classes.map((c) => ({ name: c.class_name ?? "이름 없는 반", grade: c.grade }))}
        selected={selected}
        days={days}
        students={students.map((s) => ({ id: s.id, name: s.name }))}
        records={records}
        summaries={Object.fromEntries(summaries)}
      />
    </div>
  );
}
