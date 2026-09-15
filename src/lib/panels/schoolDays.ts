import type { SupabaseClient } from "@supabase/supabase-js";

/** 수업일 달력이 쓰는 자료. 자기 주소와 [출석부]·[출석현황] 팝업이 **같은 것**을 읽습니다. */

type TermLite = { id: string; year: string; term_type: string; start_date: string | null; end_date: string | null; status: string };
type Day = { day: string; is_school_day: boolean; closed_reason: string | null; label: string | null; touched_by_human: boolean };

export type SchoolDaysPanel = {
  terms: TermLite[];
  initialTermId: string;
  initialDays: Day[];
  coverageStart: string | null;
  loadError: string | null;
};

export async function loadSchoolDaysPanel(supabase: SupabaseClient): Promise<SchoolDaysPanel> {
  const [termRes, coverageRes] = await Promise.all([
    supabase
      .from("terms")
      .select("id, year, term_type, start_date, end_date, status")
      .order("status")
      .order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("attendance_coverage").select("starts_on, note").eq("id", true).maybeSingle(),
  ]);

  const terms = (termRes.data as TermLite[] | null) ?? [];
  const current = terms.find((t) => t.status === "진행중") ?? terms[0] ?? null;

  let days: Day[] = [];
  let dayError: string | null = null;
  if (current?.start_date && current?.end_date) {
    const res = await supabase
      .from("school_days")
      .select("day, is_school_day, closed_reason, label, touched_by_human")
      .gte("day", current.start_date)
      .lte("day", current.end_date)
      .order("day");
    if (res.error) {
      console.error("[수업일 달력] 읽지 못했습니다:", res.error.message);
      dayError = res.error.message;
    }
    days = (res.data as Day[] | null) ?? [];
  }

  return {
    terms,
    initialTermId: current?.id ?? "",
    initialDays: days,
    coverageStart: (coverageRes.data as { starts_on: string | null } | null)?.starts_on ?? null,
    loadError: termRes.error?.message ?? dayError,
  };
}
