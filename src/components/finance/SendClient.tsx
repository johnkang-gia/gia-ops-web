"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { Who } from "@/components/common/HomonymProvider";
import AlltalkpayExport from "@/components/finance/AlltalkpayExport";
import BillingPhoneChips, { saveBillingPhone } from "@/components/finance/BillingPhoneChips";
import StudentLedgerModal from "@/components/finance/StudentLedgerModal";
import type { GuardianRole } from "@/lib/alltalkpay";

export type SendRow = {
  id: string;
  invoiceNo: string;
  studentId: string | null;
  name: string;
  where: string;
  label: string;
  billingMonth: string;
  stream: "학비" | "학비외";
  total: number;
  balance: number;
  exportedAt: string | null;
  role: GuardianRole | null;
  options: { role: GuardianRole; phone: string }[];
};

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
type View = "안 보냄" | "보냄·미납" | "전체";

/**
 * 올톡 보내기 — 안 보낸 청구서를 골라 학생마다 청구 번호를 확인·변경하고 올톡 등록 파일을 만듭니다.
 *
 * 번호 칩은 **학생의 청구 번호**를 바로 고칩니다(다음 청구부터도 그 번호). 한 화면에서 번호까지
 * 끝나야 담당자가 올톡페이 화면에서 따로 보내지 않습니다.
 */
export default function SendClient({ rows, error }: { rows: SendRow[]; error: string | null }) {
  useFinanceLive();
  const router = useRouter();
  const notify = useToast();
  const [view, setView] = useState<View>("안 보냄");
  const [month, setMonth] = useState<string>("");
  const [stream, setStream] = useState<"" | "학비" | "학비외">("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ledger, setLedger] = useState<{ id: string; month: string } | null>(null);

  const months = useMemo(() => [...new Set(rows.map((r) => r.billingMonth))].sort().reverse(), [rows]);
  const shown = useMemo(
    () =>
      rows
        .filter((r) => (view === "안 보냄" ? !r.exportedAt : view === "보냄·미납" ? !!r.exportedAt : true))
        .filter((r) => !month || r.billingMonth === month)
        .filter((r) => !stream || r.stream === stream)
        .filter((r) => !q.trim() || `${r.name} ${r.where} ${r.invoiceNo}`.includes(q.trim()))
        .sort((a, b) => a.where.localeCompare(b.where) || a.name.localeCompare(b.name, "ko") || a.invoiceNo.localeCompare(b.invoiceNo)),
    [rows, view, month, stream, q],
  );
  const counts = useMemo(
    () => ({ unsent: rows.filter((r) => !r.exportedAt).length, sent: rows.filter((r) => !!r.exportedAt).length }),
    [rows],
  );
  const noPhone = shown.filter((r) => r.options.length === 0).length;
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));
  const pickedRows = rows.filter((r) => picked.has(r.id));

  async function setPhone(r: SendRow, role: GuardianRole | null, phone?: string) {
    if (!r.studentId) {
      notify("학생이 연결되지 않은 청구서입니다.", "error");
      return;
    }
    setBusy(r.id);
    try {
      const err = await saveBillingPhone(r.studentId, phone ? "direct" : role, phone);
      if (err) notify(`청구 번호를 저장하지 못했습니다: ${err}`, "error");
      else {
        notify(`${r.name} 청구 번호를 바꿨습니다. 이 학생의 다음 청구부터도 이 번호로 나갑니다.`, "success");
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-3 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">📤 올톡 보내기</h1>
        <span className="text-[12px] text-slate-500">발행한 청구서를 골라 올톡페이 등록 파일을 만듭니다. 청구사유 앞에 청구서 번호가 붙어 결과를 정확히 맞출 수 있습니다.</span>
        <Link href="/finance/alltalk-sync" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          결과 맞추기(올톡 대조) →
        </Link>
      </div>
      {error && <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">자료를 읽지 못했습니다: {error}</p>}

      <ol className="mb-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-3">
        <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <b className="text-slate-800">① 고르기</b> — 청구월·학비/학비외로 걸러 보낼 청구서를 체크합니다.
        </li>
        <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <b className="text-slate-800">② 번호 확인</b> — 「청구 번호」 칸에서 누구 번호로 갈지 누르거나 「+ 번호」로 적습니다. 학생에게 저장되어 다음에도 그대로 갑니다.
        </li>
        <li className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <b className="text-slate-800">③ 파일 만들기</b> — 엑셀을 내려받아 올톡페이 <b>대량발송</b>에 그대로 올립니다. 내려받으면 「보냄」으로 표시됩니다.
        </li>
      </ol>

      <div className="sticky top-0 z-10 -mx-1 mb-2 flex flex-wrap items-center gap-1.5 bg-slate-50/95 px-1 py-1.5 backdrop-blur">
        {(["안 보냄", "보냄·미납", "전체"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => {
              setView(v);
              setPicked(new Set());
            }}
            className={"rounded-lg border px-2.5 py-1 text-[12px] font-bold " + (view === v ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700")}
          >
            {v} {v === "안 보냄" ? counts.unsent : v === "보냄·미납" ? counts.sent : rows.length}
          </button>
        ))}
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
          <option value="">청구월 전체</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m.slice(0, 4)}년 {Number(m.slice(5))}월
            </option>
          ))}
        </select>
        <select value={stream} onChange={(e) => setStream(e.target.value as typeof stream)} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
          <option value="">학비 · 학비외</option>
          <option value="학비">학비</option>
          <option value="학비외">학비외</option>
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·반·청구서 번호" className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-[12px]" />
        {noPhone > 0 && <span className="rounded bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-800">번호 없음 {noPhone}명 — 「+ 번호」로 적어주세요</span>}
        <button
          onClick={() => setExporting(pickedRows.map((r) => r.id))}
          disabled={pickedRows.length === 0}
          className="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
        >
          📤 고른 {pickedRows.length}장 올톡 보내기 {pickedRows.length > 0 && `· ${won(pickedRows.reduce((n, r) => n + r.balance, 0))}원`}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[980px] text-[12px]">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="w-8 px-2 py-1.5">
                <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.id)))} />
              </th>
              <th className="px-2 py-1.5 text-left">학생</th>
              <th className="px-2 py-1.5 text-left">청구서</th>
              <th className="px-2 py-1.5 text-right">보낼 금액</th>
              <th className="px-2 py-1.5 text-left">청구 번호 (누르면 바뀜 · 학생에게 저장)</th>
              <th className="px-2 py-1.5 text-left">보냄</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={"border-t border-slate-100 " + (picked.has(r.id) ? "bg-emerald-50/60" : "")}>
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={picked.has(r.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(r.id)) n.delete(r.id);
                        else n.add(r.id);
                        return n;
                      })
                    }
                  />
                </td>
                <td className="px-2 py-1.5">
                  {r.studentId ? (
                    <button onClick={() => setLedger({ id: r.studentId!, month: r.billingMonth })} className="font-bold text-slate-800 underline decoration-slate-300 hover:decoration-slate-700" title="학생 회계 창 열기">
                      <Who id={r.studentId} name={r.name} plain />
                    </button>
                  ) : (
                    <b>{r.name}</b>
                  )}
                  <span className="ml-1 text-[10px] text-slate-400">{r.where}</span>
                </td>
                <td className="px-2 py-1.5">
                  <b className="text-slate-700">{r.invoiceNo}</b> <span className="text-slate-500">{r.label}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                  {won(r.balance)}
                  {r.balance !== r.total && <div className="text-[10px] font-normal text-slate-400">청구 {won(r.total)}</div>}
                </td>
                <td className="px-2 py-1.5">
                  {r.options.length === 0 && <span className="mr-1 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-800">번호 없음</span>}
                  <BillingPhoneChips options={r.options} current={r.role} busy={busy === r.id} onPick={(role) => void setPhone(r, role)} onNew={(phone) => void setPhone(r, "direct", phone)} />
                </td>
                <td className="px-2 py-1.5 text-[11px] text-slate-500">{r.exportedAt ? <span className="font-bold text-violet-700">{r.exportedAt.slice(5, 10).replace("-", "/")} 보냄</span> : "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-[13px] text-slate-400">
                  {view === "안 보냄" ? "안 보낸 청구서가 없습니다." : "청구서가 없습니다."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

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
      {ledger && <StudentLedgerModal studentId={ledger.id} month={ledger.month} onClose={() => setLedger(null)} onChanged={() => router.refresh()} />}
    </div>
  );
}
