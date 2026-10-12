"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFinanceLive } from "@/lib/useFinanceLive";
import { useToast } from "@/components/common/ToastProvider";
import { readAlltalkFile } from "@/lib/alltalkFile";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export type BatchRow = {
  batch_id: string;
  file_name: string;
  status: string;
  uploaded_by: string;
  uploaded_at: string;
  rows_total: number;
  waiting: number;
  approved: number;
  applied: number;
  failed: number;
  need_person: number;
  approved_amount: number;
};

/**
 * **올톡페이 결제내역 올리기.**
 *
 * 올리면 **검수 대기**로만 들어갑니다 - 여기서는 청구서도 입금도 만들어지지 않습니다.
 * 파일을 읽는 일만 브라우저에서 하고, 판정과 저장은 서버가 합니다.
 */
export default function ImportUploadClient({ batches }: { batches: BatchRow[] }) {
  useFinanceLive(["payment_imports", "payment_import_rows"]);
  const notify = useToast();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const rows = await readAlltalkFile(file);

      if (rows.length === 0) {
        notify("읽을 줄이 없습니다. 첫 시트에 고객명·청구금액 칸이 있는지 확인해주세요.", "error");
        return;
      }

      const res = await fetch("/api/finance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, rows }),
      });
      const json = (await res.json().catch(() => null)) as
        | { error?: string; batchId?: string; summary?: { total: number; auto: number; needPerson: number; notFound: number; already: number; preApproved?: number } }
        | null;
      // 조용히 넘기면 올린 줄 알고 기다리게 됩니다.
      if (!res.ok) {
        notify(json?.error ?? "올리지 못했습니다.", "error");
        return;
      }
      const s = json?.summary;
      notify(
        `${s?.total}줄을 읽었습니다 — 자동 ${s?.auto} · 확인필요 ${s?.needPerson} · 못찾음 ${s?.notFound}${s?.already ? ` · 이미 있음 ${s.already}` : ""}${s?.preApproved ? ` · 앱 청구서와 번호·금액이 맞아 승인된 줄 ${s.preApproved}` : ""}. 아직 반영되지 않았습니다.`,
        "success",
      );
      router.push(`/finance/import/${json?.batchId}`);
    } catch (e) {
      notify("파일을 읽지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50/60 px-3 py-3">
        <p className="mb-1.5 rounded-lg bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
          앱에서 이미 청구서를 발행한 달이면 여기가 아니라 <Link href="/finance/alltalk-sync" className="underline">올톡페이 › 결과 맞추기</Link>에 올리세요. 여기는 앱에 없는 청구를 새로 만드는 곳이라, 같은 청구서가 한 장 더 생깁니다.
        </p>
        <p className="text-[12px] font-bold text-teal-900">올톡페이 「청구서관리목록」 엑셀을 그대로 올리세요.</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-teal-800">
          올리면 <b>검수 대기</b>로만 들어갑니다 — 청구서도 입금도 아직 만들어지지 않습니다. 학생별로 무엇이 어떻게
          바뀌는지 보고 승인한 줄만 반영됩니다.
          <br />
          결제완료는 <b>청구서 + 입금</b>으로, 발송완료는 <b>청구서만</b>(미납금으로 잡힘), 결제중단·발송실패는 건너뜁니다.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="text-[11px] file:mr-2 file:rounded-lg file:border-0 file:bg-teal-600 file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white hover:file:bg-teal-700"
          />
          {busy && <span className="text-[11px] font-semibold text-teal-700">읽는 중…</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 bg-slate-50 text-[10px] text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2">파일</th>
              <th className="px-2 py-2">올린 사람</th>
              <th className="px-2 py-2 text-right">줄</th>
              <th className="px-2 py-2 text-right">대기</th>
              <th className="px-2 py-2 text-right">승인</th>
              <th className="px-2 py-2 text-right">반영됨</th>
              <th className="px-2 py-2 text-center">상태</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.batch_id} className="border-b border-slate-50 last:border-b-0 hover:bg-teal-50/30">
                <td className="px-3 py-1.5">
                  <Link href={`/finance/import/${b.batch_id}`} className="font-semibold text-slate-800 underline decoration-slate-300">
                    {b.file_name}
                  </Link>
                  <div className="text-[10px] text-slate-400">{b.uploaded_at?.slice(0, 16).replace("T", " ")}</div>
                </td>
                <td className="px-2 py-1.5 text-[11px] text-slate-500">{b.uploaded_by}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{b.rows_total}</td>
                <td className={"px-2 py-1.5 text-right font-bold tabular-nums " + (b.waiting > 0 ? "text-amber-700" : "text-slate-300")}>
                  {b.waiting || "—"}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700">
                  {b.approved || "—"}
                  {b.approved_amount > 0 && <span className="ml-1 text-[10px] text-slate-400">{won(b.approved_amount)}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                  {b.applied || "—"}
                  {b.failed > 0 && <span className="ml-1 rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">실패 {b.failed}</span>}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (b.status === "반영됨" ? "bg-slate-800 text-white" : "bg-teal-100 text-teal-800")}>
                    {b.status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <Link href={`/finance/import/${b.batch_id}`} className="text-[11px] font-semibold text-teal-700 underline">
                    {b.waiting > 0 ? "검수하기 →" : "보기 →"}
                  </Link>
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[13px] text-slate-400">
                  아직 올린 파일이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
