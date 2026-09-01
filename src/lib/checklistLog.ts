import type { SupabaseClient } from "@supabase/supabase-js";

// 하원 체크표에서 일어난 일을 한 줄씩 남깁니다.
//
// 체크표는 행정실·담임·동승 선생님이 함께 쓰는 화면이라, 한 아이의 표시가 바뀌어 있을 때
// "누가 왜 그랬나"를 물어볼 곳이 필요합니다. 지금까지는 마지막 상태만 있어서 그 물음에
// 답할 수가 없었습니다.

export type ChecklistAction = "상태변경" | "노선이동" | "메모";

export type ChecklistLogRow = {
  id: string;
  service_date: string;
  assignment_id: string | null;
  student_name: string;
  action: ChecklistAction;
  before_value: string | null;
  after_value: string | null;
  actor_email: string;
  actor_name: string | null;
  created_at: string;
};

export type LogActor = { email: string; name: string | null };

/**
 * 기록을 남깁니다.
 *
 * **기록이 실패해도 본래 작업은 되돌리지 않습니다.** 픽업 표시는 아이가 차를 타느냐 마느냐의
 * 문제고, 기록은 나중에 되돌아보기 위한 것입니다. 둘의 무게가 다릅니다. 다만 조용히
 * 넘기지는 않습니다 - 기록이 며칠째 안 쌓이고 있는데 아무도 모르는 쪽이 더 나쁩니다.
 */
export async function logChecklist(
  supabase: SupabaseClient,
  entry: {
    serviceDate: string;
    term?: string | null;
    assignmentId: string | null;
    studentName: string;
    action: ChecklistAction;
    before?: string | null;
    after?: string | null;
    actor: LogActor;
  },
): Promise<void> {
  const { error } = await supabase.from("shuttle_checklist_log").insert({
    service_date: entry.serviceDate,
    term: entry.term ?? null,
    assignment_id: entry.assignmentId,
    student_name: entry.studentName,
    action: entry.action,
    before_value: entry.before ?? null,
    after_value: entry.after ?? null,
    actor_email: entry.actor.email,
    actor_name: entry.actor.name,
  });
  // 42P01/PGRST205 = 표가 아직 없음(마이그레이션 전). 그 밖의 실패는 소리를 냅니다.
  if (error && error.code !== "42P01" && error.code !== "PGRST205") {
    console.error("[checklistLog] 활동 기록 실패:", error.message, entry);
  }
}

/** "3분 전"처럼 짧게. 오늘 안의 일이라 날짜는 안 씁니다. */
export function shortAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 한 줄을 사람이 읽는 문장으로. 화면 여러 곳에서 같은 말이 나와야 합니다. */
export function describeLog(r: ChecklistLogRow): string {
  const who = r.actor_name || r.actor_email;
  if (r.action === "상태변경") {
    const to = r.after_value ?? "?";
    return to === "예정"
      ? `${who} · ${r.student_name} 표시를 지웠습니다`
      : `${who} · ${r.student_name} ${to}`;
  }
  if (r.action === "노선이동") {
    return `${who} · ${r.student_name} ${r.before_value ?? "?"} → ${r.after_value ?? "?"}`;
  }
  return `${who} · ${r.student_name} 메모 ${r.after_value ? "수정" : "삭제"}`;
}
