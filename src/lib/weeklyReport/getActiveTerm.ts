import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrTerm } from "@/lib/types";

// 활성 학기가 있으면 그것을, 없으면 보관되지 않은 첫 학기를 반환합니다(원본 앱의
// getActiveTerm() 로직과 동일한 우선순위).
export async function getActiveWrTerm(supabase: SupabaseClient): Promise<WrTerm | null> {
  const { data } = await supabase
    .from("wr_terms")
    .select("*")
    .order("created_at", { ascending: false });
  const terms = (data as WrTerm[] | null) ?? [];
  return (
    terms.find((t) => t.is_active && !t.is_archived) ??
    terms.find((t) => !t.is_archived) ??
    terms[0] ??
    null
  );
}
