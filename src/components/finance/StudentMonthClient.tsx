"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { Who } from "@/components/common/HomonymProvider";
import { useToast } from "@/components/common/ToastProvider";
import { monthLabel } from "@/lib/financePeriod";
import type { MonthTotals, RowState, StudentMonthRow } from "@/lib/studentMonthLedger";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

const STATE_TONE: Record<RowState, string> = {
  완납: "bg-emerald-100 text-emerald-800",
  부분납부: "bg-amber-100 text-amber-800",
  연체: "bg-rose-100 text-rose-800",
  미납: "bg-slate-100 text-slate-600",
  "청구 없음": "bg-slate-50 text-slate-400",
};

/**
 * 고르개.
 *
 * 앞 판은 「전체 · 안 낸 사람 · 한 푼도 안 냄 · 완납」이었는데, 가운데 둘이 **서로를
 * 품고 있었습니다** — 한 푼도 안 낸 사람은 안 낸 사람이기도 합니다. 그래서 두 칸의 합이
 * 전체보다 크고, 「안 낸 사람 40명」과 「한 푼도 안 냄 25명」을 나란히 보는 사람은 그 25명이
 * 40명 안에 있는지 밖에 있는지 알 수 없었습니다.
 *
 * 지금은 **서로 겹치지 않게** 셋으로 가릅니다. 셋을 더하면 청구가 있는 사람 전부입니다.
 *
 *   미납  — 한 푼도 안 들어옴 (연락해야 할 사람)
 *   부분납 — 내다 말았음 (남은 금액만 말하면 되는 사람)
 *   완납  — 다 냈음
 */
type Filter = "전체" | "미납" | "부분납" | "완납";

/**
 * **그 달의 학생별 거래내역** — 통장 조회처럼 봅니다.
 *
 * 위쪽 표는 「누가 얼마」이고, 한 줄을 누르면 아래로 **그 사람의 그 달 거래내역**이 열립니다.
 * 은행 거래내역과 같은 모양입니다 - 왼쪽에 날짜, 가운데에 내용, 오른쪽에 청구(+) · 수납(−) ·
 * 잔액. 마지막 줄의 잔액이 지금 못 받은 돈입니다.
 *
 * 합계를 여기서 다시 세지 않습니다. 서버가 `buildStudentMonth` 로 한 번 세고 그 값을
 * 그립니다 - 화면이 또 세면 정렬이나 필터를 건드릴 때마다 합계가 슬쩍 달라집니다.
 */
export default function StudentMonthClient({
  month,
  rows,
  totals,
  receivedInMonth,
}: {
  month: string;
  rows: StudentMonthRow[];
  totals: MonthTotals;
  receivedInMonth: number;
}) {
  // 옆자리에서 수납을 붙이면 이 표도 함께 바뀝니다. 전화로 「방금 냈는데요」를 받는 화면이라
  // 옛 숫자를 보여주면 안 됩니다.
  useFinanceLive(["wr_students"]);
  const notify = useToast();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("전체");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !r.name.toLowerCase().includes(needle) && !(r.where ?? "").toLowerCase().includes(needle)) return false;
      // 청구가 없는 사람은 셋 어디에도 넣지 않습니다 - 낼 것이 없는 사람을 「미납」에 세우면
      // 연락할 명단이 부풀어 오릅니다.
      if (filter === "미납") return r.invoiceCount > 0 && r.received === 0;
      if (filter === "부분납") return r.invoiceCount > 0 && r.received > 0 && r.balance > 0;
      if (filter === "완납") return r.invoiceCount > 0 && r.balance <= 0;
      return true;
    });
  }, [rows, filter, q]);

  /** 단추에 적을 사람 수. 검색어와 무관하게 **그 달 전체**를 셉니다 - 검색 중에 숫자가 줄면
      「사라진 사람」이 있는 줄 압니다. */
  const counts = useMemo(
    () => ({
      미납: rows.filter((r) => r.invoiceCount > 0 && r.received === 0).length,
      부분납: rows.filter((r) => r.invoiceCount > 0 && r.received > 0 && r.balance > 0).length,
      완납: rows.filter((r) => r.invoiceCount > 0 && r.balance <= 0).length,
    }),
    [rows],
  );

  function toggle(id: string) {
    setOpen((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 지금 보이는 줄을 그대로 표로 복사합니다. 보고할 때 화면을 옮겨 적지 않게 하려는 것입니다. */
  async function copyTable() {
    const head = ["학생", "반", "건수", "청구", "수납", "미납", "상태", "마지막 수납일"].join("\t");
    const body = visible
      .map((r) => [r.name, r.where ?? "", r.invoiceCount, r.billed, r.received, r.balance, r.state, r.lastPaidAt ?? ""].join("\t"))
      .join("\n");
    try {
      await navigator.clipboard.writeText(`${head}\n${body}`);
      notify(`${visible.length}줄을 복사했습니다. 엑셀에 붙여넣으세요.`, "success");
    } catch {
      // 조용히 넘기면 복사된 줄 알고 붙여넣기를 합니다.
      notify("복사하지 못했습니다. 브라우저가 막았을 수 있습니다.", "error");
    }
  }

  const rate = totals.billed > 0 ? Math.round((totals.received / totals.billed) * 100) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* ── 그 달 한 줄 요약 ─────────────────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Card label="청구" value={won(totals.billed)} sub={`${totals.people}명 · ${totals.invoiceCount}건`} />
        <Card label="수납" value={won(totals.received)} sub={rate === null ? "—" : `${rate}%`} tone="emerald" />
        <Card
          label="미납"
          value={won(totals.balance)}
          sub={totals.untouched > 0 ? `미납(한 푼도 안 냄) ${totals.untouched}명` : "전부 일부라도 냈습니다"}
          tone={totals.balance > 0 ? "rose" : "slate"}
        />
        <Card
          label="그 달에 들어온 돈"
          value={won(receivedInMonth)}
          sub={`${monthLabel(month)}에 통장·올톡페이로 찍힌 돈`}
        />
      </div>

      {(totals.cancelled > 0 || totals.carried > 0) && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900">
          {totals.cancelled > 0 && <b>취소 {totals.cancelled}건</b>}
          {totals.cancelled > 0 && totals.carried > 0 && " · "}
          {totals.carried > 0 && <b>다른 청구서로 합쳐짐 {totals.carried}건</b>}
          {" — 금액에서는 뺐고 줄은 그대로 남겨두었습니다. 학부모가 받은 문자와 대조할 수 있어야 합니다."}
        </p>
      )}

      {/* ── 고르개 ───────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {(["전체", "미납", "부분납", "완납"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-2.5 py-1 text-[11px] font-bold " +
              (filter === f ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
            }
          >
            {f}
            {/* 몇 명인지 단추에 적습니다. 눌러 보고서야 「아무도 없네」를 알면, 그 한 번의
                헛걸음 때문에 다음부터는 안 누르게 됩니다. */}
            {f !== "전체" && <span className="ml-1 font-semibold opacity-70">{counts[f]}</span>}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="학생 이름 / 반"
          className="ml-auto w-40 rounded-lg border border-slate-200 px-2 py-1 text-[12px] outline-none focus:border-teal-400"
        />
        <button
          type="button"
          onClick={() => void copyTable()}
          className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
        >
          📋 표 복사
        </button>
      </div>

      {/* 가둔 화면 안쪽에서 굴립니다(CLAUDE.md 2-10). */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-right text-[12px]">
          <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-left">학생</th>
              <th className="px-2 py-2">건수</th>
              <th className="px-2 py-2">청구</th>
              <th className="px-2 py-2">수납</th>
              <th className="px-2 py-2">미납</th>
              <th className="px-2 py-2 text-center">상태</th>
              <th className="px-2 py-2">마지막 수납</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const isOpen = open.has(r.studentId);
              return (
                <Fragment key={r.studentId}>
                  <tr
                    onClick={() => toggle(r.studentId)}
                    className={"cursor-pointer border-b border-slate-50 hover:bg-teal-50/40 " + (isOpen ? "bg-teal-50/60" : "")}
                  >
                    <td className="px-3 py-1.5 text-left">
                      <span className="mr-1 inline-block w-3 text-slate-300">{isOpen ? "▾" : "▸"}</span>
                      <b className="text-slate-800">
                        <Who id={r.studentId} name={r.name} />
                      </b>
                      {r.where && <span className="ml-1 text-[10px] text-slate-400">{r.where}</span>}
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.invoiceCount}</td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums text-slate-800">{won(r.billed)}</td>
                    <td className="px-2 py-1.5 tabular-nums text-emerald-700">{r.received !== 0 ? won(r.received) : "—"}</td>
                    <td className={"px-2 py-1.5 font-bold tabular-nums " + (r.balance > 0 ? "text-rose-700" : "text-slate-300")}>
                      {r.balance > 0 ? won(r.balance) : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + STATE_TONE[r.state]}>{r.state}</span>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-slate-400">{r.lastPaidAt ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/finance/statement/${r.studentId}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-semibold text-teal-700 underline"
                      >
                        명세서
                      </Link>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={8} className="px-3 py-2">
                        {/* ── 통장 거래내역 ─────────────────────────────────── */}
                        <table className="w-full text-right text-[11px]">
                          <thead className="text-[10px] text-slate-400">
                            <tr className="border-b border-slate-200">
                              <th className="py-1 text-left">날짜</th>
                              <th className="py-1 text-left">내용</th>
                              <th className="py-1">청구</th>
                              <th className="py-1">수납</th>
                              <th className="py-1">잔액</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.entries.map((e, i) => (
                              <tr key={i} className="border-b border-slate-100 last:border-b-0">
                                <td className="py-1 text-left tabular-nums text-slate-500">
                                  {e.date}
                                  {e.outsideMonth && (
                                    <span
                                      className="ml-1 rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-700"
                                      title={`${monthLabel(month)}분인데 다른 달에 들어온 돈입니다`}
                                    >
                                      달 밖
                                    </span>
                                  )}
                                </td>
                                <td className="py-1 text-left text-slate-700">
                                  {e.label}
                                  {e.method && <span className="ml-1 text-[10px] text-slate-400">{e.method}</span>}
                                </td>
                                <td className="py-1 tabular-nums text-slate-700">{e.billed > 0 ? won(e.billed) : ""}</td>
                                <td className={"py-1 tabular-nums " + (e.received < 0 ? "text-rose-600" : "text-emerald-700")}>
                                  {e.received !== 0 ? won(e.received) : ""}
                                </td>
                                <td className="py-1 font-bold tabular-nums text-slate-900">
                                  {e.kind === "취소" || e.kind === "이월됨" ? "" : won(e.running)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[13px] text-slate-400">
                  {rows.length === 0 ? `${monthLabel(month)}에 청구한 것이 없습니다.` : "고른 조건에 맞는 학생이 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: string }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "rose" ? "text-rose-700" : "text-slate-800";
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-0.5 text-lg font-black tabular-nums ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}
