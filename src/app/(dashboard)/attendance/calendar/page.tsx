import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import CalendarClient from "@/components/attendance/CalendarClient";

export const dynamic = "force-dynamic";

// 수업일 달력.
//
// 출석부의 분모입니다. 며칠이 수업일인지 모르면 출석일수도 출석률도 낼 수 없습니다.
//
// 고치는 것은 행정실만 합니다 - 하루를 잘못 빼면 그 날 결석한 아이 전원의 결석 일수가 함께
// 틀어지고, 그 숫자가 상급학교 서류로 나갑니다.

export default async function AttendanceCalendarPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 담임은 달력을 고칠 수 없습니다. 하루를 잘못 빼면 그 날 결석한 아이 전원의 결석 일수가
  // 함께 틀어지고, 그 숫자가 상급학교 서류로 나갑니다.
  if (!isStaffOrAboveUser(me)) redirect("/attendance");

  const supabase = await createClient();
  const [termRes, coverageRes] = await Promise.all([
    supabase
      .from("terms")
      .select("id, year, term_type, start_date, end_date, status")
      .order("status")
      .order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("attendance_coverage").select("starts_on, note").eq("id", true).maybeSingle(),
  ]);

  const terms = (termRes.data as { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null; status: string }[] | null) ?? [];
  const current = terms.find((t) => t.status === "진행중") ?? terms[0] ?? null;

  let days: { day: string; is_school_day: boolean; closed_reason: string | null; label: string | null; touched_by_human: boolean }[] = [];
  if (current?.start_date && current?.end_date) {
    const res = await supabase
      .from("school_days")
      .select("day, is_school_day, closed_reason, label, touched_by_human")
      .gte("day", current.start_date)
      .lte("day", current.end_date)
      .order("day");
    if (res.error) console.error("[수업일 달력] 읽지 못했습니다:", res.error.message);
    days = (res.data as typeof days | null) ?? [];
  }

  return (
    <CalendarClient
      terms={terms}
      initialTermId={current?.id ?? ""}
      initialDays={days}
      coverageStart={(coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null}
      currentUserEmail={me.email}
    />
  );
}
