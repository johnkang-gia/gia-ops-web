import type { ChecklistAnchor, ChecklistTemplate, Term } from "./types";
import { anchorDate, repeatDates, type AnchorNode } from "./academicRepeat";

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 이 규칙이 이번 학기에 **어느 날들에** 걸리는가.
 *
 * 학기 기준('term')은 한 학기에 한 번이라 날짜 하나, 매년·매달·매주는 학기 안에 여러 번
 * 걸리므로 여러 개가 나옵니다. 계산 자체는 `@/lib/academicRepeat` 한 곳에서만 합니다 -
 * 화면·크론·미리보기가 각자 세면 화면에 뜬 날짜와 실제로 업무가 올라오는 날이 갈립니다.
 *
 * 못 정하면 **빈 배열**입니다. 학기 날짜가 아직 없거나, 기준으로 삼은 일정이 지워졌거나,
 * 기준이 서로 물려 있는 경우입니다. 그때 아무 날짜나 채우면 그 날짜가 사실처럼 굳습니다.
 */
function occurrencesFor(term: Term, t: ChecklistTemplate, nodes: Map<string, AnchorNode>): string[] {
  const kind = t.repeat_kind ?? "term";
  if (kind === "term") {
    const node = nodes.get(t.id);
    const day = node ? anchorDate(node, nodes, { start: term.start_date, end: term.end_date }) : null;
    return day ? [day] : [];
  }
  // 매년·매달·매주는 **학기 안에서만** 만듭니다. 학기 밖까지 만들면 지난 학기·다음 학기
  // 항목이 이번 학기 목록에 섞여 무엇이 오늘 할 일인지 알 수 없게 됩니다.
  if (!term.start_date || !term.end_date) return [];
  return repeatDates(
    { kind, month: t.repeat_month, day: t.repeat_day, dow: t.repeat_dow },
    term.start_date,
    term.end_date,
  );
}

// 진행중 학기에 대해 아직 만들어지지 않은 활성 규칙의 항목을 만듭니다. 여러 직원이 이
// 페이지를 거의 동시에 열어도, DB의 유일 인덱스(template_id, term_id, occurrence_key)
// 덕분에 중복 없이 한 번만 만들어집니다(뒤늦게 도착한 삽입은 23505를 조용히 무시합니다).
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
    .select("template_id, occurrence_key")
    .eq("term_id", term.id);
  // 「이미 있는 것」의 열쇠를 **회차까지** 넣어 셉니다. 규칙 하나만 보고 건너뛰면 매주
  // 되풀이가 첫 회차만 만들어지고 나머지는 조용히 사라집니다.
  const existingKeys = new Set(
    ((existing as { template_id: string | null; occurrence_key: string | null }[] | null) ?? []).map(
      (r) => `${r.template_id}|${r.occurrence_key ?? ""}`,
    ),
  );

  // 「다른 일정 기준」을 풀려면 규칙 전체가 필요합니다(꺼진 것도 기준은 될 수 있습니다).
  const nodes = new Map<string, AnchorNode>(
    templates.map((t) => [
      t.id,
      { id: t.id, anchor: t.anchor, offsetDays: t.offset_days, anchorTemplateId: t.anchor_template_id ?? null },
    ]),
  );

  const rows = activeTemplates.flatMap((t) => {
    const days = occurrencesFor(term, t, nodes);
    // 학기 기준 한 건짜리는 예전처럼 occurrence_key 를 비워 둡니다 - 이미 만들어진 줄과
    // 같은 열쇠를 써야 중복으로 다시 만들지 않습니다.
    const single = (t.repeat_kind ?? "term") === "term";
    return days
      .map((dueDate) => {
        const occ = single ? null : dueDate;
        if (existingKeys.has(`${t.id}|${occ ?? ""}`)) return null;
        return {
          template_id: t.id,
          term_id: term.id,
          title: t.title,
          description: t.description,
          department: t.department,
          due_date: dueDate,
          occurrence_key: occ,
          // 기간. 0이면 하루짜리라 end_date를 비워둡니다 - 지금까지 만들어진 항목과
          // 똑같이 취급되도록.
          end_date: (t.duration_days ?? 0) > 0 ? addDays(dueDate, t.duration_days) : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  });

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
