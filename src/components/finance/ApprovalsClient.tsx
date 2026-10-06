"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { useFinanceLive } from "@/lib/useFinanceLive";
import type { FinanceRequest } from "@/lib/types";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const when = (s: string | null) => (s ? s.replace("T", " ").slice(0, 16) : "");

export type ApprovalRow = FinanceRequest & {
  invoiceNo: string;
  studentName: string;
  invoiceTotal: number;
  stream: string | null;
  /** 결재할 수 없는 이유. null 이면 승인·반려 단추를 그립니다. */
  block: string | null;
  mine: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  대기: "bg-amber-100 text-amber-800",
  승인: "bg-emerald-100 text-emerald-800",
  반려: "bg-rose-100 text-rose-700",
  취소: "bg-slate-100 text-slate-400",
};

export default function ApprovalsClient({ rows, loadError }: { rows: ApprovalRow[]; loadError: string | null }) {
  useFinanceLive();
  const notify = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [show, setShow] = useState<"대기" | "전체">("대기");

  const pending = rows.filter((r) => r.status === "대기");
  const list = useMemo(() => (show === "대기" ? pending : rows), [show, pending, rows]);

  async function act(r: ApprovalRow, action: "승인" | "반려" | "취소") {
    let note: string | null = null;
    if (action === "반려") {
      note = window.prompt("반려 사유 (올린 사람이 무엇을 고쳐 다시 올릴지 알 수 있게)") ?? null;
      if (!note?.trim()) return;
    } else if (action === "승인") {
      const what = r.kind === "환불" ? `${won(Number(r.amount))}을 돌려준 것으로 장부에 적습니다` : `${won(Number(r.amount))}을 받지 않기로 하고 미수금에서 뺍니다`;
      if (!window.confirm(`${r.studentName} · ${r.invoiceNo}\n${what}.\n\n승인할까요?`)) return;
    } else if (!window.confirm("이 요청을 거둘까요?")) return;

    setBusy(r.id);
    const res = await fetch(`/api/finance/requests/${r.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string; warning?: string | null } | null;
    setBusy(null);
    if (!res.ok) {
      notify(json?.error ?? "처리하지 못했습니다.", "error");
      return;
    }
    if (json?.warning) notify(json.warning, "error");
    else notify(action === "승인" ? "승인했습니다. 장부에 반영되었습니다." : action === "반려" ? "반려했습니다." : "요청을 거뒀습니다.", "success");
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-[16px] font-black text-slate-800">✅ 결재 — 결손 · 환불</h1>
        <span className="text-[11px] text-slate-500">
          올린 사람이 아닌 <b>관리자 이상 · 재무 권한</b>이 승인하면 장부에 들어갑니다.
        </span>
        <div className="ml-auto flex gap-1">
          {(["대기", "전체"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setShow(k)}
              className={"rounded-lg px-2.5 py-1 text-[12px] font-bold " + (show === k ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
            >
              {k === "대기" ? `대기 ${pending.length}` : `전체 ${rows.length}`}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{loadError}</p>}
      {list.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[12px] text-slate-400">
          {show === "대기" ? "기다리는 결재가 없습니다." : "올라온 결재가 없습니다."} 결손은 학생 금전 창의 청구서 [🛠/정정]에서, 환불은 수납 화면에서 올립니다.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {list.map((r) => (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className={"rounded px-1.5 py-0.5 text-[11px] font-black " + (r.kind === "환불" ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-700")}>{r.kind}</span>
              <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (STATUS_STYLE[r.status] ?? "")}>{r.status}</span>
              <b className="text-slate-800">{r.studentName}</b>
              <span className="text-slate-500">
                {r.invoiceNo} {r.stream ? `· ${r.stream}` : ""} · 청구 {won(r.invoiceTotal)}
              </span>
              <span className="ml-auto text-[14px] font-black tabular-nums text-slate-900">{won(Number(r.amount))}</span>
            </div>
            <p className="mt-1 text-slate-700">{r.reason}</p>
            {r.kind === "환불" && r.payload && (
              <p className="text-[11px] text-slate-500">
                돌려줄 날 {r.payload.refundedAt ?? "-"} · {r.payload.method ?? "-"}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span>
                올림 {r.requested_by} · {when(r.requested_at)}
              </span>
              {r.decided_by && (
                <span>
                  · {r.status} {r.decided_by} · {when(r.decided_at)}
                  {r.decision_note ? ` · ${r.decision_note}` : ""}
                </span>
              )}
              {r.status === "승인" && !r.applied_at && <span className="font-bold text-rose-600">· 장부 반영 기록이 없습니다 — 확인 필요</span>}
              <span className="ml-auto flex gap-1">
                {r.status === "대기" && r.block === null && (
                  <>
                    <button
                      disabled={busy === r.id}
                      onClick={() => void act(r, "승인")}
                      className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300"
                    >
                      승인
                    </button>
                    <button
                      disabled={busy === r.id}
                      onClick={() => void act(r, "반려")}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                      반려
                    </button>
                  </>
                )}
                {r.status === "대기" && r.block !== null && <span className="text-[11px] text-slate-500">{r.block}</span>}
                {r.status === "대기" && r.mine && (
                  <button disabled={busy === r.id} onClick={() => void act(r, "취소")} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-100">
                    거두기
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
