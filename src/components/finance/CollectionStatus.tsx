import Link from "next/link";
import { latePayers, methodKindOf } from "@/lib/feeSummary";
import type { PaymentRow } from "@/lib/payments";
import type { Invoice } from "@/lib/types";

/**
 * 납부 현황과 상습 미납.
 *
 * 「지금 얼마 밀렸나」와 「자주 밀리나」는 다른 물음입니다. 앞엣것만 보면 이번 달 사정이
 * 있었던 집과 매번 늦는 집이 같아 보입니다. 뒤엣것을 알아야 안내 방식을 바꿀 수 있습니다.
 *
 * 세는 것은 **마감이 지난 뒤에도 잔액이 남았던 청구서 수**입니다. 지금 다 냈더라도 늦게
 * 낸 사실은 남습니다 - 그게 «자주 밀린다»의 뜻입니다.
 */

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

const TONE: Record<string, string> = {
  올톡페이: "bg-violet-500",
  방문카드: "bg-sky-500",
  계좌이체: "bg-emerald-500",
  현금: "bg-amber-500",
  기타: "bg-slate-400",
};

export default function CollectionStatus({
  invoices,
  payments,
  today,
}: {
  invoices: Invoice[];
  payments: PaymentRow[];
  today: string;
}) {
  const live = invoices.filter((v) => v.status !== "취소");
  const billed = live.reduce((n, v) => n + Number(v.total_amount ?? 0), 0);
  const paid = payments.reduce((n, p) => n + Number(p.amount ?? 0), 0);
  const rate = billed > 0 ? Math.round((paid / billed) * 1000) / 10 : 0;

  // 마감이 지났는데 남은 돈. 마감 전 잔액은 «안 낸 것»이 아니라 «낼 때가 안 된 것»입니다.
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount ?? 0));
  }
  const overdue = live
    .filter((v) => v.due_date && v.due_date < today)
    .reduce((n, v) => n + Math.max(0, Number(v.total_amount ?? 0) - (paidByInvoice.get(v.id) ?? 0)), 0);

  // 어느 청구서인지 못 붙인 돈. 이게 크면 위 숫자들이 다 흔들립니다.
  const unmatched = payments.filter((p) => !p.invoice_id).reduce((n, p) => n + Number(p.amount ?? 0), 0);

  const byMethod = new Map<string, number>();
  for (const p of payments) {
    const k = methodKindOf(p);
    byMethod.set(k, (byMethod.get(k) ?? 0) + Number(p.amount ?? 0));
  }
  const methods = [...byMethod.entries()].sort((a, b) => b[1] - a[1]);

  const late = latePayers(invoices, payments, today);
  const repeat = late.filter((s) => s.lateCount >= 2);

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-sm font-bold text-slate-700">📊 납부 현황</h2>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="청구" value={won(billed)} tone="slate" />
        <Stat label="납부" value={won(paid)} sub={`${rate}%`} tone="emerald" />
        <Stat label="마감 지난 미납" value={won(overdue)} tone={overdue > 0 ? "rose" : "slate"} />
        <Stat
          label="주인 없는 입금"
          value={won(unmatched)}
          sub={unmatched > 0 ? "수납에서 붙여주세요" : undefined}
          tone={unmatched > 0 ? "amber" : "slate"}
        />
      </div>

      {/* 무엇으로 들어오는가. 수단이 바뀌면 현금영수증·정산 방식도 함께 바뀝니다. */}
      {methods.length > 0 && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-slate-500">납부 수단</p>
          <div className="mb-1.5 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            {methods.map(([k, v]) => (
              <div key={k} className={TONE[k] ?? TONE.기타} style={{ width: `${paid > 0 ? (v / paid) * 100 : 0}%` }} title={`${k} ${won(v)}`} />
            ))}
          </div>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
            {methods.map(([k, v]) => (
              <span key={k} className="flex items-center gap-1">
                <i className={"inline-block h-2 w-2 rounded-full " + (TONE[k] ?? TONE.기타)} />
                {k} {won(v)}
                <span className="text-slate-400">{paid > 0 ? Math.round((v / paid) * 100) : 0}%</span>
              </span>
            ))}
          </p>
        </div>
      )}

      {/* 상습 미납. 한 번 밀린 집과 매번 밀리는 집을 갈라서 보여줍니다. */}
      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <p className="mb-1.5 flex items-baseline gap-2">
          <b className="text-[13px] text-slate-800">늦게 내는 집</b>
          <span className="text-[11px] text-slate-400">
            마감을 넘긴 적이 있는 {late.length}명 · 그중 두 번 이상 {repeat.length}명
          </span>
        </p>

        {late.length === 0 ? (
          <p className="py-3 text-center text-[12px] text-slate-400">마감을 넘긴 집이 없습니다.</p>
        ) : (
          <ul className="flex flex-col">
            {late.slice(0, 15).map((s) => (
              <li key={s.studentId} className="flex flex-wrap items-center gap-x-2 border-b border-slate-100 py-1.5 text-[12px] last:border-0">
                <span
                  className={
                    "w-10 shrink-0 rounded-md px-1 py-0.5 text-center text-[11px] font-bold " +
                    (s.lateCount >= 3 ? "bg-rose-100 text-rose-700" : s.lateCount >= 2 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500")
                  }
                  title={`마감 지난 청구서 ${s.totalDue}건 중 ${s.lateCount}건이 늦었습니다`}
                >
                  {s.lateCount}/{s.totalDue}
                </span>
                <Link href={`/students/${s.studentId}`} className="font-semibold text-slate-800 underline decoration-dotted">
                  {s.studentName}
                </Link>
                {s.avgDaysLate !== null && <span className="text-slate-500">평균 {s.avgDaysLate}일 늦음</span>}
                {s.outstanding > 0 && <span className="ml-auto font-semibold text-rose-600">{won(s.outstanding)} 남음</span>}
                {s.outstanding === 0 && <span className="ml-auto text-[11px] text-emerald-600">지금은 완납</span>}
              </li>
            ))}
          </ul>
        )}
        {late.length > 15 && <p className="pt-1 text-[11px] text-slate-400">외 {late.length - 15}명 더</p>}

        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          왼쪽 숫자는 <b>마감 지난 청구서 중 늦은 건 수</b>입니다. 지금 다 냈어도 늦게 낸 사실은 남습니다 — 한 번 크게
          밀린 집보다 매번 조금씩 늦는 집이 위로 옵니다.
        </p>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "slate" | "emerald" | "rose" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
  };
  return (
    <div className={"rounded-xl border p-2.5 " + tones[tone]}>
      <p className="text-[11px] opacity-70">{label}</p>
      <p className="text-[15px] font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}
