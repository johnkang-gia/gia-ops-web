import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll } from "@/lib/financeFetch";
import { todayKst } from "@/lib/kst";
import RoundsClient, { type BatchRow, type BatchInvoice } from "@/components/finance/RoundsClient";

import { getFinanceScope, scopeStudentIds, inScopeIds } from "@/lib/financeScopeServer";
export const dynamic = "force-dynamic";

/**
 * **청구 회차** — 몇 월분 학비·학비외를 언제 몇 차로 냈는가.
 *
 * 회차 번호는 데이터베이스가 넣을 때 붙이고(`invoices.issue_batch`), 묶음 합계도 데이터베이스
 * 뷰(`invoice_batches`)가 냅니다. 화면이 장을 끌어와 다시 세면 한도에 걸렸을 때 숫자가 조용히
 * 줄어듭니다(CLAUDE.md §2-12).
 */
export default async function FinanceRoundsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [batchRes, invRes, payRes] = await Promise.all([
    supabase
      .from("invoice_batches")
      .select("billing_month, stream, issue_batch, issue_date, first_created_at, alive_count, cancelled_count, alive_amount, offline_count, issued_by")
      .order("billing_month", { ascending: false })
      .order("first_created_at"),
    // 회차를 펼쳤을 때 보이는 장. 금액 합계는 위 뷰가 내고, 여기서는 이름·번호만 씁니다.
    readAll<BatchInvoice>((from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_no, issue_batch, student_id, student_name, student_name_ko, total_amount, status, issued_offline, issue_date, due_date, carried_to_invoice_id, written_off_amount, exported_at, unpaid_checked_at, unpaid_checked_by")
        .not("issue_batch", "is", null)
        .order("issue_batch")
        .order("invoice_no")
        .range(from, to),
    ),
    // **수납 확인은 청구서 한 장 단위.** 회차를 펼쳤을 때 장마다 「완납·일부·미납·연체」가 바로 보여야
    // 보낸 뒤 확인하러 수납 화면을 따로 열지 않습니다. 자르지 않고 끝까지 읽습니다(§2-12).
    readAll<{ invoice_id: string | null; amount: number | string }>((from, to) =>
      supabase.from("payments").select("invoice_id, amount").range(from, to),
    ),
  ]);

  const problems = [batchRes.error?.message, invRes.error, invRes.truncated ? "청구서가 한도를 넘어 일부만 읽었습니다." : null, payRes.error, payRes.truncated ? "입금이 한도를 넘어 일부만 읽었습니다." : null].filter(
    (v): v is string => !!v,
  );

  // **장부가 한 부서면 회차를 그 부서 청구서로 다시 셉니다.** 회차 표(invoice_batches)는 학교 전체를
  // 세어 둔 것이라, 그대로 두면 초등 회계에 중고등 청구서 장수가 섞여 보입니다.
  const ids = await scopeStudentIds(supabase, await getFinanceScope(me));
  const allBatches = (batchRes.data as BatchRow[] | null) ?? [];
  const invoices = invRes.rows.filter((v) => inScopeIds(ids, v.student_id));
  const batches: BatchRow[] = !ids
    ? allBatches
    : allBatches.flatMap((b) => {
        const mine = invoices.filter((v) => v.issue_batch === b.issue_batch);
        if (mine.length === 0) return [];
        const alive = mine.filter((v) => v.status === "발행");
        return [
          {
            ...b,
            alive_count: alive.length,
            cancelled_count: mine.filter((v) => v.status === "취소").length,
            alive_amount: alive.reduce((n, v) => n + Number(v.total_amount), 0),
            offline_count: alive.filter((v) => v.issued_offline === true).length,
          },
        ];
      });

  return <RoundsClient batches={batches} invoices={invoices} payments={payRes.rows} today={todayKst()} problems={problems} />;
}
