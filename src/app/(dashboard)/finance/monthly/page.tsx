import { redirect } from "next/navigation";
import FinanceLive from "@/components/finance/FinanceLive";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import MonthCloseBar, { type MonthClose } from "@/components/finance/MonthCloseBar";
import { buildPeriodGrid, monthLabel, nextMonthEstimate, type PeriodInvoice, type PeriodPayment, type TermSpan } from "@/lib/financePeriod";
import { readAll, readNotice } from "@/lib/financeFetch";

export const dynamic = "force-dynamic";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** 학기 이름. terms 표에는 이름 칸이 없어 연도+종류로 만듭니다. */
function termLabelOf(t: { year: number | null; term_type: string | null; start_date: string | null }): string {
  const y = t.year ?? Number((t.start_date ?? "").slice(0, 4)) ?? 0;
  return `${y || "?"} ${t.term_type ?? "학기"}`;
}

/**
 * **몇 년도 · 몇 학기 · 몇 월에 얼마.**
 *
 * 지금까지 재무 화면은 「지금 이 순간」만 보여줬습니다 - 이번에 얼마를 보냈고 누가 안 냈나.
 * 그런데 다음 달에 얼마를 청구할지는 **지난 달들을 나란히 놓고** 정하는 일입니다. 나란히
 * 놓을 자리가 없으면 매번 기억과 감으로 정하게 됩니다.
 *
 * 월로 세고, 그 월을 학기에 담습니다. 학기 합계는 언제나 그 학기에 담긴 월들의 합이라
 * 두 숫자가 어긋날 수 없습니다(@/lib/financePeriod).
 */
export default async function FinanceMonthlyPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [invRes, payRes, termRes, closeRes, itemRes] = await Promise.all([
    // 집계에 필요한 칸만 읽습니다. `select("*")` 로 끌어오면 줄마다 안 쓰는 칸까지 따라옵니다.
    // 끝까지 읽습니다 - 한도를 걸면 넘는 날 합계가 조용히 줄어듭니다(`financeFetch.ts`).
    readAll<PeriodInvoice>((from, to) =>
      supabase
        .from("invoices")
        .select("id, student_id, billing_month, issue_date, stream, category, status, total_amount, carried_to_invoice_id")
        .order("issue_date")
        .order("id")
        .range(from, to),
    ),
    readAll<PeriodPayment>((from, to) =>
      supabase.from("payments").select("invoice_id, amount, paid_at, method_kind").order("paid_at").order("invoice_id").range(from, to),
    ),
    supabase.from("terms").select("id, year, term_type, start_date, end_date").order("start_date", { ascending: false }),
    // 닫힌 달. **화면이 「고칠 수 있는 달인가」를 스스로 판단하지 않습니다** - 막는 것은
    // 데이터베이스가 하고, 화면은 그 사실을 보여주기만 합니다.
    supabase.from("finance_month_closes").select("*"),
    // 항목별 청구·수납. 화면이 줄을 끌어와 더하지 않고 데이터베이스가 냅니다.
    supabase.from("finance_item_monthly").select("*"),
  ]);

  const terms: TermSpan[] = ((termRes.data as { id: string; year: number | null; term_type: string | null; start_date: string | null; end_date: string | null }[] | null) ?? [])
    .map((t) => ({ id: t.id, label: termLabelOf(t), start_date: t.start_date, end_date: t.end_date }));

  const blocks = buildPeriodGrid(invRes.rows, payRes.rows, terms);
  const estimate = nextMonthEstimate(blocks);
  const closes = new Map(((closeRes.data as MonthClose[] | null) ?? []).map((c) => [c.month, c]));

  /** 청구월 → 항목별 줄. 「그 달에 무엇으로 얼마를 걷었나」가 다음 달 산출의 재료입니다. */
  type ItemRow = { month: string; stream: string | null; item_name: string; line_count: number; billed: number; received: number };
  const itemsByMonth = new Map<string, ItemRow[]>();
  for (const r of ((itemRes.data as ItemRow[] | null) ?? [])) {
    const list = itemsByMonth.get(r.month) ?? [];
    list.push(r);
    itemsByMonth.set(r.month, list);
  }
  for (const list of itemsByMonth.values()) list.sort((a, b) => Number(b.billed) - Number(a.billed));

  const loadError = readNotice(invRes, payRes) ?? termRes.error?.message ?? closeRes.error?.message ?? null;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
      {/* 돈에 닿는 자료가 바뀌면 이 화면도 함께 다시 그립니다. 고친 사람 화면만 바뀌면
          옆자리는 옛 금액을 그대로 보여주고, 그건 오류가 아니라 다른 숫자로 보입니다. */}
      <FinanceLive />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">📅 월별 · 학기별</h1>
        <Link href="/finance" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          재무 개요 →
        </Link>
      </div>

      <p className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
        <b>청구월</b>은 발행일이 아니라 <b>몇 월치인가</b>입니다 — 9월분을 8월 말에 미리 보내도 9월로 셉니다.
        <br />
        <b>수납</b>은 그 달 청구서에 붙은 돈이고, <b>들어온 돈</b>은 그 달에 실제로 통장·올톡페이로 들어온 돈입니다.
        9월분을 10월에 내면 9월 수납과 10월 들어온 돈에 각각 잡힙니다 — 둘은 다른 질문입니다.
      </p>

      {loadError && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          {loadError}
        </p>
      )}

      {estimate && (
        <p className="mb-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-[12px] text-teal-900">
          <b>다음 달 학비 예상 {won(estimate.tuition)}</b> — {monthLabel(estimate.base)} 학비를 그대로 본 값입니다.
          교재·교복 같은 학비외는 한 학기에 한 번이라 여기 안 넣었습니다. 그 달에 무엇을 사는지 보고 따로 정하세요.
        </p>
      )}

      {/* 가둔 화면 안쪽에서 굴립니다(CLAUDE.md 2-10). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">아직 청구한 것이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {blocks.map((b) => (
              <div key={b.termId ?? "none"} className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
                  <b className="text-[13px] text-slate-800">{b.termLabel}</b>
                  <span className="text-[11px] text-slate-400">{b.months.length}개월</span>
                  <span className="ml-auto text-[11px] tabular-nums text-slate-600">
                    청구 <b>{won(b.issued)}</b> · 수납 <b className="text-emerald-700">{won(b.paid)}</b> ·
                    미납 <b className={b.unpaid > 0 ? "text-rose-700" : "text-slate-400"}>{won(b.unpaid)}</b>
                  </span>
                </div>
                <table className="w-full text-right text-[12px]">
                  <thead className="text-[10px] text-slate-400">
                    <tr className="border-b border-slate-100">
                      <th className="px-3 py-1.5 text-left">월</th>
                      <th className="px-2 py-1.5">학비</th>
                      <th className="px-2 py-1.5">학비외</th>
                      <th className="px-2 py-1.5">청구 계</th>
                      <th className="px-2 py-1.5">수납</th>
                      <th className="px-2 py-1.5">미납</th>
                      <th className="px-2 py-1.5">수납률</th>
                      <th className="px-3 py-1.5">들어온 돈</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.months.map((m) => {
                      const rate = m.issued > 0 ? Math.round((m.paid / m.issued) * 100) : null;
                      return (
                        <tr key={m.month} className="border-b border-slate-50 last:border-b-0">
                          <td className="px-3 py-1.5 text-left font-semibold text-slate-700">
                            {/* 달을 누르면 **학생별로 펼칩니다.** 합계만 보고 다음 행동이
                                정해지는 일은 드뭅니다 - 「누가 안 냈나」로 바로 이어져야 합니다. */}
                            <Link href={`/finance/monthly/${m.month}`} className="underline decoration-slate-300 hover:text-teal-700">
                              {monthLabel(m.month)}
                            </Link>
                            <span className="ml-1 text-[9px] text-slate-300">{m.month.slice(0, 4)}</span>
                            {m.cancelledCount > 0 && (
                              <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700" title="그 달에 취소된 청구서">
                                취소 {m.cancelledCount}
                              </span>
                            )}
                            {m.carriedCount > 0 && (
                              <span
                                className="ml-1 rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-700"
                                title="다른 청구서로 합쳐진 건. 금액은 새 청구서 쪽에 있어 여기서 세지 않습니다"
                              >
                                합쳐짐 {m.carriedCount}
                              </span>
                            )}
                            <span className="ml-1 inline-flex align-middle">
                              <MonthCloseBar month={m.month} state={closes.get(m.month) ?? null} />
                            </span>
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-600">{m.byStream["학비"] ? won(m.byStream["학비"]) : "-"}</td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-600">{m.byStream["학비외"] ? won(m.byStream["학비외"]) : "-"}</td>
                          <td className="px-2 py-1.5 font-bold tabular-nums text-slate-800">{m.issued ? won(m.issued) : "-"}</td>
                          <td className="px-2 py-1.5 tabular-nums text-emerald-700">{m.paid ? won(m.paid) : "-"}</td>
                          <td className={"px-2 py-1.5 font-bold tabular-nums " + (m.unpaid > 0 ? "text-rose-700" : "text-slate-300")}>
                            {m.unpaid !== 0 ? won(m.unpaid) : "-"}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-slate-500">{rate === null ? "-" : `${rate}%`}</td>
                          {/* 청구월 수납과 **다른 숫자**입니다. 같은 칸에 두면 둘을 같은 것으로 읽습니다. */}
                          <td className="px-3 py-1.5 tabular-nums text-slate-400">{m.receivedInMonth ? won(m.receivedInMonth) : "-"}</td>
                        </tr>
                      );
                    })}
                    {/* ── 항목별 ────────────────────────────────────────────
                        올톡페이는 청구사유가 자유 글자라 항목별로 셀 수 없었습니다
                        (실측에서 「악기비」·「악기(바이올린)」·「악기비 (바이올린)」이 따로
                        세어졌습니다). 우리는 내역으로 이미 쪼개 갖고 있으니 세기만 하면
                        됩니다 - 다음 달에 무엇을 얼마나 청구할지가 여기서 나옵니다. */}
                    {b.months.map((m) => {
                      const items = itemsByMonth.get(m.month) ?? [];
                      if (items.length === 0) return null;
                      return (
                        <tr key={`${m.month}-items`} className="border-b border-slate-100 bg-slate-50/60 last:border-b-0">
                          <td colSpan={8} className="px-3 py-1.5">
                            <details>
                              <summary className="cursor-pointer text-left text-[10px] font-semibold text-slate-500">
                                {monthLabel(m.month)} 항목별 {items.length}가지 ▾
                              </summary>
                              <div className="mt-1 flex flex-col gap-0.5">
                                {items.map((it) => {
                                  const billed = Number(it.billed);
                                  const got = Number(it.received);
                                  const rate = billed > 0 ? Math.round((got / billed) * 100) : null;
                                  return (
                                    <div key={`${it.item_name}-${it.stream}`} className="flex items-center gap-2 text-[11px]">
                                      <span className="min-w-0 flex-1 truncate text-left text-slate-600">{it.item_name}</span>
                                      <span className="text-[9px] text-slate-300">{it.line_count}명</span>
                                      <span className="w-24 text-right tabular-nums text-slate-700">{won(billed)}</span>
                                      <span className="w-24 text-right tabular-nums text-emerald-700">{won(got)}</span>
                                      {/* 항목별 수납은 **비율로 나눈 값**입니다. 어느 항목을
                                          먼저 받았는지는 대개 알 수 없습니다. */}
                                      <span className="w-10 text-right tabular-nums text-slate-400">{rate === null ? "-" : `${rate}%`}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
