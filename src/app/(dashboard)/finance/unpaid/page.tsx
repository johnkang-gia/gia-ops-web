import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll, readNotice } from "@/lib/financeFetch";
import { todayKst } from "@/lib/kst";
import UnpaidClient from "@/components/finance/UnpaidClient";
import type { UnpaidInvoice, UnpaidPayment } from "@/lib/unpaidLedger";

export const dynamic = "force-dynamic";

/**
 * **미납금** — 아직 안 받은 돈을 따로 모아 관리합니다.
 *
 * 예전에는 미납이 새 청구서를 발행할 때 저절로 얹혔습니다. 실측에서 그렇게 커진 청구서는
 * 한 건도 안 걷혔습니다(200만 초과 7건 3,190만원, 수납 0원). 이제 합칠지 따로 보낼지를
 * 여기서 사람이 고릅니다.
 */
export default async function UnpaidPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [invRes, payRes, stuRes] = await Promise.all([
    // **발행된 것만** 읽습니다. 취소·이월된 것까지 끌어오면 화면에서 다시 걸러야 하고,
    // 그 수가 한도를 넘는 날 진짜 미납이 조용히 사라집니다.
    readAll<UnpaidInvoice>((from, to) =>
      supabase
        .from("invoices")
        .select("id, invoice_no, student_id, student_name, student_name_ko, issue_date, due_date, total_amount, status, stream, category, carried_to_invoice_id, exported_at")
        .eq("status", "발행")
        .is("carried_to_invoice_id", null)
        .order("due_date")
        .order("id")
        .range(from, to),
    ),
    readAll<UnpaidPayment>((from, to) =>
      supabase.from("payments").select("invoice_id, amount").not("invoice_id", "is", null).order("invoice_id").range(from, to),
    ),
    supabase.from("wr_students").select("id, name, grade, class_name").eq("is_demo", false),
  ]);

  return (
    <UnpaidClient
      invoices={invRes.rows}
      payments={payRes.rows}
      students={((stuRes.data as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? [])}
      today={todayKst()}
      loadError={readNotice(invRes, payRes) ?? stuRes.error?.message ?? null}
    />
  );
}
