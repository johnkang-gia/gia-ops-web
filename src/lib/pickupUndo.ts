import type { SupabaseClient } from "@supabase/supabase-js";
import { isHumanSet } from "./pickupIngest";
import { logChecklist, type LogActor } from "./checklistLog";

/**
 * **픽업 하나를 없던 일로 되돌립니다** — 되돌리는 자리는 여기 한 곳입니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 픽업 하나를 확정하면 **세 곳에 자국이 남습니다.**
 *
 *   ① `pickup_requests.status = '확정'`      — 인박스 목록
 *   ② `shuttle_boardings.status = '픽업'`    — 하원 체크표 (applyPickup 이 찍습니다)
 *   ③ `attendance_entries` · `tasks`         — 출결 등록과 업무보드의 노란 픽업 카드
 *
 * 그런데 되돌리는 쪽은 ①만 고쳤습니다. 인박스에서 「픽업 아님」을 눌러도 체크표의 줄은
 * 그대로 남고, 중앙 대시보드는 **체크표를 가장 세게** 읽습니다(`pickups.ts`). 그래서
 * 지운 아이가 대시보드에 계속 떴습니다 - 강하라가 그랬습니다.
 *
 * 화면에는 오류가 안 납니다. 담당자는 지웠다고 생각하고, 대시보드는 그 아이를 계속
 * 보여줍니다. 그러면 사람은 두 화면 중 어느 쪽도 안 믿게 됩니다.
 *
 * ── 무엇을 되돌리고 무엇을 안 되돌리나 ──────────────────────────────
 *
 * **사람이 체크표에서 직접 정한 줄은 건드리지 않습니다.** 담당자가 오늘 그 아이를 보고
 * 눌렀다면 그 판단이 인박스보다 셉니다. 자동(AI·크론)이 찍은 줄만 되돌립니다 - 판단의
 * 기준은 `applyPickup` 이 쓰는 것과 **같은 함수**(`isHumanSet`)입니다.
 *
 * 되돌릴 때 줄을 지우지 않고 **「탑승」으로 바꿉니다.** 지우면 그 아이가 오늘 명단에서
 * 통째로 사라져, 차가 그냥 떠날 수 있습니다. 픽업이 아니었다면 그 아이는 원래대로
 * 차를 타는 것이 맞습니다.
 */

export type UndoResult = {
  /** 체크표에서 픽업을 내린 줄 수. */
  boardings: number;
  /** 사람이 직접 정해둬서 건드리지 않은 줄 수. 화면이 「이건 손대지 않았습니다」를 적습니다. */
  keptByHuman: number;
  /** 함께 내린 출결 등록 수. */
  entries: number;
  /** 함께 내린 픽업 업무 수. */
  tasks: number;
  /** 되돌리다 실패한 것. 비어 있지 않으면 **사람에게 그대로 보여줍니다.** */
  problems: string[];
};

/**
 * 인박스에서 「픽업 아님」·「무시」를 눌렀을 때 함께 되돌립니다.
 *
 * `pickup_requests` 자체의 상태는 **부르는 쪽이 바꿉니다** - 「무시」인지 「문의로 정정」인지가
 * 자리마다 다르기 때문입니다. 여기서는 그 결정에 딸려오는 자국만 지웁니다.
 */
export async function undoPickupTraces(
  supabase: SupabaseClient,
  requestId: string,
  actor: LogActor,
): Promise<UndoResult> {
  const out: UndoResult = { boardings: 0, keptByHuman: 0, entries: 0, tasks: 0, problems: [] };

  const { data: req, error: readErr } = await supabase
    .from("pickup_requests")
    .select("id, student_id, service_date, matched_name, ai_student_name, task_id")
    .eq("id", requestId)
    .maybeSingle();
  if (readErr || !req) {
    out.problems.push(`그 연락을 읽지 못해 체크표·업무를 되돌리지 못했습니다: ${readErr?.message ?? "찾을 수 없음"}`);
    return out;
  }

  const studentId = (req.student_id as string | null) ?? null;
  const serviceDate = (req.service_date as string | null) ?? null;
  const name = ((req.matched_name as string | null) ?? (req.ai_student_name as string | null) ?? "이름 미확인").trim();

  // ── ② 체크표 ────────────────────────────────────────────────────────────
  if (studentId && serviceDate) {
    const { data: asgs, error: asgErr } = await supabase
      .from("shuttle_assignments")
      .select("id, student_name_raw")
      .eq("student_id", studentId);
    if (asgErr) out.problems.push(`탑승 배정을 읽지 못했습니다: ${asgErr.message}`);

    const ids = ((asgs as { id: string; student_name_raw: string | null }[] | null) ?? []).map((a) => a.id);
    if (ids.length > 0) {
      const { data: rows, error: bErr } = await supabase
        .from("shuttle_boardings")
        .select("id, assignment_id, status, checked_by")
        .eq("service_date", serviceDate)
        .in("assignment_id", ids);
      if (bErr) out.problems.push(`체크표를 읽지 못했습니다: ${bErr.message}`);

      for (const b of ((rows as { id: string; assignment_id: string; status: string; checked_by: string | null }[] | null) ?? [])) {
        if (b.status !== "픽업") continue;
        // 사람이 오늘 직접 정한 줄은 그대로 둡니다. 그 사람이 아이를 보고 눌렀습니다.
        if (isHumanSet(b.checked_by)) {
          out.keptByHuman += 1;
          continue;
        }
        const { error: upErr } = await supabase
          .from("shuttle_boardings")
          // boarding-ok: 되돌리는 자리라 「사람이 정한 줄은 건드리지 않는다」 검사를 먼저
          // 지나야 합니다. 기록은 바로 아래에서 똑같이 남깁니다.
          .update({ status: "탑승", checked_by: actor.name || actor.email })
          .eq("id", b.id);
        if (upErr) {
          out.problems.push(`체크표에서 픽업을 내리지 못했습니다: ${upErr.message}`);
          continue;
        }
        out.boardings += 1;
        await logChecklist(supabase, {
          serviceDate,
          assignmentId: b.assignment_id,
          studentName: name,
          action: "상태변경",
          before: "픽업",
          after: "탑승",
          actor,
        });
      }
    }
  }

  // ── ③ 출결 등록 ─────────────────────────────────────────────────────────
  const { data: entries, error: eErr } = await supabase
    .from("attendance_entries")
    .update({ state: "무시", touched_by_human: true, note: "픽업을 되돌려 함께 내렸습니다" })
    .eq("source_message_id", requestId)
    .neq("state", "무시")
    .select("id");
  if (eErr) out.problems.push(`출결 등록을 내리지 못했습니다: ${eErr.message}`);
  else out.entries = (entries ?? []).length;

  // ── ③ 픽업 업무 ─────────────────────────────────────────────────────────
  //
  // 업무보드의 노란 픽업 카드입니다. 안 내리면 「데리러 가세요」가 계속 떠 있고, 담당자는
  // 오지도 않는 아이를 데리러 갑니다.
  const taskId = (req.task_id as string | null) ?? null;
  if (taskId) {
    const now = new Date().toISOString();
    const { error: tErr } = await supabase
      .from("tasks")
      .update({ deleted_at: now, updated_by: actor.email })
      .eq("id", taskId)
      .is("deleted_at", null);
    if (tErr) out.problems.push(`픽업 업무를 내리지 못했습니다: ${tErr.message}`);
    else out.tasks = 1;
    // 다시 확정하면 업무를 새로 만들 수 있게 연결을 끊습니다. 안 끊으면 「이미 만들었다」로
    // 보고 건너뛰어, 두 번째에는 업무가 아예 안 생깁니다.
    await supabase.from("pickup_requests").update({ task_id: null }).eq("id", requestId);
  }

  return out;
}

/** 화면에 띄울 한 줄. 무엇이 함께 내려갔는지 사람이 바로 알 수 있게 적습니다. */
export function undoSummary(r: UndoResult): string {
  const parts: string[] = [];
  if (r.boardings > 0) parts.push(`체크표 ${r.boardings}건`);
  if (r.entries > 0) parts.push(`출결 등록 ${r.entries}건`);
  if (r.tasks > 0) parts.push("픽업 업무");
  const done = parts.length > 0 ? `${parts.join(" · ")}도 함께 내렸습니다.` : "";
  const kept = r.keptByHuman > 0 ? ` 체크표에서 사람이 직접 정한 ${r.keptByHuman}건은 그대로 두었습니다.` : "";
  return (done + kept).trim();
}
