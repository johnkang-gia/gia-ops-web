import type { SupabaseClient } from "@supabase/supabase-js";

// 하원 체크표에서 일어난 일을 한 줄씩 남깁니다.
//
// 체크표는 행정실·담임·동승 선생님이 함께 쓰는 화면이라, 한 아이의 표시가 바뀌어 있을 때
// "누가 왜 그랬나"를 물어볼 곳이 필요합니다. 지금까지는 마지막 상태만 있어서 그 물음에
// 답할 수가 없었습니다.

export type ChecklistAction = "상태변경" | "노선이동" | "메모";

/**
 * **왜 바꿨는가.**
 *
 * 「누가」는 이미 남고 있었습니다 - 그런데 자동이 한 일에는 「토들」이라고만 적혔습니다.
 * 토들은 사람이 아니라 창구 이름이라 물어볼 곳이 없고, 확인하려면 인박스로 넘어가 그 아이의
 * 연락을 다시 찾아야 했습니다. 그 연락이 나중에 정리되면 근거는 아예 사라집니다.
 *
 * 그래서 근거를 **판단이 일어난 그 순간에** 함께 굳힙니다. 담는 것은 요약이 아니라 **원문**
 * 입니다 - 요약은 이미 한 번 해석된 것이라, 해석이 틀렸을 때 그 사실을 요약 안에서는
 * 알아볼 수 없습니다.
 */
export type ChecklistReason = {
  /** 받은 글 그대로. */
  text: string;
  /** 어디서 왔나 — '토들' · '구글챗' · '출석부' · '하원수단' · '예약'. */
  source: string;
  /** 누구의 연락인가 — 방 이름·보낸 사람. 되물을 곳입니다. */
  from?: string | null;
  /** 원본으로 돌아가는 길. 없으면 비웁니다. */
  url?: string | null;
};

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
  reason_text?: string | null;
  reason_source?: string | null;
  reason_from?: string | null;
  reason_url?: string | null;
};

/** 기록 한 줄에서 근거를 꺼냅니다. 없으면 null - 사람이 직접 누른 줄에는 근거가 없습니다. */
export function reasonOf(r: ChecklistLogRow): ChecklistReason | null {
  const text = (r.reason_text ?? "").trim();
  if (!text) return null;
  return { text, source: r.reason_source ?? "출처 미상", from: r.reason_from ?? null, url: r.reason_url ?? null };
}

/** 표에 넣을 모양으로. 빈 글은 칸을 비워둡니다 - 빈 따옴표가 남으면 근거가 있는 줄로 보입니다. */
export function reasonColumns(reason?: ChecklistReason | null) {
  const text = (reason?.text ?? "").trim();
  if (!text) return {};
  return {
    // 원문이 아주 길 때가 있습니다(사진 설명이 붙은 토들 글). 기록은 되짚어 보기 위한
    // 것이라, 앞부분만으로도 무슨 이야기인지 알 수 있습니다.
    reason_text: text.slice(0, 1000),
    reason_source: reason?.source ?? null,
    reason_from: reason?.from ?? null,
    reason_url: reason?.url ?? null,
  };
}

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
    /** 왜 바꿨는가. 사람이 직접 누른 경우에는 없습니다. */
    reason?: ChecklistReason | null;
  },
): Promise<void> {
  const { error } = await supabase.from("shuttle_checklist_log").insert({
    ...reasonColumns(entry.reason),
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
  if (!error) return;
  // 42P01/PGRST205 = 표가 아직 없음(마이그레이션 전).
  if (error.code === "42P01" || error.code === "PGRST205") return;
  // PGRST204 = 근거 칸이 아직 없음. **근거를 못 담는다고 기록까지 버리지는 않습니다** -
  // 누가 바꿨는지라도 남는 편이 낫습니다. 대신 조용히 넘기지 않고 소리를 냅니다.
  if (error.code === "PGRST204" && entry.reason) {
    console.error("[checklistLog] 근거 칸이 아직 없습니다(마이그레이션 필요). 근거 없이 남깁니다:", error.message);
    await logChecklist(supabase, { ...entry, reason: null });
    return;
  }
  console.error("[checklistLog] 활동 기록 실패:", error.message, entry);
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
