import { redirect } from "next/navigation";
import { todayKst } from "@/lib/kst";

export const dynamic = "force-dynamic";

/**
 * 「학생별」 탭이 가리키는 **고정 주소**.
 *
 * 달은 주소에 들어가야 남에게 보낼 수 있는데(`/finance/monthly/2026-09`), 그러면 메뉴가
 * 가리킬 주소가 없습니다. 이 자리가 **오늘이 속한 달**로 보내줍니다.
 *
 * 달 이름을 메뉴에 적어두지 않는 이유: 적어두면 10월이 되어도 9월을 가리킵니다. 그건
 * 오류로 안 보이고 «지난달 숫자»로 보입니다.
 */
// finance-live-ok: 아무것도 안 그립니다. 오늘이 속한 달로 넘기기만 하고, 실시간은 그쪽 화면이 답니다.
export default async function FinanceMonthStudentsEntry() {
  redirect(`/finance/monthly/${todayKst().slice(0, 7)}`);
}
