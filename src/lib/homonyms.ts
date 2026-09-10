import { createClient } from "@/lib/supabase/server";
import type { HomonymEntry } from "@/components/common/HomonymProvider";

/**
 * 겹치는 이름과 그 아이들의 반을 읽어옵니다 — **로그인 영역 레이아웃에서 한 번만.**
 *
 * ── 왜 명부 전체를 안 보내나 ─────────────────────────────────────────
 *
 * 137명을 통째로 모든 화면에 딸려 보내면 첫 화면이 그만큼 늦어집니다. 실제로 필요한 것은
 * **겹치는 몇 이름과 그 아이들의 반**뿐입니다. 지금 학교에서는 김재이 셋을 비롯해 열 명
 * 남짓입니다.
 *
 * ── 못 읽었을 때 ─────────────────────────────────────────────────────
 *
 * 빈 목록을 돌려주면 화면은 **뱃지 없이 그냥 이름**을 그립니다. 그건 「겹치는 이름이
 * 없다」와 똑같이 보이는데, 뒤쪽은 김재이 셋이 구별 없이 뜬다는 뜻입니다. 그래서 조용히
 * 넘기지 않고 서버 기록에 남깁니다 - 화면을 막을 일은 아니지만, 왜 뱃지가 안 뜨는지
 * 물어볼 때 답할 자리는 있어야 합니다.
 */
export async function loadHomonyms(): Promise<HomonymEntry> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("wr_students")
    .select("id, name, grade, class_name")
    .eq("is_demo", false)
    .eq("status", "active");

  if (error) {
    console.error("[동명이인] 명부를 읽지 못해 반 뱃지를 못 붙입니다:", error.message);
    return { byId: {}, names: [] };
  }

  const rows = (data as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? [];

  const count = new Map<string, number>();
  for (const s of rows) {
    const k = (s.name ?? "").replace(/\s+/g, "").trim();
    if (!k) continue;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const names = [...count.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  const dup = new Set(names);

  const byId: Record<string, string> = {};
  for (const s of rows) {
    const k = (s.name ?? "").replace(/\s+/g, "").trim();
    if (!dup.has(k)) continue;
    // 반이 있으면 반(학년이 이름에 들어 있습니다: 「G2C」), 없으면 학년.
    const cls = (s.class_name ?? "").trim();
    const where = cls || (s.grade ? `${s.grade}학년` : "");
    if (where) byId[s.id] = where;
  }

  return { byId, names };
}
