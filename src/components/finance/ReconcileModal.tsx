"use client";

import { useMemo, useState } from "react";
import { useToast } from "@/components/common/ToastProvider";
import { won } from "@/lib/feeItems";
import { reconcile, toBillLines, type MatchedRow, type Reconciliation, type StudentSide } from "@/lib/reconcileBills";

// 올톡페이 청구서와 우리 계산 맞춰보기.
//
// 아이마다 항목을 등록한 뒤, 이미 보낸 청구서와 **금액이 같은지**부터 봅니다. 여기서 어긋나면
// 등록이 잘못된 것입니다. 대조 없이 발행하면 학부모가 받은 종이와 다른 금액이 나갑니다.
//
// **아무것도 저장하지 않습니다.** 파일은 이 화면에서 읽고 끝입니다 - 수납으로 넣는 것은
// 별개의 화면에서, 항목 등록이 다 맞은 뒤에 합니다.

type Props = {
  students: StudentSide[];
  onClose: () => void;
  /** 이름을 누르면 그 학생 창을 엽니다. */
  onOpenStudent?: (studentId: string) => void;
};

export default function ReconcileModal({ students, onClose, onOpenStudent }: Props) {
  const notify = useToast();
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"differ" | "same" | "unknown" | "missing">("differ");

  async function readFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
      const lines = toBillLines(rows);
      if (lines.length === 0) {
        notify("고객명과 청구금액이 있는 줄을 찾지 못했습니다.", "error");
        return;
      }
      setResult(reconcile(lines, students));
    } catch (e) {
      notify("파일을 읽지 못했습니다: " + (e instanceof Error ? e.message : String(e)), "error");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(
    () => ({
      differ: result?.differ.length ?? 0,
      same: result?.same.length ?? 0,
      unknown: result?.unknown.length ?? 0,
      missing: result?.missingBill.length ?? 0,
    }),
    [result],
  );

  const rows: MatchedRow[] = result
    ? tab === "differ"
      ? result.differ
      : tab === "same"
        ? result.same
        : tab === "unknown"
          ? result.unknown
          : []
    : [];

  const tabBtn = (k: typeof tab, label: string, n: number, tone: string) => (
    <button
      key={k}
      onClick={() => setTab(k)}
      className={
        "rounded-lg px-2.5 py-1 text-[12px] font-bold transition " +
        (tab === k ? tone : "border border-slate-200 text-slate-500 hover:bg-slate-50")
      }
    >
      {label} {n}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <span className="text-base font-black text-slate-800">🔍 올톡페이 청구서와 대조</span>
          {fileName && <span className="text-[11px] text-slate-400">{fileName}</span>}
          <button onClick={onClose} className="ml-auto text-sm font-bold text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
            올톡페이에서 받은 <b>청구서관리목록</b> 엑셀을 올려주세요. 이미 보낸 청구서 금액과 지금 등록한 항목의 합계를
            아이별로 맞춰봅니다. <b>아무것도 저장하지 않습니다</b> — 읽고 보여주기만 합니다.
            결제중단된 줄은 다시 청구한 줄과 겹치므로 합계에서 뺍니다.
          </p>

          <label className="mb-3 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-[12px] font-semibold text-slate-500 hover:border-teal-400 hover:text-teal-700">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
                e.target.value = "";
              }}
            />
            {busy ? "읽는 중…" : "청구서관리목록 엑셀 고르기"}
          </label>

          {result && (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {tabBtn("differ", "금액 다름", counts.differ, "bg-rose-600 text-white")}
                {tabBtn("same", "금액 같음", counts.same, "bg-emerald-600 text-white")}
                {tabBtn("unknown", "명부에 없음", counts.unknown, "bg-amber-500 text-white")}
                {tabBtn("missing", "청구서 없음", counts.missing, "bg-slate-700 text-white")}
                {result.skipped > 0 && (
                  <span className="ml-auto text-[11px] text-slate-400">결제중단 {result.skipped}줄 제외</span>
                )}
              </div>

              {tab === "differ" && counts.differ === 0 && (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-6 text-center text-[13px] font-bold text-emerald-800">
                  다른 금액이 없습니다. 등록한 항목이 이미 보낸 청구서와 전부 맞습니다.
                </p>
              )}

              {tab === "missing" ? (
                <div className="rounded-lg border border-slate-200">
                  <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                    우리 표에는 금액이 있는데 청구서가 없는 아이입니다. 아직 안 보냈거나, 항목을 잘못 넣은 것입니다.
                    (항목이 아예 없는 아이는 여기 넣지 않습니다)
                  </p>
                  {result.missingBill.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[12px] last:border-0">
                      <button onClick={() => onOpenStudent?.(s.id)} className="font-semibold text-slate-800 underline decoration-dotted">
                        {s.name}
                      </button>
                      <span className="text-[11px] text-slate-400">{s.gradeLabel}</span>
                      <span className="ml-auto font-bold tabular-nums text-slate-700">{won(s.ours)}</span>
                    </div>
                  ))}
                  {result.missingBill.length === 0 && <p className="px-3 py-6 text-center text-[12px] text-slate-400">없습니다.</p>}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-[12px]">
                    <thead className="bg-slate-50 text-[11px] text-slate-500">
                      <tr>
                        <th className="px-2 py-1 text-left">학생</th>
                        <th className="px-2 py-1 text-right">청구서</th>
                        <th className="px-2 py-1 text-right">우리 계산</th>
                        <th className="px-2 py-1 text-right">차이</th>
                        <th className="px-2 py-1 text-left">청구 내용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((g) => (
                        <tr key={g.student?.id ?? g.billName} className="border-t border-slate-100 align-top">
                          <td className="px-2 py-1.5">
                            {g.student ? (
                              <button
                                onClick={() => onOpenStudent?.(g.student!.id)}
                                className="font-semibold text-slate-800 underline decoration-slate-300 decoration-dotted underline-offset-2"
                              >
                                {g.student.name}
                              </button>
                            ) : (
                              <span className="font-semibold text-amber-800">{g.billName}</span>
                            )}
                            <span className="ml-1 text-[10px] text-slate-400">
                              {g.student?.gradeLabel ?? "명부에서 못 찾음"}
                            </span>
                            {g.matchedBy === "이름" && (
                              <span className="ml-1 text-[10px] text-amber-600" title="연락처가 아니라 이름으로 붙였습니다">
                                이름으로 붙임
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-bold text-slate-800">{won(g.billed)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                            {g.student ? won(g.ours) : "—"}
                          </td>
                          <td
                            className={
                              "px-2 py-1.5 text-right tabular-nums font-bold " +
                              (g.diff === 0 ? "text-emerald-700" : g.diff > 0 ? "text-rose-700" : "text-blue-700")
                            }
                          >
                            {g.student ? (g.diff === 0 ? "같음" : (g.diff > 0 ? "+" : "") + won(g.diff)) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-[11px] text-slate-500">
                            {g.lines.map((l) => (
                              <div key={l.rowNo}>
                                {l.reason} {won(l.amount)}
                                {l.status && l.status !== "결제완료" && (
                                  <span className="ml-1 text-slate-400">{l.status}</span>
                                )}
                                {/* 이름 칸에 붙은 사연. 금액이 다른 이유가 대개 여기 적혀 있습니다. */}
                                {l.note && (
                                  <span className="ml-1 rounded bg-amber-100 px-1 font-semibold text-amber-800">{l.note}</span>
                                )}
                              </div>
                            ))}
                          </td>
                        </tr>
                      ))}
                      {rows.length > 0 || tab === "differ" ? null : (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-slate-400">
                            없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 p-3 text-[11px] text-slate-500">
          여기서는 아무것도 저장하지 않습니다. 항목 등록이 다 맞은 뒤에 <b className="mx-1">수납</b> 탭에서 입금을 넣으세요.
          <button onClick={onClose} className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-700">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
