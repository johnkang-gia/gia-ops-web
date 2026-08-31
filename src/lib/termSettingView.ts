import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrTermClassSnapshot } from "@/lib/types";
import type { TermOption } from "@/components/school/TermSettingTabs";

// 반/담임 배정 관리와 과목반 세팅이 **똑같이** 필요로 하는 것을 한 곳에서 읽습니다.
// 두 화면에 같은 코드를 두 번 적으면 한쪽만 고치는 실수가 반드시 납니다.

export type TermSettingView = {
  terms: TermOption[];
  currentTermId: string | null;
  selectedTermId: string | null;
  /** 지금 진행중 학기를 보고 있는가. true면 편집 화면, false면 보관본(읽기 전용). */
  isCurrent: boolean;
  selectedLabel: string;
  snapshot: WrTermClassSnapshot | null;
};

function label(t: { year: string | null; term_type: string | null }): string {
  return `${t.year ?? ""} ${t.term_type ?? ""}`.trim() || "이름 없는 학기";
}

export async function loadTermSettingView(
  supabase: SupabaseClient,
  requestedTermId: string | undefined
): Promise<TermSettingView> {
  const { data: termRows } = await supabase
    .from("terms")
    .select("id, year, term_type, status, start_date")
    .order("year", { ascending: false })
    .order("start_date", { ascending: false })
    .limit(24);

  const rows = (termRows ?? []) as {
    id: string;
    year: string | null;
    term_type: string | null;
    status: "진행중" | "종료";
    start_date: string | null;
  }[];

  // 어느 학기에 기록이 남아 있는지 미리 알아야 고르개에서 흐리게 표시할 수 있습니다.
  const { data: snapRows } = await supabase.from("wr_term_class_snapshots").select("term_id");
  const hasSnap = new Set(((snapRows ?? []) as { term_id: string }[]).map((s) => s.term_id));

  const currentTermId = rows.find((t) => t.status === "진행중")?.id ?? null;
  // 요청한 학기가 목록에 없으면(지워졌거나 잘못된 주소) 진행중 학기로 되돌립니다.
  const selectedTermId = requestedTermId && rows.some((t) => t.id === requestedTermId) ? requestedTermId : currentTermId;
  const isCurrent = !!currentTermId && selectedTermId === currentTermId;

  const selectedRow = rows.find((t) => t.id === selectedTermId) ?? null;
  const selectedLabel = selectedRow ? label(selectedRow) : "학기";

  let snapshot: WrTermClassSnapshot | null = null;
  if (!isCurrent && selectedTermId) {
    const { data } = await supabase
      .from("wr_term_class_snapshots")
      .select("*")
      .eq("term_id", selectedTermId)
      .maybeSingle();
    snapshot = (data as WrTermClassSnapshot | null) ?? null;
  }

  return {
    terms: rows.map((t) => ({ id: t.id, label: label(t), status: t.status, hasSnapshot: hasSnap.has(t.id) })),
    currentTermId,
    selectedTermId,
    isCurrent,
    selectedLabel,
    snapshot,
  };
}
