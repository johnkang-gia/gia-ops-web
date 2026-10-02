import type { SupabaseClient } from "@supabase/supabase-js";
import { applyAttendance, type AttendanceAction } from "@/lib/attendanceApply";

/**
 * **등록된 출결 줄의 기간·상태가 바뀌면 셔틀 체크표와 출석부를 따라 고칩니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 「내일부터 다음주 화요일까지」가 10/1~10/6 로 잘못 잡혀 등록됐고, 사람이 시작일을 10/2 로
 * 고쳤습니다. 그런데 고치는 자리는 **인박스 줄만** 고쳤습니다. 10/1 의 체크표 결석과 출석부
 * 결석은 그대로 남아, 아이가 학교에 나온 날에 셔틀에서 빠져 있고 출석률은 깎였습니다. 화면에는
 * 오류가 아니라 「날짜는 고쳐진 줄」로 보였습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 전과 후의 날짜 집합을 비교해, 빠진 날은 **되돌리고**(예정), 새로 들어온 날은 **적용**합니다.
 * 두 곳(셔틀·출석부)을 한 짝으로 고치는 `applyAttendance` 만 부릅니다 - 여기서 표를 직접
 * 만지면 한쪽만 되는 날이 옵니다.
 *
 * 사람이 손으로 찍은 줄은 건드리지 않습니다(`applyAttendance` 의 규칙). 주말·쉬는 날은
 * 적용하지 않습니다 - 그날 결석은 거짓 숫자입니다.
 */
export type EntryShape = {
  id: string;
  student_id: string | null;
  student_name: string;
  status: string;
  state: string;
  date_from: string | null;
  date_to: string | null;
  source: string | null;
};

const ACTIONS: Record<string, AttendanceAction | undefined> = { 결석: "결석", 지각: "지각", 조퇴: "조퇴" };

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00+09:00`);
  const end = new Date(`${to}T12:00:00+09:00`);
  while (d <= end && out.length < 60) {
    out.push(d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function datesOf(e: EntryShape | null): Set<string> {
  if (!e || e.state !== "등록" || !e.date_from) return new Set();
  return new Set(daysBetween(e.date_from, e.date_to ?? e.date_from));
}

export async function reconcileEntryChange(
  supabase: SupabaseClient,
  before: EntryShape,
  after: EntryShape,
  actor: { email: string; name: string | null },
): Promise<{ undone: string[]; applied: string[]; notes: string[]; errors: string[] }> {
  const out = { undone: [] as string[], applied: [] as string[], notes: [] as string[], errors: [] as string[] };
  const studentId = after.student_id ?? before.student_id;
  if (!studentId) return out;

  const prevAction = ACTIONS[before.status];
  const nextAction = ACTIONS[after.status];
  const prevDays = prevAction ? datesOf(before) : new Set<string>();
  const nextDays = nextAction ? datesOf(after) : new Set<string>();
  const statusChanged = before.status !== after.status;

  const toUndo = [...prevDays].filter((d) => statusChanged || !nextDays.has(d));
  const toApply = [...nextDays].filter((d) => statusChanged || !prevDays.has(d));
  if (toUndo.length === 0 && toApply.length === 0) return out;

  // 그 아이의 셔틀 배정. 요일은 날짜마다 다시 봅니다 - 화·목만 타는 아이의 월요일에 결석을 찍으면
  // 안 타는 날에 결석이 붙습니다.
  const { data: asg } = await supabase
    .from("shuttle_assignments_basic")
    .select("id, student_name_raw, weekdays")
    .eq("student_id", studentId);
  type Asg = { id: string; student_name_raw: string; weekdays: number[] | null };
  const assignments = (asg as Asg[] | null) ?? [];
  const forDay = (day: string) => {
    const wd = new Date(`${day}T12:00:00+09:00`).getDay();
    return assignments.filter((a) => !a.weekdays || a.weekdays.length === 0 || a.weekdays.includes(wd)).map((a) => ({ id: a.id, student_name_raw: a.student_name_raw }));
  };

  // 쉬는 날은 적용하지 않습니다. 되돌리기는 쉬는 날이어도 합니다 - 잘못 들어간 것을 빼는 일입니다.
  const { data: offRows } = await supabase.from("school_days").select("day").eq("is_school_day", false).in("day", toApply.length ? toApply : ["1900-01-01"]);
  const off = new Set(((offRows as { day: string }[] | null) ?? []).map((r) => r.day));

  const source = after.source === "googlechat" ? "구글챗" : after.source === "manual" ? "직접 등록" : "토들";

  // 같은 아이의 다른 등록 줄이 그 날을 덮고 있으면 「예정」으로 되돌리지 않습니다 - 토들과
  // 구글챗에 같은 결석이 두 줄로 들어와 있는데 한 줄의 날짜를 줄이면, 남은 줄의 결석까지 풀립니다.
  const { data: othersRaw } = toUndo.length
    ? await supabase
        .from("attendance_entries")
        .select("id, status, date_from, date_to")
        .eq("student_id", studentId)
        .eq("state", "등록")
        .neq("id", after.id)
    : { data: [] };
  const others = ((othersRaw as { status: string; date_from: string | null; date_to: string | null }[] | null) ?? []).filter((o) => ACTIONS[o.status]);
  const coveredBy = (day: string) => others.find((o) => o.date_from && o.date_from <= day && (o.date_to ?? o.date_from) >= day);

  for (const day of toUndo) {
    const cover = coveredBy(day);
    if (cover) {
      out.notes.push(`${day.slice(5)}은 다른 줄(${cover.status})이 덮고 있어 그대로 둠`);
      continue;
    }
    const r = await applyAttendance(supabase, {
      studentId,
      studentName: after.student_name,
      serviceDate: day,
      action: "예정",
      assignments: forDay(day),
      actor,
      source,
    });
    out.errors.push(...r.errors);
    if (r.errors.length === 0) out.undone.push(day);
  }
  for (const day of toApply) {
    const wd = new Date(`${day}T12:00:00+09:00`).getDay();
    if (wd === 0 || wd === 6 || off.has(day)) {
      out.notes.push(`${day.slice(5)}은 쉬는 날이라 넣지 않았습니다`);
      continue;
    }
    const r = await applyAttendance(supabase, {
      studentId,
      studentName: after.student_name,
      serviceDate: day,
      action: nextAction!,
      assignments: forDay(day),
      actor,
      source,
    });
    out.errors.push(...r.errors);
    if (r.errors.length === 0) out.applied.push(day);
  }
  return out;
}

/** 화면에 띄울 한 줄. */
export function reconcileSummary(r: { undone: string[]; applied: string[]; notes: string[] }): string | null {
  const parts: string[] = [];
  if (r.undone.length) parts.push(`${r.undone.map((d) => d.slice(5)).join("·")} 되돌림`);
  if (r.applied.length) parts.push(`${r.applied.map((d) => d.slice(5)).join("·")} 적용`);
  parts.push(...r.notes);
  return parts.length ? `셔틀·출석부: ${parts.join(" / ")}` : null;
}

/**
 * **등록된 줄 하나를 내렸을 때 셔틀 체크표를 따라 고칩니다.**
 *
 * 내리기(`undoAttendanceEntries`)는 출석부의 자동 줄만 지우고 **셔틀 체크표의 결석 표시는
 * 남겨 두었습니다.** 그리고 같은 아이에게 같은 결석이 두 줄로 겹쳐 있으면(학부모가 토들과
 * 구글챗에 같은 내용을 올린 경우) 하나를 내렸다고 그 날들을 모두 「예정」으로 돌리면 안 됩니다 -
 * 남은 줄이 아직 그 날을 덮고 있습니다.
 *
 * 그래서 날마다 봅니다. 남은 줄이 덮는 날은 **그 줄의 갈래로 다시 겁니다**(출석부 줄도 다시
 * 생깁니다). 아무도 안 덮는 날만 「예정」으로 되돌립니다.
 */
export async function reconcileDismissal(
  supabase: SupabaseClient,
  dismissed: EntryShape,
  actor: { email: string; name: string | null },
): Promise<{ undone: string[]; applied: string[]; notes: string[]; errors: string[] }> {
  const out = { undone: [] as string[], applied: [] as string[], notes: [] as string[], errors: [] as string[] };
  if (!dismissed.student_id || !ACTIONS[dismissed.status]) return out;
  const days = [...datesOf({ ...dismissed, state: "등록" })];
  if (days.length === 0) return out;

  const { data: othersRaw } = await supabase
    .from("attendance_entries")
    .select("id, student_id, student_name, status, state, date_from, date_to, source")
    .eq("student_id", dismissed.student_id)
    .eq("state", "등록")
    .neq("id", dismissed.id)
    .lte("date_from", days[days.length - 1])
    .gte("date_to", days[0]);
  const others = ((othersRaw as EntryShape[] | null) ?? []).filter((o) => ACTIONS[o.status]);

  const { data: asg } = await supabase
    .from("shuttle_assignments_basic")
    .select("id, student_name_raw, weekdays")
    .eq("student_id", dismissed.student_id);
  type Asg = { id: string; student_name_raw: string; weekdays: number[] | null };
  const assignments = (asg as Asg[] | null) ?? [];
  const forDay = (day: string) => {
    const wd = new Date(`${day}T12:00:00+09:00`).getDay();
    return assignments.filter((a) => !a.weekdays || a.weekdays.length === 0 || a.weekdays.includes(wd)).map((a) => ({ id: a.id, student_name_raw: a.student_name_raw }));
  };
  const sourceOf = (e: EntryShape) => (e.source === "googlechat" ? "구글챗" : e.source === "manual" ? "직접 등록" : "토들") as "구글챗" | "직접 등록" | "토들";

  for (const day of days) {
    const cover = others.find((o) => o.date_from && o.date_from <= day && (o.date_to ?? o.date_from) >= day);
    const r = await applyAttendance(supabase, {
      studentId: dismissed.student_id,
      studentName: (cover ?? dismissed).student_name,
      serviceDate: day,
      action: cover ? ACTIONS[cover.status]! : "예정",
      assignments: forDay(day),
      actor,
      source: sourceOf(cover ?? dismissed),
    });
    out.errors.push(...r.errors);
    if (r.errors.length === 0) (cover ? out.applied : out.undone).push(day);
  }
  if (out.applied.length > 0) out.notes.push(`겹친 다른 줄이 있어 ${out.applied.map((d) => d.slice(5)).join("·")}은 그대로 둠`);
  return out;
}
