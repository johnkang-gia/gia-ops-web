import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import FeeItemsClient from "@/components/finance/FeeItemsClient";
import type { FeeItem } from "@/lib/types";

// 학비외 항목 등록(재무 전용).
//
// 화면 단에서 한 번, DB(RLS)에서 또 한 번 막습니다. 화면만 막으면 주소를 직접 치는 것으로
// 뚫리고, RLS만 막으면 화면이 빈 채로 떠서 "고장난 건가" 싶어집니다.

export const dynamic = "force-dynamic";

export default async function FeeItemsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [itemsRes, clsRes] = await Promise.all([
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    supabase.from("wr_classes").select("grade, class_name").order("grade").order("class_name"),
  ]);

  // 학년·반 목록은 반 표에서 그대로 가져옵니다. 손으로 적어두면 반이 바뀔 때마다 어긋납니다.
  const rows = (clsRes.data as { grade: string | null; class_name: string | null }[] | null) ?? [];
  const grades = [...new Set(rows.map((r) => (r.grade ?? "").trim()).filter(Boolean))].sort(
    (a, b) => Number(a) - Number(b) || a.localeCompare(b),
  );
  const classes = [...new Set(rows.map((r) => (r.class_name ?? "").trim()).filter(Boolean))].sort();

  return (
    <FeeItemsClient
      initialItems={(itemsRes.data as FeeItem[] | null) ?? []}
      grades={grades}
      classes={classes}
      currentUserEmail={me.email}
      loadError={itemsRes.error?.message ?? null}
    />
  );
}
