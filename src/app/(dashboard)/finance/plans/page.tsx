import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess, isSuperAdminUser } from "@/lib/roles";
import type { FeePlan, FeePaymentOption, FeeDiscount } from "@/lib/types";
import FeePlansClient from "@/components/finance/FeePlansClient";

// 요금제 · 할인 (재무 전용)
//
// 담당자: "할인률과 항목들을 자유롭게 설정할 수 있게 (물론 재무 관련 권한이 있는 사람이)
//         만들어줘. 형제할인 같은 부분 원래는 있는데 없애신다고 하셨거든. 그래서 할인 항목의
//         경우 자유롭게 만들었다가 없앴다가 될 수 있게."
//
// 화면 단에서 한 번, DB(RLS)에서 또 한 번 막습니다. 화면만 막으면 주소를 직접 치는 것으로
// 뚫리고, RLS만 막으면 화면이 빈 채로 떠서 "고장난 건가" 싶어집니다. 둘 다 필요합니다.

export const dynamic = "force-dynamic";

export default async function FeePlansPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 관리자여도 재무 열쇠가 없으면 이 화면은 없는 것과 같습니다.
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [plansRes, optionsRes, discountsRes] = await Promise.all([
    supabase.from("fee_plans").select("*").order("category").order("sort_order").order("name"),
    supabase.from("fee_payment_options").select("*").order("sort_order").order("periods"),
    supabase.from("fee_discounts").select("*").order("active", { ascending: false }).order("sort_order").order("name"),
  ]);

  const loadError = plansRes.error?.message ?? optionsRes.error?.message ?? discountsRes.error?.message ?? null;

  return (
    <FeePlansClient
      plans={(plansRes.data as FeePlan[] | null) ?? []}
      options={(optionsRes.data as FeePaymentOption[] | null) ?? []}
      discounts={(discountsRes.data as FeeDiscount[] | null) ?? []}
      canApprove={isSuperAdminUser(me)}
      currentUserEmail={me.email}
      loadError={loadError}
    />
  );
}
