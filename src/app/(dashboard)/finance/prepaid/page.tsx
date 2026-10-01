import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { readAll, readNotice } from "@/lib/financeFetch";
import PrepaidClient from "@/components/finance/PrepaidClient";
import type { PrepaidRow } from "@/lib/prepaidLedger";
import type { Invoice } from "@/lib/types";
import { loadStudents } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * **선입금 대장** — 어느 청구서에도 안 붙은 돈.
 *
 * 지금까지 이 돈은 `payments.invoice_id = null` 로만 존재했고 **보는 자리가 없었습니다.**
 * 실제로 두 줄이 떠 있었는데(청구 취소로 떨어져 나온 돈) 화면 어디에도 안 나왔고, 고칠
 * 수도 지울 수도 없었습니다. 다음에 그 아이 청구서를 만들면 저절로 깎이는데, 왜 깎였는지
 * 알 방법이 없습니다.
 */
export default async function PrepaidPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [payRes, stuRes, invRes] = await Promise.all([
    // **안 붙은 줄만** 읽습니다. 전부 읽어와 화면에서 거르면 붙은 입금 수천 줄을 헛되이
    // 끌어옵니다 - 그리고 그 수가 limit 을 넘는 날 선입금이 조용히 사라집니다.
    supabase.from("payments").select("*").is("invoice_id", null).order("paid_at", { ascending: false }),
    // 퇴소한 아이의 선입금도 붙일 곳이 있어야 하므로 전부 읽습니다.
    loadStudents(supabase, { status: "all" }),
    // 붙일 곳을 고르려면 그 학생의 **살아 있는 청구서**가 필요합니다. 취소된 것에 붙이면
    // 그 돈은 다시 사라집니다.
    readAll<Invoice>((from, to) =>
      supabase.from("invoices").select("*").eq("status", "발행").order("issue_date").order("id").range(from, to),
    ),
  ]);

  return (
    <PrepaidClient
      rows={(payRes.data as PrepaidRow[] | null) ?? []}
      students={stuRes.rows}
      invoices={invRes.rows}
      currentUserEmail={me.email}
      loadError={payRes.error?.message ?? stuRes.error ?? readNotice(invRes)}
    />
  );
}
