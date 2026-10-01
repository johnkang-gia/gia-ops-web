"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import ScopeTabs from "@/components/finance/ScopeTabs";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import AlltalkpayExport from "@/components/finance/AlltalkpayExport";
import InvoicePreviewModal from "@/components/finance/InvoicePreviewModal";
import { ALL_SCOPE, inScope, type Scope } from "@/lib/gradeScope";
import { departmentOf, gradeSortKey, tabIncludes } from "@/lib/department";
import { won } from "@/lib/feeItems";

/**
 * **회계 화면** — 학생 탭과 청구서 탭.
 *
 * 돈을 적는 일은 전부 **학생 금전 창**에서 합니다. 이 화면은 누구를 열지 고르는 목록이고,
 * 발행된 장을 부서·학년·반으로 훑어 올톡페이로 묶어 보내는 자리입니다. 여기서 숫자를 손으로
 * 고치는 칸은 없습니다.
 */

export type LedgerRow = {
  id: string;
  name: string;
  nameEn: string | null;
  grade: string | null;
  className: string | null;
  department: string | null;
  /** 학비내역 — 정규 · 방과후 · 그 외 칸. 칸 안에는 고른 옵션과 금액. */
  tuition: { slot: "정규" | "방과후" | "그외"; label: string; amount: number; none: boolean }[];
  tuitionTotal: number;
  /** 학비외내역 — 분류별 개수와 금액. */
  extra: { category: string; count: number; amount: number }[];
  extraTotal: number;
  toBill: number;
  billed: number;
  unpaid: number;
  deposit: number;
  expected: number;
};

export type LedgerInvoiceRow = {
  id: string;
  invoiceNo: string;
  studentId: string | null;
  studentName: string;
  grade: string | null;
  className: string | null;
  department: string | null;
  stream: "학비" | "학비외";
  scope: string | null;
  issueDate: string;
  dueDate: string;
  amount: number;
  state: string;
  balance: number;
  exported: boolean;
  offline: boolean;
  termId: string | null;
};

type Tab = "학생" | "청구서";
type Stream = "학비" | "학비외";

const STATE_STYLE: Record<string, string> = {
  완납: "bg-emerald-100 text-emerald-800",
  부분납부: "bg-amber-100 text-amber-800",
  연체: "bg-rose-100 text-rose-700",
  미납: "bg-slate-100 text-slate-600",
  이월됨: "bg-slate-100 text-slate-400",
};

export default function LedgerClient({
  rows,
  invoices,
  termId,
  terms,
  deptTabs,
  loadError,
}: {
  rows: LedgerRow[];
  invoices: LedgerInvoiceRow[];
  termId: string | null;
  terms: { id: string; name: string; status: string }[];
  deptTabs: string[];
  loadError: string | null;
}) {
  // 돈에 닿는 표가 바뀌면 서버가 다시 셉니다. 창에서 발행하면 뒤의 목록도 함께 바뀝니다.
  useFinanceLive(["wr_students", "student_fee_enrollments", "student_fee_items", "fee_plans", "fee_items"]);

  /**
   * **무엇이 방금 바뀌었는지 화면이 말합니다.**
   *
   * 실시간 구독은 서버가 다시 그리게만 하므로 숫자는 맞아도 **어디가 바뀌었는지는 안 보입니다.**
   * 옆자리에서 입금을 넣거나 학생 창에서 항목을 고치면 표의 한 칸이 조용히 바뀌는데, 보는 사람은
   * 그 칸을 보고 있지 않습니다. 그래서 새로 받은 자료를 직전 것과 견줘 달라진 학생·청구서 줄을
   * 몇 초 밝히고, 머리에 「방금: 고진우 청구됨 ₩291,000 → ₩741,000」처럼 적어 둡니다.
   * 처음 한 번(직전 자료가 없을 때)은 비교하지 않습니다.
   */
  const sigOfRow = (r: LedgerRow) => [r.toBill, r.billed, r.unpaid, r.deposit, r.expected, r.tuitionTotal, r.extraTotal, r.tuition.map((c) => c.label).join("|"), r.extra.map((e) => `${e.category}${e.count}`).join("|")].join("/");
  const sigOfInv = (v: LedgerInvoiceRow) => [v.state, v.balance, v.amount, v.exported ? 1 : 0].join("/");
  const prevRef = useRef<{ rows: Map<string, string>; inv: Map<string, string> } | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<{ key: string; text: string; at: number }[]>([]);
  useEffect(() => {
    const curRows = new Map(rows.map((r) => [r.id, sigOfRow(r)]));
    const curInv = new Map(invoices.map((v) => [v.id, sigOfInv(v)]));
    const prev = prevRef.current;
    prevRef.current = { rows: curRows, inv: curInv };
    if (!prev) return;
    const changed = new Set<string>();
    const notes: { key: string; text: string; at: number }[] = [];
    const at = Date.now();
    for (const r of rows) {
      const before = prev.rows.get(r.id);
      if (before === undefined || before === curRows.get(r.id)) continue;
      changed.add(r.id);
      const b = before.split("/").map(Number);
      const what =
        b[2] !== r.unpaid ? `미수금 ${won(b[2])} → ${won(r.unpaid)}`
        : b[1] !== r.billed ? `청구액 ${won(b[1])} → ${won(r.billed)}`
        : b[3] !== r.deposit ? `예치금 ${won(b[3])} → ${won(r.deposit)}`
        : b[0] !== r.toBill ? `청구 예정액 ${won(b[0])} → ${won(r.toBill)}`
        : "항목 변경";
      notes.push({ key: `s:${r.id}:${at}`, text: `${r.name} · ${what}`, at });
    }
    for (const v of invoices) {
      const before = prev.inv.get(v.id);
      if (before === undefined) {
        notes.push({ key: `i:${v.id}:${at}`, text: `${v.studentName} · ${v.invoiceNo} 신규 발행 ${won(v.amount)}`, at });
        changed.add(v.id);
        continue;
      }
      if (before === curInv.get(v.id)) continue;
      changed.add(v.id);
      const [state, , , exp] = before.split("/");
      const what = state !== v.state ? `${v.invoiceNo} ${state} → ${v.state}` : exp !== (v.exported ? "1" : "0") ? `${v.invoiceNo} 올톡페이 ${v.exported ? "발송" : "발송 표시 해제"}` : `${v.invoiceNo} 변경`;
      notes.push({ key: `i:${v.id}:${at}`, text: `${v.studentName} · ${what}`, at });
    }
    for (const [id] of prev.inv) if (!curInv.has(id)) notes.push({ key: `x:${id}:${at}`, text: "청구서 1장 취소·이월", at });
    if (changed.size === 0 && notes.length === 0) return;
    setFlash(changed);
    setRecent((p) => [...notes, ...p].slice(0, 6));
    const t = setTimeout(() => setFlash(new Set()), 6000);
    return () => clearTimeout(t);
    // 자료가 새로 올 때만. 서명 함수는 안정적입니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, invoices]);
  const flashCls = (id: string) => (flash.has(id) ? " bg-amber-100 transition-colors duration-700" : "");
  const router = useRouter();
  const notify = useToast();

  const [tab, setTab] = useState<Tab>("학생");
  const [dept, setDept] = useState<string>(deptTabs[0] ?? "전체");
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const [stream, setStream] = useState<Stream>("학비");
  const [invState, setInvState] = useState<"전체" | "미수" | "수납 완료" | "올톡페이 미발송">("전체");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; label: string; receipt: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const deptOf = (r: { department: string | null; grade: string | null }) => departmentOf({ department: r.department, grade: r.grade }) ?? "기타";

  // ── 학생 탭 ────────────────────────────────────────────────────────────
  const inDept = rows.filter((r) => tabIncludes(dept, deptOf(r)));
  const scopeStudents = inDept.map((r) => ({ grade: r.grade, className: r.className }));
  const studentRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inDept
      .filter((r) => inScope({ grade: r.grade, className: r.className }, scope))
      .filter((r) => !needle || `${r.name} ${r.nameEn ?? ""} ${r.className ?? ""}`.toLowerCase().includes(needle))
      .filter((r) => !onlyOpen || r.toBill > 0 || r.unpaid > 0)
      .sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || (a.className ?? "").localeCompare(b.className ?? "", "ko") || a.name.localeCompare(b.name, "ko"));
  }, [inDept, scope, q, onlyOpen]);

  const sum = (f: (r: LedgerRow) => number) => studentRows.reduce((n, r) => n + f(r), 0);
  /** 학비외 분류 칸 — 보이는 학생들에게 붙은 분류를 전부 모아 금액 큰 순으로. 칸이 같아야 줄이 맞습니다. */
  const extraCats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of studentRows) for (const e of r.extra) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [studentRows]);

  // ── 청구서 탭 ──────────────────────────────────────────────────────────
  const invRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return invoices
      .filter((v) => v.stream === stream)
      .filter((v) => (v.termId ?? "") === (termId ?? "") || !v.termId)
      .filter((v) => tabIncludes(dept, deptOf(v)))
      .filter((v) => inScope({ grade: v.grade, className: v.className }, scope))
      .filter((v) => !needle || `${v.studentName} ${v.invoiceNo} ${v.scope ?? ""}`.toLowerCase().includes(needle))
      .filter((v) =>
        invState === "전체" ? true : invState === "수납 완료" ? v.state === "완납" : invState === "올톡페이 미발송" ? !v.exported && v.state !== "완납" && !v.offline : v.state !== "완납" && v.state !== "이월됨",
      )
      .sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || (a.className ?? "").localeCompare(b.className ?? "", "ko") || a.studentName.localeCompare(b.studentName, "ko") || (a.issueDate < b.issueDate ? 1 : -1));
  }, [invoices, stream, termId, dept, scope, q, invState]);

  const invSum = invRows.reduce((n, v) => n + v.amount, 0);
  const invBalance = invRows.reduce((n, v) => n + Math.max(0, v.balance), 0);

  async function markExported(ids: string[], exported: boolean) {
    if (ids.length === 0) return;
    setBusy(true);
    const res = await fetch("/api/finance/ledger/exported", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceIds: ids, exported }) });
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return notify(b.error ?? "표시하지 못했습니다.", "error");
    notify(`${ids.length}장을 ${exported ? "보냄" : "안 보냄"}으로 표시했습니다.`, "success");
    setPicked(new Set());
    router.refresh();
  }

  const togglePick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // 반별로 묶어 그립니다 - 「2학년 G2A 다 보냈나」가 한눈에 보여야 합니다.
  const groupedInv = useMemo(() => {
    const m = new Map<string, LedgerInvoiceRow[]>();
    for (const v of invRows) {
      const k = `${v.grade ? `${v.grade}학년` : "학년 없음"} ${v.className ?? ""}`.trim();
      (m.get(k) ?? m.set(k, []).get(k)!).push(v);
    }
    return [...m.entries()];
  }, [invRows]);

  return (
    <div className="mx-auto w-full max-w-[1400px] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-black text-slate-800">📒 회계</h1>
        <span className="flex overflow-hidden rounded-lg border border-slate-300 text-[12px] font-bold">
          {(["학생", "청구서"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={"px-3 py-1.5 " + (tab === t ? "bg-slate-800 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
              {t}
            </button>
          ))}
        </span>
        {terms.length > 1 && (
          <select value={termId ?? ""} onChange={(e) => router.push(`/finance/ledger?term=${e.target.value}`)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.status === "진행중" ? " (지금)" : ""}
              </option>
            ))}
          </select>
        )}
        {deptTabs.length > 1 && (
          <span className="flex overflow-hidden rounded-lg border border-slate-300 text-[12px] font-bold">
            {deptTabs.map((d) => (
              <button key={d} onClick={() => { setDept(d); setScope(ALL_SCOPE); }} className={"px-2.5 py-1.5 " + (dept === d ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50")}>
                {d}
              </button>
            ))}
          </span>
        )}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 반 · 청구서 번호" className="w-48 rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
        {tab === "학생" ? (
          <label className="flex items-center gap-1 text-[11px] text-slate-600">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 미청구·미수 학생만
          </label>
        ) : (
          <>
            <span className="flex overflow-hidden rounded-lg border border-slate-300 text-[12px] font-bold">
              {(["학비", "학비외"] as Stream[]).map((s) => (
                <button key={s} onClick={() => { setStream(s); setPicked(new Set()); }} className={"px-2.5 py-1.5 " + (stream === s ? (s === "학비" ? "bg-indigo-600 text-white" : "bg-orange-500 text-white") : "bg-white text-slate-500 hover:bg-slate-50")}>
                  {s}
                </button>
              ))}
            </span>
            <select value={invState} onChange={(e) => setInvState(e.target.value as typeof invState)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
              {["전체", "미수", "수납 완료", "올톡페이 미발송"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </>
        )}
      </div>

      {loadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">일부 자료를 못 읽었습니다 — 숫자가 모자랄 수 있습니다: {loadError}</p>}

      {recent.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
          <span className="font-black">최근 변경</span>
          {recent.map((n) => (
            <span key={n.key} className="rounded bg-white/70 px-1.5 py-0.5">
              {n.text} <span className="text-amber-500">{new Date(n.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
            </span>
          ))}
          <button onClick={() => setRecent([])} className="ml-auto text-amber-400 hover:text-amber-800" title="지우기">✕</button>
        </div>
      )}

      <ScopeTabs dept={dept} students={scopeStudents} scope={scope} onChange={setScope} />

      {tab === "학생" ? (
        /**
         * **왼쪽 학생과 오른쪽 금액 다섯 칸은 고정, 가운데 내역만 가로로 흐릅니다.**
         *
         * 내역은 아이마다 길이가 다르고 앞으로 더 길어집니다. 표 전체를 흐르게 하면 금액 칸이
         * 화면 밖으로 밀려 「이 아이 미납이 얼마지」를 보려고 매번 끝까지 굴려야 합니다. 세
         * 표를 나란히 두고 줄 높이를 같게 고정합니다 - 한 줄이 두 줄이 되는 순간 세 표가
         * 어긋나므로 모든 칸이 한 줄(nowrap)입니다.
         */
        <div className="g-panel-solid flex overflow-hidden">
          {/* 고정 — 학생 */}
          <table className="shrink-0 border-r border-slate-200 text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr className="h-12">
                <th rowSpan={2} className="px-2 text-left align-bottom">학생</th>
              </tr>
              <tr className="h-7" />
            </thead>
            <tbody>
              {studentRows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className={"h-12 cursor-pointer border-t border-slate-100 hover:bg-indigo-50/40" + flashCls(r.id)} title="누르면 학생 금전 창이 열립니다">
                  <td className="whitespace-nowrap px-2 font-semibold text-slate-800">
                    <Who id={r.id} name={r.name} plain />
                    <span className="ml-1 text-[10px] font-normal text-slate-400">
                      {r.grade ?? ""} {r.className ?? ""}
                    </span>
                  </td>
                </tr>
              ))}
              {studentRows.length === 0 && (
                <tr className="h-12">
                  <td className="px-2 text-slate-400">해당 학생 없음</td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-[12px] font-bold">
              <tr className="h-12">
                <td className="px-2">{studentRows.length}명</td>
              </tr>
            </tfoot>
          </table>

          {/* 흐르는 부분 — 학비내역 · 학비외내역 */}
          {/* pill-clip-ok: 알약이 아니라 표입니다. 여백을 두면 양옆 고정 표와 격자선이 어긋납니다. */}
          <div className="min-w-0 flex-1 overflow-x-auto">
            {/*
              칸마다 두 줄 - 위에 고른 것, 아래에 금액. 한 줄에 「정규 신청안함 · 방과후5일 월납 ₩450,000 · LMA…」
              처럼 이어 붙이면 아이마다 길이가 달라 세로로 아무것도 안 맞고, 눈이 금액을 못 찾습니다.
              칸을 정규 · 방과후 · 그 외 · 분류별로 고정하면 같은 종류의 돈이 같은 세로줄에 섭니다.
            */}
            <table className="text-[12px]">
              <thead className="bg-slate-50 text-[11px] text-slate-500">
                <tr className="h-12">
                  <th colSpan={4} className="whitespace-nowrap border-b border-slate-200 px-2 text-left text-indigo-700">학비내역</th>
                  <th colSpan={extraCats.length + 1} className="whitespace-nowrap border-b border-l border-slate-200 px-2 text-left text-orange-700">학비외내역</th>
                </tr>
                <tr className="h-7">
                  <th className="whitespace-nowrap px-2 text-left font-semibold">정규</th>
                  <th className="whitespace-nowrap px-2 text-left font-semibold">방과후</th>
                  <th className="whitespace-nowrap px-2 text-left font-semibold">그 외</th>
                  <th className="whitespace-nowrap px-2 text-right font-bold text-indigo-700">학비 소계</th>
                  {extraCats.map((c) => (
                    <th key={c} className="whitespace-nowrap border-l border-slate-100 px-2 text-left font-semibold first:border-l-slate-200">{c}</th>
                  ))}
                  <th className="whitespace-nowrap px-2 text-right font-bold text-orange-700">학비외 소계</th>
                </tr>
              </thead>
              <tbody>
                {studentRows.map((r) => {
                  const slot = (k: "정규" | "방과후" | "그외") => r.tuition.filter((c) => c.slot === k);
                  const tuitionCell = (k: "정규" | "방과후" | "그외") => {
                    const cs = slot(k);
                    const amount = cs.reduce((n, c) => n + c.amount, 0);
                    const none = cs.length === 0 || cs.every((c) => c.none);
                    return (
                      <td key={k} className="whitespace-nowrap px-2 align-middle leading-tight">
                        <div className={none ? "text-slate-300" : "font-semibold text-slate-800"}>{cs.length === 0 ? "—" : cs.map((c) => c.label).join(" · ")}</div>
                        <div className={"tabular-nums " + (none ? "text-slate-200" : "text-slate-500")}>{amount > 0 ? won(amount) : "—"}</div>
                      </td>
                    );
                  };
                  const extraOf = new Map(r.extra.map((e) => [e.category, e]));
                  return (
                    <tr key={r.id} onClick={() => setOpen(r.id)} className={"h-12 cursor-pointer border-t border-slate-100 hover:bg-indigo-50/40" + flashCls(r.id)}>
                      {tuitionCell("정규")}
                      {tuitionCell("방과후")}
                      {tuitionCell("그외")}
                      <td className="whitespace-nowrap px-2 text-right align-middle font-bold tabular-nums text-indigo-700">{r.tuitionTotal > 0 ? won(r.tuitionTotal) : <span className="font-normal text-slate-300">—</span>}</td>
                      {extraCats.map((c) => {
                        const e = extraOf.get(c);
                        return (
                          <td key={c} className="whitespace-nowrap border-l border-slate-100 px-2 align-middle leading-tight first:border-l-slate-200">
                            {e ? (
                              <>
                                <div className="font-semibold text-slate-800">{e.count}개</div>
                                <div className="tabular-nums text-slate-500">{won(e.amount)}</div>
                              </>
                            ) : (
                              <div className="text-slate-200">—</div>
                            )}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-2 text-right align-middle font-bold tabular-nums text-orange-700">{r.extraTotal > 0 ? won(r.extraTotal) : <span className="font-normal text-slate-300">—</span>}</td>
                    </tr>
                  );
                })}
                {studentRows.length === 0 && (
                  <tr className="h-12">
                    <td colSpan={5 + extraCats.length} className="px-2 text-slate-400">해당하는 학생이 없습니다.</td>
                  </tr>
                )}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-[12px] font-bold">
                <tr className="h-12">
                  {(["정규", "방과후", "그외"] as const).map((k) => (
                    <td key={k} className="whitespace-nowrap px-2 text-left tabular-nums text-slate-600">{won(sum((r) => r.tuition.filter((c) => c.slot === k).reduce((n, c) => n + c.amount, 0)))}</td>
                  ))}
                  <td className="whitespace-nowrap px-2 text-right tabular-nums text-indigo-700">{won(sum((r) => r.tuitionTotal))}</td>
                  {extraCats.map((c) => (
                    <td key={c} className="whitespace-nowrap border-l border-slate-100 px-2 text-left tabular-nums text-slate-600 first:border-l-slate-200">{won(sum((r) => r.extra.find((e) => e.category === c)?.amount ?? 0))}</td>
                  ))}
                  <td className="whitespace-nowrap px-2 text-right tabular-nums text-orange-700">{won(sum((r) => r.extraTotal))}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 고정 — 금액 다섯 칸 */}
          <table className="shrink-0 border-l border-slate-200 text-[12px]">
            <thead className="bg-slate-50 text-[11px] text-slate-500">
              <tr className="h-12">
                <th rowSpan={2} className="whitespace-nowrap px-2 text-right align-bottom">청구 예정액</th>
                <th rowSpan={2} className="whitespace-nowrap px-2 text-right align-bottom">청구액</th>
                <th rowSpan={2} className="whitespace-nowrap px-2 text-right align-bottom">미수금</th>
                <th rowSpan={2} className="whitespace-nowrap px-2 text-right align-bottom">예치금</th>
                <th rowSpan={2} className="whitespace-nowrap px-2 text-right align-bottom">학기 수납 예정액</th>
              </tr>
              <tr className="h-7" />
            </thead>
            <tbody>
              {studentRows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="h-8 cursor-pointer border-t border-slate-100 hover:bg-indigo-50/40">
                  <td className={"whitespace-nowrap px-2 text-right tabular-nums font-bold " + (r.toBill > 0 ? "text-amber-700" : "text-slate-300")}>{r.toBill > 0 ? won(r.toBill) : "—"}</td>
                  <td className="whitespace-nowrap px-2 text-right tabular-nums text-slate-600">{r.billed > 0 ? won(r.billed) : "—"}</td>
                  <td className={"whitespace-nowrap px-2 text-right tabular-nums font-bold " + (r.unpaid > 0 ? "text-rose-700" : "text-slate-300")}>{r.unpaid > 0 ? won(r.unpaid) : "—"}</td>
                  <td className={"whitespace-nowrap px-2 text-right tabular-nums " + (r.deposit > 0 ? "font-bold text-teal-700" : "text-slate-300")}>{r.deposit > 0 ? won(r.deposit) : "—"}</td>
                  <td className="whitespace-nowrap px-2 text-right tabular-nums text-slate-700">{r.expected > 0 ? won(r.expected) : "—"}</td>
                </tr>
              ))}
              {studentRows.length === 0 && (
                <tr className="h-8">
                  <td colSpan={5} />
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-[12px] font-bold">
              <tr className="h-8">
                <td className="whitespace-nowrap px-2 text-right tabular-nums text-amber-700">{won(sum((r) => r.toBill))}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums">{won(sum((r) => r.billed))}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums text-rose-700">{won(sum((r) => r.unpaid))}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums text-teal-700">{won(sum((r) => r.deposit))}</td>
                <td className="whitespace-nowrap px-2 text-right tabular-nums">{won(sum((r) => r.expected))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-bold text-slate-700">{invRows.length}장 · {won(invSum)}</span>
            <span className="text-rose-700">미수 {won(invBalance)}</span>
            <span className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setExporting(picked.size > 0 ? [...picked] : invRows.filter((v) => v.state !== "완납" && !v.offline && !v.exported).map((v) => v.id))}
                disabled={busy || invRows.length === 0}
                className="rounded-lg bg-violet-600 px-3 py-1.5 font-bold text-white hover:bg-violet-700 disabled:opacity-40"
                title="체크한 장(없으면 아직 안 보낸 안 걷힌 장 전부)으로 올톡페이 등록 파일을 만듭니다"
              >
                📤 올톡페이로 청구{picked.size > 0 ? ` (${picked.size})` : ""}
              </button>
              <button onClick={() => void markExported([...picked], true)} disabled={busy || picked.size === 0} className="rounded-lg border border-slate-300 px-2 py-1.5 font-semibold text-slate-600 disabled:opacity-40" title="올톡페이 화면에서 직접 등록한 건을 발송으로 표시">
                발송 표시
              </button>
              <button onClick={() => void markExported([...picked], false)} disabled={busy || picked.size === 0} className="rounded-lg border border-slate-300 px-2 py-1.5 font-semibold text-slate-600 disabled:opacity-40">
                발송 표시 해제
              </button>
            </span>
          </div>
          {groupedInv.length === 0 && <p className="g-panel-solid px-3 py-8 text-center text-[12px] text-slate-400">해당하는 청구서가 없습니다.</p>}
          {groupedInv.map(([group, list]) => (
            <div key={group} className="g-panel-solid mb-2 overflow-x-auto">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={list.every((v) => picked.has(v.id))}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      for (const v of list) e.target.checked ? n.add(v.id) : n.delete(v.id);
                      return n;
                    })
                  }
                />
                {group} · {list.length}장 · {won(list.reduce((n, v) => n + v.amount, 0))}
                <span className="text-rose-600">안 걷힘 {won(list.reduce((n, v) => n + Math.max(0, v.balance), 0))}</span>
              </div>
              <table className="w-full text-[12px]">
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id} className={"border-t border-slate-100 hover:bg-slate-50" + flashCls(v.id)}>
                      <td className="w-6 px-2 py-1">
                        <input type="checkbox" checked={picked.has(v.id)} onChange={() => togglePick(v.id)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 font-semibold text-slate-800">
                        {v.studentId ? (
                          <button onClick={() => setOpen(v.studentId)} className="underline-offset-2 hover:underline" title="학생 금전 창">
                            <Who id={v.studentId} name={v.studentName} />
                          </button>
                        ) : (
                          v.studentName
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1">
                        <button onClick={() => setPreview({ id: v.id, label: `${v.studentName} · ${v.invoiceNo}`, receipt: false })} className="font-bold text-slate-700 underline">
                          {v.invoiceNo}
                        </button>
                        {v.offline && <span className="ml-1 text-[10px] text-sky-600">기수납</span>}
                      </td>
                      <td className="max-w-[240px] truncate px-2 py-1 text-slate-600" title={v.scope ?? ""}>
                        {v.scope ?? (v.stream === "학비" ? "학비 전부" : "")}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-slate-500">{v.issueDate}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-bold">{won(v.amount)}</td>
                      <td className="px-2 py-1">
                        <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (STATE_STYLE[v.state] ?? "")}>
                          {v.state}
                          {v.balance > 0 && v.state !== "미납" ? ` ${won(v.balance)}` : ""}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-[10px]">
                        {v.offline ? <span className="text-slate-300">—</span> : v.exported ? <span className="font-bold text-violet-700">올톡 보냄</span> : <span className="text-slate-400">안 보냄</span>}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {v.state === "완납" && (
                          <button onClick={() => setPreview({ id: v.id, label: `${v.studentName} · ${v.invoiceNo} 영수증`, receipt: true })} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700" title="영수증">
                            📄
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {open && <StudentLedgerModal studentId={open} termId={termId} onClose={() => setOpen(null)} onChanged={() => router.refresh()} />}
      {exporting && (
        <AlltalkpayExport
          invoiceIds={exporting}
          onClose={() => setExporting(null)}
          onMarked={() => {
            setPicked(new Set());
            router.refresh();
          }}
        />
      )}
      {preview && <InvoicePreviewModal invoiceId={preview.id} label={preview.label} receipt={preview.receipt} onClose={() => setPreview(null)} />}
    </div>
  );
}
