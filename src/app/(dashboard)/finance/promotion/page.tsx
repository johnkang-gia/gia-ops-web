import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import PromotionClient from "@/components/finance/PromotionClient";

export const dynamic = "force-dynamic";

/** 진급 · 학기 넘기기. 계산은 서버(`promotion.ts`)가 하고, 이 화면은 미리보기와 단추만 그립니다. */
export default async function PromotionPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("terms")
    .select("id, term_type, year, status, start_date")
    .order("start_date", { ascending: false, nullsFirst: false });

  return (
    <PromotionClient
      terms={(data as { id: string; term_type: string; year: string; status: string; start_date: string | null }[] | null) ?? []}
      loadError={error?.message ?? null}
    />
  );
}
