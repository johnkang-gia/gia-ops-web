import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { todayKst } from "@/lib/kst";
import { summarizeByTerm } from "@/lib/feeSummary";
import type { PaymentRow } from "@/lib/payments";
import type { Invoice } from "@/lib/types";

/**
 * 학생 한 명의 학기별 납부내역.
 *
 * 상담 자리에서 필요한 것은 «이 아이의 이 학기»입니다. 그런데 돈 이야기는 두 화면에
 * 흩어져 있었습니다 — 인보이스 명단은 누구에게 얼마를 청구했나, 수납 화면은 어떤 돈이
 * 들어왔나. 「이번 학기 학비를 뭘로 얼마 냈나요」에 답하려면 두 화면을 오가며 사람이
 * 머릿속에서 이어붙여야 했습니다.
 *
 * 재무 권한이 없으면 아예 그리지 않습니다. 돈은 특정인만 다루기로 정해져 있습니다.
 */

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

const METHOD_TONE: Record<string, string> = {
  올톡페이: "bg-violet-100 text-violet-800",
  방문카드: "bg-sky-100 text-sky-800",
  계좌이체: "bg-emerald-100 text-emerald-800",
  현금: "bg-amber-100 text-amber-800",
  기타: "bg-slate-100 text-slate-600",
};

export default async function StudentFeeHistory({ studentId }: { studentId: string }) {
  const supabase = await createClient();

  const [invRes, payRes, termRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("student_id", studentId).order("issue_date", { ascending: false }),
    supabase.from("payments").select("*").eq("student_id", studentId).order("paid_at", { ascending: false }),
    supabase.from("terms").select("id, term_type, year"),
  ]);

  // 재무 권한이 없으면 RLS 가 빈 배열을 돌려줍니다. 그때는 칸 자체를 그리지 않습니다 -
  // 빈 표를 보여주면 «이 아이는 낸 게 없다»로 읽힙니다.
  const invoices = (invRes.data as Invoice[] | null) ?? [];
  const payments = (payRes.data as PaymentRow[] | null) ?? [];
  if (invoices.length === 0 && payments.length === 0) return null;

  const ids = payments.map((p) => p.id);
  const { data: receipts } = ids.length
    ? await supabase.from("cash_receipts").select("payment_id").in("payment_id", ids).eq("status", "발행")
    : { data: [] };
  const receipted = new Set(
    ((receipts as { payment_id: string | null }[] | null) ?? []).map((r) => r.payment_id).filter((v): v is string => !!v),
  );

  const termLabels: Record<string, string> = {};
  for (const t of ((termRes.data as { id: string; term_type: string; year: string }[] | null) ?? [])) {
    termLabels[t.id] = `${t.year} ${t.term_type}`;
  }

  const terms = summarizeByTerm(invoices, payments, termLabels, receipted, todayKst());
  if (terms.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-bold text-slate-800">
        💰 납부 내역
        <span className="text-[11px] font-normal text-slate-400">학기별</span>
      </h2>

      <div className="flex flex-col gap-2">
        {terms.map((t) => (
          <div key={t.termId ?? "none"} className="rounded-xl border border-slate-200 p-2.5">
            <p className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <b className="text-[13px] text-slate-800">{t.termLabel}</b>
              <span className="text-[12px] text-slate-500">청구 {won(t.billed)}</span>
              <span className="text-[12px] font-semibold text-emerald-700">납부 {won(t.paid)}</span>
              {t.balance > 0 ? (
                <span
                  className={
                    "rounded-md px-1.5 py-0.5 text-[11px] font-bold " +
                    (t.overdue > 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800")
                  }
                  title={t.overdue > 0 ? "마감이 지났는데 남아 있습니다" : "아직 마감 전입니다"}
                >
                  {t.overdue > 0 ? "미납" : "잔액"} {won(t.balance)}
                </span>
              ) : (
                <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">완납</span>
              )}
            </p>

            {/* 무엇으로 냈는가. 한 학기를 여러 갈래로 나눠 내는 집이 실제로 있습니다. */}
            {t.methods.length > 0 && (
              <p className="mb-1.5 flex flex-wrap items-center gap-1">
                {t.methods.map((m) => (
                  <span
                    key={m.kind}
                    className={"rounded-md px-1.5 py-0.5 text-[11px] font-semibold " + (METHOD_TONE[m.kind] ?? METHOD_TONE.기타)}
                  >
                    {m.kind} {won(m.amount)}
                    {m.count > 1 && <span className="ml-1 font-normal opacity-70">{m.count}회</span>}
                  </span>
                ))}
                {t.receiptPending > 0 && (
                  <span
                    className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700"
                    title="현금·계좌이체인데 현금영수증이 아직 발행되지 않았습니다"
                  >
                    🧾 미발행 {won(t.receiptPending)}
                  </span>
                )}
              </p>
            )}

            {/* 청구서별로 한 줄씩. 무엇에 대한 돈인지가 분류에 있습니다. */}
            <ul className="flex flex-col gap-0.5">
              {t.invoices.map((v) => {
                const paid = t.payments.filter((p) => p.invoice_id === v.id).reduce((n, p) => n + Number(p.amount), 0);
                const bal = Math.round(Number(v.total_amount) - paid);
                return (
                  <li key={v.id} className="flex flex-wrap items-center gap-x-2 text-[11px]">
                    <span className="rounded bg-slate-100 px-1 font-semibold text-slate-600">{v.category ?? "통합"}</span>
                    <Link href={`/finance/invoices/${v.id}`} className="text-slate-500 underline decoration-dotted">
                      {v.invoice_no}
                    </Link>
                    <span className="tabular-nums text-slate-700">{won(Number(v.total_amount))}</span>
                    <span className="text-slate-400">마감 {v.due_date}</span>
                    {bal <= 0 ? (
                      <span className="font-semibold text-emerald-600">완납</span>
                    ) : (
                      <span className="font-semibold text-rose-600">{won(bal)} 남음</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
