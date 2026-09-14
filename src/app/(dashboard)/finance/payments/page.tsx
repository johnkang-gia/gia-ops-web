import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import PaymentsClient from "@/components/finance/PaymentsClient";
import type { PaymentRow } from "@/lib/payments";
import type { Invoice } from "@/lib/types";
import { readAll, readNotice } from "@/lib/financeFetch";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  // 끝까지 읽습니다. 한도를 걸면 넘는 날 미대사 입금과 오래된 청구서가 조용히 사라지고,
  // 화면에는 「없는 것」으로 보입니다(`financeFetch.ts`).
  const [invRes, payRes] = await Promise.all([
    readAll<Invoice>((from, to) => supabase.from("invoices").select("*").order("issue_date").order("id").range(from, to)),
    readAll<PaymentRow>((from, to) => supabase.from("payments").select("*").order("paid_at").order("id").range(from, to)),
  ]);

  return (
    <PaymentsClient
      invoices={invRes.rows}
      payments={payRes.rows}
      currentUserEmail={me.email}
      currentUserName={me.name ?? ""}
      loadError={readNotice(invRes, payRes)}
      today={todayKst()}
    />
  );
}
