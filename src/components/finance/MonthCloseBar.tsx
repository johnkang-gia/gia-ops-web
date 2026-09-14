"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";

export type MonthClose = {
  month: string;
  closed_at: string;
  closed_by: string;
  note: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
  reopen_reason: string | null;
};

/**
 * **그 달을 닫고 여는 단추.**
 *
 * 닫으면 그 달의 청구서·입금을 고칠 수 없습니다(데이터베이스가 막습니다). 지난 달 숫자를
 * 오늘 고치면 이미 나간 보고서와 달라지는데, 화면은 새 숫자를 아무 표시 없이 보여주기
 * 때문입니다.
 *
 * **여는 길을 막지 않습니다.** 막으면 사람은 트리거를 끄거나 DB 를 직접 만지고, 그건 아무
 * 기록도 안 남습니다. 대신 누가 왜 열었는지를 남기고 화면에 표시합니다.
 */
export default function MonthCloseBar({ month, state }: { month: string; state: MonthClose | null }) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const closed = !!state && !state.reopened_at;
  const reopened = !!state?.reopened_at;

  async function run(action: "close" | "reopen") {
    let reason = "";
    if (action === "reopen") {
      const typed = window.prompt(`${month} 을(를) 다시 엽니다. 왜 여나요?\n(예: 환불이 늦게 결정됨 / 금액 정정)`, "");
      if (typed === null) return;
      reason = typed.trim();
      if (!reason) {
        notify("이유를 적어야 열 수 있습니다.", "error");
        return;
      }
    } else if (
      !(await confirmAction(
        `${month} 을(를) 마감합니다.\n\n그 달의 청구서와 입금은 고칠 수 없게 됩니다. 정말 고쳐야 하면 다시 열 수 있고, 연 기록이 남습니다.`,
      ))
    ) {
      return;
    }

    setBusy(true);
    const res = await fetch("/api/finance/month-close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, action, reason }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    // 조용히 넘기면 닫힌 줄 알고 보고서를 냅니다.
    if (!res.ok) {
      notify(json?.error ?? "바꾸지 못했습니다.", "error");
      return;
    }
    notify(action === "close" ? `${month} 을(를) 마감했습니다.` : `${month} 을(를) 다시 열었습니다.`, "success");
    router.refresh();
  }

  return (
    <span className="flex items-center gap-1">
      {closed ? (
        <>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-white" title={`${state?.closed_by} · ${state?.closed_at?.slice(0, 10)}`}>
            🔒 마감됨
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("reopen")}
            className="rounded px-1 text-[9px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:text-slate-300"
          >
            다시 열기
          </button>
        </>
      ) : (
        <>
          {/* 다시 연 달은 **연 사실이 보여야** 합니다. 한 번도 안 닫은 달과 같아 보이면,
              보고서를 낸 뒤에 숫자가 바뀐 달인지 알 수 없습니다. */}
          {reopened && (
            <span
              className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800"
              title={`${state?.reopened_by} · ${state?.reopen_reason ?? ""}`}
            >
              다시 열림
            </span>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("close")}
            className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-slate-400 hover:bg-slate-800 hover:text-white disabled:text-slate-300"
            title="닫으면 이 달의 청구서·입금을 고칠 수 없습니다"
          >
            🔓 마감하기
          </button>
        </>
      )}
    </span>
  );
}
