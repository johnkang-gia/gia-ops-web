import type { ChecklistAnchor, ChecklistTemplate, Term } from "./types";

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 템플릿의 anchor(학기 시작일/종료일)에서 offset_days만큼 앞선 실제 날짜를 계산합니다.
// 학기에 시작일/종료일이 아직 입력되지 않았으면(학기 관리에서 날짜를 안 넣은 경우) null을
// 돌려주고, 호출하는 쪽에서 그 템플릿은 건너뜁니다.
function computeDueDate(term: Term, anchor: ChecklistAnchor, offsetDays: number): string | null {
  const base = anchor === "term_start" ? term.start_date : term.end_date;
  if (!base) return null;
  const d = new Date(base);
  d.setDate(d.getDate() - offsetDays);
  return toDateStr(d);
}

// 진행중 학기에 대해 아직 생성되지 않은 활성 템플릿의 체크리스트 항목을 만들어줍니다. 여러
// 직원이 이 페이지를 거의 동시에 열어도, DB의 unique(template_id, term_id) 제약 덕분에
// 중복 없이 한 번만 생성됩니다(뒤늦게 도착한 삽입은 23505 오류를 조용히 무시합니다).
export async function ensureChecklistItemsForTerm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  term: Term,
  templates: ChecklistTemplate[]
): Promise<void> {
  const activeTemplates = templates.filter((t) => t.active);
  if (activeTemplates.length === 0) return;

  const { data: existing } = await supabase
    .from("academic_checklist_items")
    .select("template_id")
    .eq("term_id", term.id);
  const existingIds = new Set(
    ((existing as { template_id: string | null }[] | null) ?? []).map((r) => r.template_id)
  );

  const pending = activeTemplates.filter((t) => !existingIds.has(t.id));
  const rows = pending
    .map((t) => {
      const dueDate = computeDueDate(term, t.anchor, t.offset_days);
      if (!dueDate) return null;
      return {
        template_id: t.id,
        term_id: term.id,
        title: t.title,
        description: t.description,
        department: t.department,
        due_date: dueDate,
        // 기간(요청 ④). 0이면 하루짜리라 end_date를 비워둡니다 - 지금까지 만들어진
        // 항목과 똑같이 취급되도록.
        end_date: (t.duration_days ?? 0) > 0 ? addDays(dueDate, t.duration_days) : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;
  const { data: inserted, error } = await supabase
    .from("academic_checklist_items")
    .insert(rows)
    .select("id, template_id, due_date, term_id");
  if (error && error.code !== "23505") {
    console.error("학사일정 항목 자동 생성 실패:", error.message);
    return;
  }

  // 회의 줄(요청 ⑤). 항목이 만들어지는 그 자리에서 함께 만듭니다 - 나중에 따로 만들게
  // 하면 "회의 필요"만 켜두고 아무 일도 안 일어나는 상태가 생깁니다.
  const madeItems = (inserted as { id: string; template_id: string | null; due_date: string; term_id: string | null }[] | null) ?? [];
  const byTemplate = new Map(activeTemplates.map((t) => [t.id, t]));
  const meetingRows: Record<string, unknown>[] = [];
  for (const it of madeItems) {
    const t = it.template_id ? byTemplate.get(it.template_id) : undefined;
    if (!t?.needs_meeting) continue;
    for (const m of meetingDates(it.due_date, t.meeting_count, t.meeting_interval_days)) {
      meetingRows.push({
        item_id: it.id,
        term_id: it.term_id,
        seq: m.seq,
        meet_date: m.date,
        title: `${t.title} ${m.seq}차 회의`,
      });
    }
  }
  if (meetingRows.length > 0) {
    const { error: mErr } = await supabase.from("academic_checklist_meetings").insert(meetingRows);
    if (mErr && mErr.code !== "23505") console.error("학사일정 회의 자동 생성 실패:", mErr.message);
  }
}

/** 날짜 문자열에 며칠을 더합니다. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/**
 * 회의 날짜를 정합니다.
 *
 * 담당자: "주당 1번, 그 한 주 동안 일을 맡아 처리하고 다시 모여서 처리한 일과 결정한 일에
 *         대해 회의. 그래서 최소 2번."
 *
 * 그래서 **마지막 회의를 마감일에 두고** 거꾸로 간격만큼 거슬러 올라갑니다. 2번·7일이면
 * 마감일과 그 일주일 전 - 첫 모임에서 나누고, 한 주 하고, 마감날 모여 마무리합니다.
 * 앞에서부터 세면 마지막 회의가 마감 뒤로 밀려 아무 쓸모가 없어집니다.
 */
export function meetingDates(dueDate: string, count: number, intervalDays: number): { seq: number; date: string }[] {
  const n = Math.max(1, Math.min(12, count || 1));
  const gap = Math.max(1, intervalDays || 7);
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    date: addDays(dueDate, -(n - 1 - i) * gap),
  }));
}

export const ANCHOR_LABEL: Record<ChecklistAnchor, string> = {
  term_start: "학기 시작일",
  term_end: "학기 종료일",
};
