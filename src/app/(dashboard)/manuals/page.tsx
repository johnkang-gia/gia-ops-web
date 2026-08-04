import { createClient } from "@/lib/supabase/server";
import type { ManualSection } from "@/lib/types";
import ManualsClient from "@/components/manuals/ManualsClient";

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
  const { data } = await supabase
    .from("manual_sections")
    .select("*")
    .order("target_doc", { ascending: true })
    .order("category", { ascending: true });

  const initialDoc = doc === "학부모용" || doc === "실무자용" ? doc : undefined;

  return <ManualsClient initialItems={(data as ManualSection[]) ?? []} initialDoc={initialDoc} />;
}
