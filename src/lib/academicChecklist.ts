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
export function computeDueDate(term: Term, anchor: ChecklistAnchor, offsetDays: number): string | null {
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

  const rows = activeTemplates
    .filter((t) => !existingIds.has(t.id))
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
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return;
  const { error } = await supabase.from("academic_checklist_items").insert(rows);
  if (error && error.code !== "23505") {
    console.error("학사일정 항목 자동 생성 실패:", error.message);
  }
}

export const ANCHOR_LABEL: Record<ChecklistAnchor, string> = {
  term_start: "학기 시작일",
  term_end: "학기 종료일",
};
