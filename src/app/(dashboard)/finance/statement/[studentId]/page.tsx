import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { won } from "@/lib/feeItems";
import { studentLedger, settle, isOutstanding, agingBucket, type SettleInvoice } from "@/lib/settlement";
import type { PaymentRow } from "@/lib/payments";
import PrintButton from "@/components/finance/PrintButton";

/**
 * 학생별 원장(거래명세서) 한 장.
 *
 * 「우리가 뭘 얼마 냈죠」라는 물음에 지금은 청구서를 하나씩 열어 더해야 답할 수 있습니다.
 * 회계 프로그램들이 이 화면을 따로 두는 이유는, **이 한 장이면 더 물을 것이 없기** 때문입니다.
 *
 * 그대로 인쇄해 학부모에게 드릴 수 있게 만들었습니다. 화면용 장식은 인쇄에서 빠집니다.
 */

export const dynamic = "force-dynamic";

export default async function StatementPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [stuRes, invRes, payRes] = await Promise.all([
    supabase.from("wr_students").select("id, name, name_en, grade, class_name").eq("is_demo", false).eq("id", studentId).maybeSingle(),
    supabase.from("invoices").select("*").eq("student_id", studentId).order("issue_date"),
    supabase.from("payments").select("*").eq("student_id", studentId).order("paid_at"),
  ]);

  const loadError = stuRes.error?.message ?? invRes.error?.message ?? payRes.error?.message ?? null;
  const student = stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null } | null;
  const invoices = ((invRes.data as SettleInvoice[] | null) ?? []);
  const payments = ((payRes.data as PaymentRow[] | null) ?? []);
  const today = todayKst();

  const { rows, outstanding } = studentLedger(invoices, payments, studentId);
  // 아직 받아야 하는 청구서. 「얼마」보다 「얼마나 오래」가 먼저입니다.
  const open = invoices
    .map((v) => ({ v, s: settle(v, payments, today) }))
    .filter((x) => isOutstanding(x.s))
    .sort((a, b) => b.s.overdueDays - a.s.overdueDays);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/finance/payments" className="text-[12px] font-semibold text-teal-700 underline">
          ← 수납으로
        </Link>
        <PrintButton />
      </div>

      {loadError && (
        <p className="mb-2 rounded bg-rose-50 px-2 py-1 text-[12px] font-bold text-rose-700">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}
      {!student && !loadError && (
        <p className="rounded bg-slate-50 px-3 py-6 text-center text-[13px] text-slate-500">그 학생을 찾지 못했습니다.</p>
      )}

      {student && (
        <div className="gia-print-wrap rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-1 text-[11px] font-bold tracking-wide text-slate-400">GIA MICRO LAB</div>
          <h1 className="text-lg font-black text-slate-900">거래명세서</h1>
          <p className="mb-4 text-[12px] text-slate-500">
            {student.name}
            {student.name_en ? ` · ${student.name_en}` : ""}
            {student.class_name ? ` · ${student.class_name}` : student.grade ? ` · ${student.grade}학년` : ""}
            {" · "}
            {today} 기준
          </p>

          {/* 맨 위에 지금 남은 돈. 이 한 줄을 보려고 이 종이를 봅니다. */}
          <div
            className={
              "mb-4 rounded-xl px-4 py-3 " + (outstanding > 0 ? "bg-rose-50" : "bg-emerald-50")
            }
          >
            <div className="text-[11px] font-bold text-slate-500">지금 남은 금액</div>
            <div className={"text-2xl font-black tabular-nums " + (outstanding > 0 ? "text-rose-700" : "text-emerald-700")}>
              {outstanding > 0 ? won(outstanding) : "완납"}
            </div>
            {open.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                {open.map((x) => (
                  <span key={x.v.id} className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-600">
                    {x.v.invoice_no} {won(x.s.balance)} · {agingBucket(x.s.overdueDays)}
                  </span>
                ))}
              </div>
            )}
          </div>

          <table className="w-full text-left text-[12px]">
            <thead className="border-b-2 border-slate-200 text-[11px] text-slate-500">
              <tr>
                <th className="py-1.5">날짜</th>
                <th className="py-1.5">내용</th>
                <th className="py-1.5 text-right">청구</th>
                <th className="py-1.5 text-right">입금</th>
                <th className="py-1.5 text-right">잔액</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 tabular-nums text-slate-500">{r.date}</td>
                  <td className="py-1.5 text-slate-800">
                    {r.label}
                    {r.method && <span className="ml-1 text-[11px] text-slate-400">{r.method}</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-700">{r.delta > 0 ? won(r.delta) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">{r.delta < 0 ? won(-r.delta) : ""}</td>
                  <td className="py-1.5 text-right font-bold tabular-nums text-slate-900">{won(r.running)}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    이 학생에게 발행한 청구서가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
            «이월됨»으로 적힌 청구서는 그 금액이 다음 청구서에 이미 들어가 있어 여기서 다시 세지 않습니다.
            문의는 행정실로 연락해 주세요.
          </p>
        </div>
      )}
    </div>
  );
}
