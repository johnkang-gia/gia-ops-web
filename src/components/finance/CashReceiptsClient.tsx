"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";

/**
 * 현금영수증 — 신청받고, 홈택스에서 발행하고, 발행됐다고 표시합니다.
 *
 * **발행 자체는 여기서 하지 않습니다.** 국세청 연동은 사업자 인증서와 별도 신청이 필요해
 * 지금 바로는 안 됩니다. 그래서 이 화면은 «누가 무엇으로 신청했는가»를 남기고 홈택스로
 * 건너가게 하는 데까지만 합니다.
 *
 * 그 정도로도 지금보다 낫습니다 - 지금은 요청이 카톡과 구두로 오가고 발행 여부가 담당자
 * 기억에 있습니다. 연말정산 철에 «해주셨어요?»라는 문의가 오면 확인할 방법이 없습니다.
 */

export type CashReceiptRow = {
  id: string;
  invoice_id: string | null;
  student_id: string | null;
  purpose: "소득공제" | "지출증빙";
  identifier: string;
  amount: number;
  status: "신청" | "발행" | "취소";
  issued_at: string | null;
  approval_no: string | null;
  note: string | null;
  requested_by: string | null;
  issued_by: string | null;
  created_at: string;
};

/** 홈택스 현금영수증 발행 화면. 매출(우리가 발행하는 쪽) 자리로 바로 갑니다. */
const HOMETAX_ISSUE_URL = "https://www.hometax.go.kr/websquare/websquare.wq?w2xPath=/ui/pp/index_pp.xml";

function maskId(purpose: string, id: string): string {
  const v = (id ?? "").replace(/[^0-9]/g, "");
  if (purpose === "지출증빙") return v.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3") || v;
  return v.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") || v;
}

export default function CashReceiptsClient({
  initialRows,
  nameByStudent,
  currentUserName,
}: {
  initialRows: CashReceiptRow[];
  nameByStudent: Record<string, string>;
  currentUserName: string;
}) {
  const notify = useToast();
  const [rows, setRows] = useState(initialRows);
  const [tab, setTab] = useState<"신청" | "발행" | "취소">("신청");
  const [busy, setBusy] = useState<string | null>(null);

  const shown = useMemo(() => rows.filter((r) => r.status === tab), [rows, tab]);
  const counts = useMemo(
    () => ({
      신청: rows.filter((r) => r.status === "신청").length,
      발행: rows.filter((r) => r.status === "발행").length,
      취소: rows.filter((r) => r.status === "취소").length,
    }),
    [rows],
  );

  async function mark(row: CashReceiptRow, next: "발행" | "취소", approvalNo?: string) {
    setBusy(row.id);
    const patch =
      next === "발행"
        ? {
            status: next,
            issued_at: todayKst(),
            issued_by: currentUserName,
            approval_no: approvalNo?.trim() || null,
          }
        : { status: next };
    const { error } = await createClient().from("cash_receipts").update(patch).eq("id", row.id);
    setBusy(null);
    if (error) {
      // 조용히 넘기면 화면에는 발행된 것처럼 보이는데 기록은 그대로입니다.
      notify("바꾸지 못했습니다: " + error.message, "error");
      return;
    }
    setRows((p) => p.map((r) => (r.id === row.id ? { ...r, ...patch } as CashReceiptRow : r)));
  }

  return (
    <div>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
        <b>발행은 홈택스에서 합니다.</b> 이 화면은 신청 내용을 모아두고, 발행한 뒤 승인번호를 적어
        «끝났다»를 남기는 자리입니다. 국세청 자동 발행은 사업자 인증서와 별도 신청이 필요해 아직
        준비 단계입니다.
        <a
          href={HOMETAX_ISSUE_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-2 inline-block rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700"
        >
          홈택스 열기 →
        </a>
      </div>

      <div className="mb-2 flex gap-1">
        {(["신청", "발행", "취소"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-lg px-3 py-1.5 text-xs font-semibold " +
              (tab === t ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50")
            }
          >
            {t} {counts[t]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-6 text-center text-[12px] text-slate-400">
          {tab === "신청" ? "발행을 기다리는 건이 없습니다." : `${tab}된 건이 없습니다.`}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {shown.map((r) => (
            <Row key={r.id} r={r} name={r.student_id ? nameByStudent[r.student_id] : undefined} busy={busy === r.id} onMark={mark} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({
  r,
  name,
  busy,
  onMark,
}: {
  r: CashReceiptRow;
  name?: string;
  busy: boolean;
  onMark: (row: CashReceiptRow, next: "발행" | "취소", approvalNo?: string) => void;
}) {
  const [approval, setApproval] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-3 py-2 last:border-0">
      <span className="w-16 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-center text-[11px] font-bold text-slate-600">
        {r.purpose}
      </span>
      <b className="text-[13px] text-slate-800">{name ?? "학생 미확인"}</b>
      <span className="tabular-nums text-[13px] font-semibold text-slate-700">{Number(r.amount).toLocaleString()}원</span>
      <span className="text-[12px] text-slate-500">{maskId(r.purpose, r.identifier)}</span>
      <span className="text-[11px] text-slate-400">{r.created_at.slice(0, 10)}</span>

      {r.status === "신청" ? (
        <span className="ml-auto flex items-center gap-1.5">
          {/* 승인번호는 **선택**입니다. 적으면 «정말 나갔다»가 증명되고, 안 적어도 발행
              표시는 됩니다 - 필수로 막으면 바쁜 날 아예 표시를 안 하게 됩니다. */}
          <input
            value={approval}
            onChange={(e) => setApproval(e.target.value)}
            placeholder="승인번호(선택)"
            className="w-32 rounded-lg border border-slate-300 px-2 py-1 text-[11px]"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => onMark(r, "발행", approval)}
            className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40"
          >
            발행함
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onMark(r, "취소")}
            className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-500 disabled:opacity-40"
          >
            취소
          </button>
        </span>
      ) : (
        <span className="ml-auto text-[11px] text-slate-400">
          {r.status === "발행" ? `${r.issued_at ?? ""} ${r.issued_by ?? ""} ${r.approval_no ?? ""}`.trim() : "취소됨"}
        </span>
      )}
    </li>
  );
}
