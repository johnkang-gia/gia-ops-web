import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import { resolveStudentItems, sumLines, won } from "@/lib/feeItems";
import type { FeeItem, Invoice, StudentFeeItem } from "@/lib/types";

// 재무 개요.
//
// 재무 일은 대개 **"지금 어디까지 됐나"**를 보는 데서 시작합니다. 그 물음에 답하지 못하는
// 화면은 결국 안 보게 됩니다. 그래서 여기에는 숫자 네 개와 "남은 일" 목록만 둡니다:
// 얼마를 받아야 하는지, 몇 명에게 보냈는지, 누가 아직 안 보내졌는지.

export const dynamic = "force-dynamic";

export default async function FinanceOverviewPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [stuRes, itemsRes, ovRes, invRes] = await Promise.all([
    supabase.from("wr_students").select("id, name, grade, class_name").eq("status", "active").eq("is_demo", false),
    supabase.from("fee_items").select("*"),
    supabase.from("student_fee_items").select("*"),
    supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(500),
  ]);

  const loadError = stuRes.error?.message ?? itemsRes.error?.message ?? ovRes.error?.message ?? invRes.error?.message ?? null;

  const students = ((stuRes.data as { id: string; name: string; grade: string | null; class_name: string | null }[] | null) ?? []).map(
    (s) => ({ id: s.id, name: s.name, grade: s.grade, className: s.class_name }),
  );
  // active 로 거르지 않습니다. 항목은 끄는 것이 아니라 지웁니다(2026-09).
  const items = (itemsRes.data as FeeItem[] | null) ?? [];
  const overrides = (ovRes.data as StudentFeeItem[] | null) ?? [];
  const invoices = (invRes.data as Invoice[] | null) ?? [];

  // 아이마다 얼마인지. 화면·발행과 **같은 함수**를 씁니다 - 개요만 따로 계산하면 숫자가
  // 어긋나고, 어긋난 개요는 아무도 안 믿습니다.
  const perStudent = students.map((s) => ({ s, amount: sumLines(resolveStudentItems(items, s, overrides)) }));
  const withItems = perStudent.filter((x) => x.amount > 0);
  const expected = withItems.reduce((n, x) => n + x.amount, 0);

  const issuedByStudent = new Set(invoices.filter((v) => v.status === "발행" && v.student_id).map((v) => v.student_id as string));
  const pending = withItems.filter((x) => !issuedByStudent.has(x.s.id));
  const issuedTotal = invoices.filter((v) => v.status === "발행").reduce((n, v) => n + Number(v.total_amount), 0);

  // 반별로 묶어 보여줍니다. 남은 일이 어느 반에 몰려 있는지가 다음 행동을 정합니다.
  const byClass = new Map<string, { people: number; amount: number; pending: number }>();
  for (const x of withItems) {
    const key = x.s.className || (x.s.grade ? `${x.s.grade}학년` : "반 없음");
    const cur = byClass.get(key) ?? { people: 0, amount: 0, pending: 0 };
    byClass.set(key, {
      people: cur.people + 1,
      amount: cur.amount + x.amount,
      pending: cur.pending + (issuedByStudent.has(x.s.id) ? 0 : 1),
    });
  }
  const classRows = [...byClass.entries()].sort((a, b) => b[1].pending - a[1].pending || a[0].localeCompare(b[0], "ko"));

  const today = todayKst();
  const recent = invoices.slice(0, 12);

  const Card = ({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="min-w-[150px] flex-1 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xl font-black tabular-nums text-${tone}-800`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">

      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-bold">📊 재무 개요</h1>
        <span className="text-xs text-slate-400">{today} 기준 · 학비외</span>
      </div>
      <p className="mb-4 text-xs text-slate-500">지금 어디까지 됐는지만 봅니다. 고치는 일은 옆 탭에서 합니다.</p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
          자료를 읽지 못했습니다: {loadError}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <Card label="받아야 할 금액" value={won(expected)} sub={`${withItems.length}명에게 항목이 붙어 있습니다`} />
        <Card label="발행한 금액" value={won(issuedTotal)} sub={`${invoices.filter((v) => v.status === "발행").length}건`} />
        <Card
          label="아직 발행 안 함"
          value={`${pending.length}명`}
          sub={pending.length > 0 ? won(pending.reduce((n, x) => n + x.amount, 0)) : "남은 일이 없습니다"}
          tone={pending.length > 0 ? "amber" : "slate"}
        />
        <Card label="쓰는 항목" value={`${items.length}개`} sub={`분류 ${new Set(items.map((i) => i.category)).size}가지`} />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 반별 진행 — 남은 일이 어디에 몰려 있는가 */}
        <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-bold text-slate-700">반별 진행</p>
          <table className="w-full text-left text-[12px]">
            <thead className="text-[11px] text-slate-400">
              <tr>
                <th className="px-3 py-1.5">반</th>
                <th className="px-3 py-1.5 text-right">대상</th>
                <th className="px-3 py-1.5 text-right">금액</th>
                <th className="px-3 py-1.5 text-right">미발행</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {classRows.map(([name, v]) => (
                <tr key={name} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-semibold text-slate-700">{name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{v.people}명</td>
                  <td className="px-3 py-1.5 text-right font-bold tabular-nums text-slate-700">{won(v.amount)}</td>
                  <td className={"px-3 py-1.5 text-right font-bold tabular-nums " + (v.pending > 0 ? "text-amber-600" : "text-emerald-600")}>
                    {v.pending > 0 ? `${v.pending}명` : "완료"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link href="/finance/invoices" className="text-[11px] font-semibold text-teal-700 underline">
                      명단 →
                    </Link>
                  </td>
                </tr>
              ))}
              {classRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-slate-400">
                    아직 아무에게도 항목이 붙어 있지 않습니다.{" "}
                    <Link href="/finance/items" className="font-bold text-teal-700 underline">
                      학비외 항목
                    </Link>
                    에서 시작해보세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 최근 발행 */}
        <div className="w-full shrink-0 rounded-xl border border-slate-200 bg-white lg:w-72">
          <p className="border-b border-slate-100 px-3 py-2 text-[12px] font-bold text-slate-700">최근 발행</p>
          <div className="max-h-[420px] overflow-y-auto">
            {recent.map((v) => (
              <Link
                key={v.id}
                href={`/finance/invoices/${v.id}/print`}
                target="_blank"
                className="flex items-baseline gap-2 border-b border-slate-50 px-3 py-1.5 hover:bg-slate-50"
              >
                <span className="text-[11px] font-bold text-slate-600">{v.invoice_no}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{v.student_name_ko ?? v.student_name}</span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-600">{won(Number(v.total_amount))}</span>
              </Link>
            ))}
            {recent.length === 0 && <p className="p-6 text-center text-[12px] text-slate-400">아직 발행한 것이 없습니다.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
