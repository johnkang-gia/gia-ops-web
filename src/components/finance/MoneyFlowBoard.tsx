"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Who } from "@/components/common/HomonymProvider";
import { gradeText } from "@/lib/gradeScope";
import { gradeSortKey } from "@/lib/department";
import { INVOICE_STREAMS, type InvoiceStream, type SettleInvoice, type SettlePayment } from "@/lib/settlement";
import { breakdown, totalOf, unpaidPeople, type BreakRow, type StudentMeta } from "@/lib/financeBreakdown";

/**
 * **학교의 돈이 지금 어디까지 왔는가** — 재무 개요의 한 판.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 전체 수납률 82%는 모든 반이 고르게 82%인 것과 **한 반만 30%인 것**을 똑같이 보이게
 * 합니다. 뒤엣것은 그 반 담임에게 전화 한 통이면 풀리는 일인데, 전체 숫자만 보면 그 반이
 * 있다는 것조차 모릅니다.
 *
 * ── 어떻게 읽히게 하나 ──────────────────────────────────────────────────────
 *
 * 세 층입니다. 위에서 아래로 갈수록 좁아지고, 각 층이 다음 층을 볼 이유를 만듭니다.
 *
 *   ① 도넛 하나 — 학교 전체가 몇 %인가
 *   ② 학년·반 표 — **덜 받은 곳이 맨 위**. 다음에 할 일이 거기 있습니다.
 *   ③ 미납자 명단 — 오래 밀린 사람부터. 전화는 사람에게 겁니다.
 *
 * 색은 세 가지만 씁니다(받음·남음·연체). 색이 늘면 보는 사람이 범례를 외워야 하고, 외워야
 * 하는 화면은 결국 안 봅니다.
 *
 * 세는 규칙은 전부 `financeBreakdown.ts` 에 있습니다 - 화면은 그리기만 합니다.
 */

const won = (n: number) => n.toLocaleString("ko-KR") + "원";
/** 큰 금액은 만원 단위로 줄여 적습니다. 표 한 칸에 「12,345,600원」이 들어가면 줄이 접힙니다. */
const manwon = (n: number) => (n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만` : n.toLocaleString("ko-KR"));

export default function MoneyFlowBoard({
  invoices,
  payments,
  meta,
  today,
}: {
  invoices: SettleInvoice[];
  payments: SettlePayment[];
  /** 학생 번호 → 이름·학년·반. **번호로** 찾습니다 - 이름으로 찾으면 김재이 셋이 한 칸을 나눠 씁니다(§2-4). */
  meta: [string, { name: string; grade: string | null; className: string | null }][];
  today: string;
}) {
  /** 학비와 학비외는 납기도 담당도 다릅니다. 섞으면 「교재비가 안 들어온 것」과 「등록금이 안 들어온 것」이 한 숫자가 됩니다. */
  const [stream, setStream] = useState<InvoiceStream | "전체">("전체");
  const metaMap = useMemo<StudentMeta>(() => new Map(meta), [meta]);
  const only = stream === "전체" ? undefined : stream;

  const byGrade = useMemo(() => breakdown(invoices, payments, metaMap, today, "학년", only), [invoices, payments, metaMap, today, only]);
  const byClass = useMemo(() => breakdown(invoices, payments, metaMap, today, "반", only), [invoices, payments, metaMap, today, only]);
  const unpaid = useMemo(() => unpaidPeople(invoices, payments, metaMap, today, only), [invoices, payments, metaMap, today, only]);
  const total = useMemo(() => totalOf(byGrade), [byGrade]);

  // 도넛은 **학년 순서대로** 세웁니다. 표는 급한 곳이 먼저지만, 도넛 줄은 2·3·4·5학년이
  // 늘 같은 자리에 있어야 매일 보는 사람이 눈으로 찾습니다.
  const gradeDonuts = useMemo(() => [...byGrade].sort((a, b) => gradeSortKey(a.key) - gradeSortKey(b.key)), [byGrade]);

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-bold text-slate-800">💸 자금 흐름</h2>
        <span className="text-[11px] text-slate-400">{today} 기준 · 취소·이월된 청구서는 세지 않습니다</span>
        <span className="ml-auto flex gap-1">
          {(["전체", ...INVOICE_STREAMS] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStream(s)}
              className={
                "rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (stream === s ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
              }
            >
              {s}
            </button>
          ))}
        </span>
      </div>

      {total.invoices === 0 ? (
        <p className="py-10 text-center text-[12px] text-slate-400">
          {stream === "전체" ? "아직 발행한 청구서가 없습니다." : `${stream} 청구서가 아직 없습니다.`}
        </p>
      ) : (
        <>
          {/* ── ① 학교 전체 + 학년별 도넛 ─────────────────────────────── */}
          <div className="mb-4 flex flex-wrap items-start gap-3">
            <Donut row={total} size={132} title="학교 전체" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                {gradeDonuts.map((r) => (
                  <Donut key={r.key} row={r} size={92} title={gradeText(r.key)} />
                ))}
              </div>
            </div>
          </div>

          {/* 숫자 네 개. 도넛이 «비율»이라면 여기는 «금액»입니다 - 둘 다 있어야
              「82%인데 얼마가 남았지?」에서 멈추지 않습니다. */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="청구" value={won(total.billed)} sub={`${total.invoices}장 · ${total.people}명`} />
            <Stat label="수납" value={won(total.paid)} sub={`${total.rate}%`} tone="emerald" />
            <Stat label="미수" value={won(total.balance)} sub="아직 받을 돈" tone={total.balance > 0 ? "amber" : "slate"} />
            <Stat
              label="연체"
              value={won(total.overdue)}
              sub={total.overdue > 0 ? "마감이 지났습니다" : "마감 지난 미납 없음"}
              tone={total.overdue > 0 ? "rose" : "slate"}
            />
          </div>

          <div className="flex flex-col gap-3 lg:flex-row">
            {/* ── ② 학년·반 표 ───────────────────────────────────────── */}
            <div className="min-w-0 flex-1">
              <ScopeTable byGrade={byGrade} byClass={byClass} />
            </div>

            {/* ── ③ 미납자 명단 ─────────────────────────────────────── */}
            <div className="w-full shrink-0 rounded-xl border border-slate-200 lg:w-80">
              <p className="flex items-baseline gap-1.5 border-b border-slate-100 px-3 py-2">
                <b className="text-[12px] text-slate-700">미납자</b>
                <span className="text-[11px] font-bold text-rose-600">{unpaid.length}명</span>
                <span className="ml-auto text-[10px] text-slate-400">오래 밀린 사람부터</span>
              </p>
              {/* 가둔 칸에는 안쪽 스크롤을 둡니다(§2-10). 없으면 넷째 줄부터 손이 안 닿는데
                  스크롤 막대조차 안 생겨서, 보는 사람은 그게 전부인 줄 압니다. */}
              <div className="max-h-[360px] overflow-y-auto">
                {unpaid.map((p) => (
                  <div key={p.studentId ?? p.topInvoiceNo} className="flex items-baseline gap-1.5 border-b border-slate-50 px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-700">
                      <Who id={p.studentId} name={p.name} />
                      {p.className && <span className="ml-1 text-[10px] font-normal text-slate-400">{p.className}</span>}
                    </span>
                    {/* 얼마나 **오래** 밀렸는지가 얼마보다 먼저입니다. 어제 마감된 10만원과
                        두 달 밀린 10만원은 같은 돈이 아닙니다. */}
                    <span
                      className={
                        "shrink-0 rounded px-1 text-[10px] font-bold " +
                        (p.worstOverdueDays > 60
                          ? "bg-rose-100 text-rose-700"
                          : p.worstOverdueDays > 0
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-500")
                      }
                    >
                      {p.worstOverdueDays > 0 ? `${p.worstOverdueDays}일` : "기한 전"}
                    </span>
                    <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-700">{manwon(p.balance)}</span>
                  </div>
                ))}
                {unpaid.length === 0 && <p className="p-8 text-center text-[12px] text-emerald-700">받을 돈이 남아 있지 않습니다.</p>}
              </div>
              <Link href="/finance/unpaid" className="block border-t border-slate-100 px-3 py-2 text-center text-[11px] font-bold text-teal-700 hover:bg-slate-50">
                미납 화면에서 자세히 →
              </Link>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/** 학년/반 사이를 오가는 표. 같은 숫자를 두 눈금으로 봅니다. */
function ScopeTable({ byGrade, byClass }: { byGrade: BreakRow[]; byClass: BreakRow[] }) {
  const [by, setBy] = useState<"학년" | "반">("학년");
  const rows = by === "학년" ? byGrade : byClass;
  const max = Math.max(1, ...rows.map((r) => r.billed));

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-1 border-b border-slate-100 px-3 py-2">
        <b className="mr-1 text-[12px] text-slate-700">덜 받은 곳부터</b>
        {(["학년", "반"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setBy(k)}
            className={
              "rounded-full px-2.5 py-0.5 text-[11px] font-bold transition " +
              (by === k ? "bg-teal-600 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
            }
          >
            {k}별
          </button>
        ))}
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-white text-[10px] text-slate-400">
            <tr>
              <th className="px-3 py-1.5">{by}</th>
              <th className="px-2 py-1.5 text-right">청구</th>
              <th className="px-2 py-1.5 text-right">수납</th>
              <th className="px-2 py-1.5 text-right">미수</th>
              <th className="w-[34%] px-3 py-1.5">수납률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-bold text-slate-700">
                  {by === "학년" ? gradeText(r.key) : r.key}
                  <span className="ml-1 text-[10px] font-normal text-slate-400">{r.people}명</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{manwon(r.billed)}</td>
                <td className="px-2 py-1.5 text-right font-bold tabular-nums text-emerald-700">{manwon(r.paid)}</td>
                <td className={"px-2 py-1.5 text-right font-bold tabular-nums " + (r.overdue > 0 ? "text-rose-600" : r.balance > 0 ? "text-amber-600" : "text-slate-300")}>
                  {r.balance > 0 ? manwon(r.balance) : "—"}
                </td>
                <td className="px-3 py-1.5">
                  {/* 막대 길이는 **청구액**에 비례합니다 - 그래야 30명 반의 20%와 3명 반의
                      20%가 같은 크기로 보이지 않습니다. */}
                  <Bar row={r} widthPct={(r.billed / max) * 100} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 받음(초록) · 연체(빨강) · 남음(회색) 세 토막. */
function Bar({ row, widthPct }: { row: BreakRow; widthPct: number }) {
  const paidPct = row.billed > 0 ? (row.paid / row.billed) * 100 : 100;
  const overduePct = row.billed > 0 ? (row.overdue / row.billed) * 100 : 0;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100" style={{ maxWidth: `${Math.max(12, widthPct)}%` }}>
        <span className="flex h-full w-full">
          <span className="h-full bg-emerald-500" style={{ width: `${paidPct}%` }} />
          <span className="h-full bg-rose-400" style={{ width: `${overduePct}%` }} />
        </span>
      </span>
      <span className={"w-10 shrink-0 text-right text-[10px] font-bold tabular-nums " + (row.rate >= 95 ? "text-emerald-600" : row.rate >= 70 ? "text-slate-500" : "text-rose-600")}>
        {row.rate}%
      </span>
    </span>
  );
}

/**
 * 원형 그래프. 라이브러리 없이 SVG 한 조각입니다 - 도넛 하나를 그리려고 차트 묶음을
 * 통째로 받아오면 화면이 그만큼 늦게 뜨고, 그 늦음은 매번 납니다.
 */
function Donut({ row, size, title }: { row: BreakRow; size: number; title: string }) {
  const stroke = Math.max(9, Math.round(size * 0.13));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const paid = Math.min(1, row.billed > 0 ? row.paid / row.billed : 1);
  const overdue = Math.min(1 - paid, row.billed > 0 ? row.overdue / row.billed : 0);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          {/* 연체분을 **먼저** 깔고 그 위에 받은 몫을 덮습니다. 두 호가 겹치지 않게
              계산하는 것보다, 뒤에 깔고 덮는 쪽이 어긋날 자리가 없습니다. */}
          {overdue > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#fb7185"
              strokeWidth={stroke}
              strokeDasharray={`${c * (paid + overdue)} ${c}`}
            />
          )}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#10b981" strokeWidth={stroke} strokeDasharray={`${c * paid} ${c}`} strokeLinecap="butt" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={"font-black tabular-nums " + (size > 110 ? "text-2xl" : "text-[15px]") + " " + (row.rate >= 95 ? "text-emerald-600" : row.rate >= 70 ? "text-slate-700" : "text-rose-600")}>
            {row.rate}%
          </span>
          {size > 110 && <span className="text-[10px] font-semibold text-slate-400">수납</span>}
        </div>
      </div>
      <p className="max-w-[110px] truncate text-center text-[11px] font-bold text-slate-700">{title}</p>
      <p className="text-[10px] tabular-nums text-slate-400">
        {manwon(row.paid)} / {manwon(row.billed)}
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "emerald" | "amber" | "rose" }) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p className={"mt-0.5 truncate text-[15px] font-black tabular-nums " + color}>{value}</p>
      {sub && <p className="truncate text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
