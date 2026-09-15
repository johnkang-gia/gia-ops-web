import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **출결 한 줄을 없던 일로 되돌립니다 — 되돌리는 자리는 여기 한 곳입니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 출결을 등록하면 **두 곳에 자국이 남습니다.**
 *
 *   ① `attendance_entries`  — 인박스의 등록 줄
 *   ② `attendance_records`  — **출석부**. 학기 출석률이 이 표에서 나옵니다.
 *
 * 그런데 내리는 쪽은 ①만 고쳤습니다. 화면마다 `state = '무시'` 로 바꾸는 코드가 따로
 * 있었고, 어느 것도 출석부를 건드리지 않았습니다. 그래서 인박스에서 내린 결석이
 * **출석부에는 그대로 남습니다** — 오지도 않은 결석이 그 아이의 학기 출석률을 깎는데,
 * 화면에는 오류가 아니라 「결석 한 줄」로 보입니다. 학기 말 통지표에 가서야 드러납니다.
 *
 * ── 무엇을 되돌리고 무엇을 안 되돌리나 ──────────────────────────────────────
 *
 * **담임이 출석부에서 직접 찍은 줄은 건드리지 않습니다**(`confirmed_by_human`). 담임이
 * 그날 교실에서 보고 찍은 값이 인박스 판단보다 셉니다. 그런 줄이 있으면 세어서 돌려주고,
 * 화면이 「이건 손대지 않았습니다」를 적습니다 - 조용히 남기면 「왜 아직 결석이지」가 됩니다.
 *
 * 되돌릴 때 **지우지 않고 「무시」로 둡니다.** 지우면 다음 스캔이 같은 연락을 다시 읽어
 * 되살립니다 - 「없음」과 「아니라고 판단했음」은 다른 말입니다.
 */

export type AttendanceUndoResult = {
  /** 「무시」로 내린 등록 줄 수. */
  entries: number;
  /** 함께 지운 출석부 줄 수. */
  records: number;
  /** 담임이 직접 찍어둬서 **건드리지 않은** 출석부 줄 수. */
  keptByHuman: number;
  /** 되돌리다 실패한 것. 비어 있지 않으면 **사람에게 그대로 보여줍니다.** */
  problems: string[];
};

export type UndoTarget =
  /** 줄 번호로 고릅니다(화면에서 ✕ 를 누른 자리). */
  | { ids: string[] }
  /** 그 연락이 만든 줄 전부(픽업을 되돌릴 때). */
  | { sourceMessageId: string };

export async function undoAttendanceEntries(
  supabase: SupabaseClient,
  target: UndoTarget,
  note: string,
): Promise<AttendanceUndoResult> {
  const out: AttendanceUndoResult = { entries: 0, records: 0, keptByHuman: 0, problems: [] };

  // ── ① 되돌릴 줄을 먼저 읽습니다 ─────────────────────────────────────────
  //
  // 고친 **뒤에** 읽으면 무엇을 고쳤는지 알 수 없어 출석부를 못 따라갑니다.
  let q = supabase.from("attendance_entries").select("id, student_id, status, date_from, date_to").neq("state", "무시");
  q = "ids" in target ? q.in("id", target.ids) : q.eq("source_message_id", target.sourceMessageId);
  const { data: rows, error: readErr } = await q;
  if (readErr) {
    out.problems.push(`되돌릴 출결 줄을 읽지 못했습니다: ${readErr.message}`);
    return out;
  }
  const targets = (rows as { id: string }[] | null) ?? [];
  if (targets.length === 0) return out;
  const ids = targets.map((r) => r.id);

  // ── ② 인박스 줄을 내립니다 ──────────────────────────────────────────────
  const { data: done, error: updErr } = await supabase
    .from("attendance_entries")
    .update({
      state: "무시",
      // 사람이 손댄 표시. 이게 켜지면 자동 스캔이 다시는 이 줄을 건드리지 않습니다 -
      // 「지웠는데 되살아난다」를 막는 자리입니다.
      touched_by_human: true,
      note,
      registered_at: null,
      registered_by: null,
    })
    .in("id", ids)
    .select("id");
  if (updErr) {
    out.problems.push(`출결 등록을 내리지 못했습니다: ${updErr.message}`);
    return out;
  }
  out.entries = (done ?? []).length;

  // ── ③ 출석부를 따라 내립니다 ────────────────────────────────────────────
  //
  // 자동이 넣은 줄은 `entry_id` 로 그 등록 줄을 가리킵니다. 그 연결로만 지웁니다 -
  // 학생·날짜로 지우면 담임이 따로 찍은 다른 줄까지 휩쓸립니다.
  const { data: kept } = await supabase
    .from("attendance_records")
    .select("id")
    .in("entry_id", ids)
    .eq("confirmed_by_human", true);
  out.keptByHuman = (kept ?? []).length;

  const { data: gone, error: delErr } = await supabase
    .from("attendance_records")
    .delete()
    .in("entry_id", ids)
    .eq("confirmed_by_human", false)
    .select("id");
  if (delErr) {
    // 인박스는 내렸는데 출석부가 남았습니다. **조용히 넘기면 가장 나쁩니다** - 화면에서는
    // 사라졌는데 출석률만 계속 깎입니다.
    out.problems.push(`출석부에서 지우지 못했습니다(출석률에 그대로 남습니다): ${delErr.message}`);
  } else {
    out.records = (gone ?? []).length;
  }

  return out;
}

/** 화면에 띄울 한 줄. 무엇이 함께 내려갔는지 사람이 바로 알 수 있게 적습니다. */
export function attendanceUndoSummary(r: AttendanceUndoResult): string {
  if (r.entries === 0) return "내릴 출결 줄이 없었습니다.";
  const parts = [`출결 ${r.entries}건을 내렸습니다`];
  if (r.records > 0) parts.push(`출석부 ${r.records}일치도 함께 지웠습니다`);
  const kept = r.keptByHuman > 0 ? ` 담임이 직접 찍은 ${r.keptByHuman}일치는 그대로 두었습니다.` : "";
  return `${parts.join(" · ")}.${kept}`.trim();
}
