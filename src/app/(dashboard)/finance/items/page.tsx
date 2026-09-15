import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import FeeItemsClient from "@/components/finance/FeeItemsClient";
import { loadFeeItemsPanel } from "@/lib/panels/feeItems";

// 학비외 항목 등록(재무 전용).
//
// 이 화면은 이제 **[청구 → 학비외] 표 위의 팝업**에서도 열립니다. 주소는 그대로 살려둡니다 -
// 즐겨찾기와 옛 링크가 끊기면 안 됩니다. 자료를 모으는 일은 두 자리가 **같은 함수**를
// 씁니다(`loadFeeItemsPanel`) - 두 곳에 적으면 어느 날 한쪽에만 칸이 늘고, 그러면 같은
// 화면인데 팝업에서만 고를 것이 없는 상태가 됩니다.
//
// 화면 단에서 한 번, DB(RLS)에서 또 한 번 막습니다. 화면만 막으면 주소를 직접 치는 것으로
// 뚫리고, RLS만 막으면 화면이 빈 채로 떠서 "고장난 건가" 싶어집니다.

export const dynamic = "force-dynamic";

export default async function FeeItemsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const d = await loadFeeItemsPanel(supabase);

  return (
    <FeeItemsClient
      initialItems={d.initialItems}
      initialCategories={d.initialCategories}
      terms={d.terms}
      gradesByDept={d.gradesByDept}
      classesByDept={d.classesByDept}
      classesByGrade={d.classesByGrade}
      groups={d.groups}
      usageByItem={d.usageByItem}
      currentUserEmail={me.email}
      loadError={d.loadError}
    />
  );
}
