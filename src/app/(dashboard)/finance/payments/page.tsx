import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import PaymentsClient from "@/components/finance/PaymentsClient";
import type { PaymentRow } from "@/lib/payments";
import type { Invoice } from "@/lib/types";
import { readAll, readNotice } from "@/lib/financeFetch";

import { getFinanceScope, scopeStudentIds, inScopeIds } from "@/lib/financeScopeServer";
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  // 장부 범위는 아래 조회들과 상관없어 먼저 출발시킵니다 - 차례로 기다리면 왕복 한 번이 더 붙습니다.
  const scopeP = getFinanceScope(me).then((sc) => scopeStudentIds(supabase, sc));
  // 끝까지 읽습니다. 한도를 걸면 넘는 날 미대사 입금과 오래된 청구서가 조용히 사라지고,
  // 화면에는 「없는 것」으로 보입니다(`financeFetch.ts`).
  const [invRes, payRes] = await Promise.all([
    readAll<Invoice>((from, to) => supabase.from("invoices").select("*").order("issue_date").order("id").range(from, to)),
    readAll<PaymentRow>((from, to) => supabase.from("payments").select("*").order("paid_at").order("id").range(from, to)),
  ]);

  // 고른 장부(초등·중고등)의 학생 것만. 수납은 청구서가 없어도(예치금) 학생 번호를 들고 있습니다.
  const ids = await scopeP;
  const invoices = invRes.rows.filter((v) => inScopeIds(ids, v.student_id));
  const keep = new Set(invoices.map((v) => v.id));
  const payments = payRes.rows.filter((p) => !ids || (p.invoice_id ? keep.has(p.invoice_id) : inScopeIds(ids, p.student_id)));
  return (
    <PaymentsClient
      invoices={invoices}
      payments={payments}
      currentUserEmail={me.email}
      currentUserName={me.name ?? ""}
      loadError={readNotice(invRes, payRes)}
      today={todayKst()}
    />
  );
}
