import { createClient } from "@/lib/supabase/server";
import type { ManualSection, ManualReviewFlag } from "@/lib/types";
import ManualsClient from "@/components/manuals/ManualsClient";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

// 학교 문서함(운영계획안/매뉴얼)에서 링크로 바로 들어올 때 원하는 탭이 먼저 열리도록
// ?doc=학부모용 / ?doc=실무자용 쿼리를 읽어 초기 탭으로 넘겨줍니다.
export default async function ManualsPage({
  searchParams,
}: {
  searchParams: Promise<{ doc?: string }>;
}) {
  const supabase = await createClient();
  const { doc } = await searchParams;

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().slice(0, 10);

  const [{ data }, me, { data: patternRows }, { data: flagRows }] = await Promise.all([
    supabase
      .from("manual_sections")
      .select("*")
      .order("target_doc", { ascending: true })
      .order("category", { ascending: true }),
    getCurrentAppUser(),
    // 홈 화면의 "반복 사건 패턴 감지"와 완전히 동일한 방식(AI 호출 없이 순수 집계, 비용 0)을
    // 매뉴얼 화면에서도 재사용해서, 어떤 항목이 최근 반복적으로 발생한 사건과 연결되는지
    // 보여줍니다(요청 2번).
    supabase
      .from("incidents")
      .select("date, title, manual_cat")
      .not("manual_cat", "is", null)
      .gte("date", ninetyDaysAgoStr)
      .order("date", { ascending: false }),
    // 정기 리뷰 사이클(요청 8번)에서 크론이 남긴 미해결 플래그입니다.
    supabase
      .from("manual_review_flags")
      .select("*")
      .eq("resolved", false)
      .order("created_at", { ascending: false }),
  ]);

  const grouped = new Map<string, number>();
  for (const row of (patternRows as { manual_cat: string }[] | null) ?? []) {
    const key = (row.manual_cat || "").trim();
    if (!key) continue;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }
  const recurringCategoryCounts: Record<string, number> = {};
  for (const [cat, count] of grouped.entries()) {
    if (count >= 3) recurringCategoryCounts[cat] = count;
  }

  const initialDoc = doc === "학부모용" || doc === "실무자용" ? doc : undefined;

  return (
    <ManualsClient
      initialItems={(data as ManualSection[]) ?? []}
      initialDoc={initialDoc}
      me={me ? { email: me.email, name: me.name || me.email } : null}
      recurringCategoryCounts={recurringCategoryCounts}
      initialReviewFlags={(flagRows as ManualReviewFlag[]) ?? []}
      isAdmin={isAdminUser(me ? { email: me.email, position: me.position, previewOf: me.previewOf } : null)}
    />
  );
}
