"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/common/ToastProvider";

type Summary = { fill: number; ask: number; skip: number };
type FillRow = { id: string; studentId: string; studentName: string; channel: string };
type AskRow = { id: string; channel: string; candidates: { id: string; name: string }[] };

/**
 * **이어 둔 방으로 지난 연락의 학생을 되짚어 채웁니다.**
 *
 * 받는 쪽이 방 연결을 읽어놓고 이름으로 되돌아가는 바람에, 사람이 확인한 방에서 온
 * 연락인데도 학생이 안 정해진 줄이 쌓였습니다. 그 줄은 출결에도, 두 창구 대조에도 못
 * 들어갑니다. 받는 쪽은 고쳤지만 **이미 들어와 있는 줄은 저절로 안 고쳐집니다.**
 *
 * 숫자를 먼저 보여주고 누르게 합니다 - 숫자 없는 단추는 아무도 못 누릅니다. 눌러도
 * 되는지 판단할 재료가 없으니까요.
 */
export default function ChannelBackfillBand() {
  const notify = useToast();
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sample, setSample] = useState<FillRow[]>([]);
  const [askSample, setAskSample] = useState<AskRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/toddle/backfill");
    const j = (await res.json().catch(() => null)) as
      | { error?: string; summary?: Summary; sample?: FillRow[]; askSample?: AskRow[] }
      | null;
    // 조용히 넘기면 「채울 것이 없다」와 「못 읽었다」가 구별되지 않습니다(CLAUDE.md 5).
    if (!res.ok) {
      setError(j?.error ?? "되짚을 줄을 읽지 못했습니다.");
      return;
    }
    setError(null);
    setSummary(j?.summary ?? null);
    setSample(j?.sample ?? []);
    setAskSample(j?.askSample ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/toddle/backfill", { method: "POST" });
      const j = (await res.json().catch(() => null)) as
        | { error?: string; filled?: number; tried?: number; failed?: number; stillAsk?: number }
        | null;
      if (!res.ok) {
        notify(j?.error ?? "채우지 못했습니다.", "error");
        return;
      }
      notify(
        `${j?.filled}줄에 학생을 채웠습니다.` +
          (j?.failed ? ` ${j.failed}건은 실패했습니다.` : "") +
          (j?.stillAsk ? ` 형제방 ${j.stillAsk}줄은 사람이 골라야 합니다.` : ""),
        j?.failed ? "error" : "success",
      );
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
        되짚을 줄을 읽지 못했습니다: {error}
      </div>
    );
  }
  // 채울 것도 물어볼 것도 없으면 띠 자체를 안 띄웁니다. 늘 떠 있는 0은 아무도 안 읽습니다.
  if (!summary || (summary.fill === 0 && summary.ask === 0)) return null;

  return (
    <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/60">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-[12px] font-bold text-indigo-900">🔗 이어 둔 방으로 지난 연락 채우기</span>
        <span className="text-[11px] text-indigo-800">
          학생이 안 정해진 연락 중 <b>{summary.fill}줄</b>은 이 방의 아이가 한 명뿐이라 바로 채울 수 있습니다.
          {summary.ask > 0 && <> 형제방 <b>{summary.ask}줄</b>은 사람이 골라야 합니다.</>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-indigo-300 px-2.5 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
          >
            {open ? "접기" : "미리 보기"}
          </button>
          <button
            type="button"
            disabled={busy || summary.fill === 0}
            onClick={() => void apply()}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "채우는 중…" : `${summary.fill}줄 채우기`}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-indigo-200 px-3 py-2">
          <p className="mb-1.5 text-[10px] leading-relaxed text-indigo-800">
            사람이 확인한 방만 씁니다. <b>형제방은 손대지 않습니다</b> — 둘 중 하나를 기계가 찍으면 오는 아이가 셔틀에서
            빠집니다. 방을 못 찾은 {summary.skip}줄도 그대로 둡니다.
          </p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-indigo-100 bg-white">
            {sample.map((f) => (
              <div key={f.id} className="flex items-center gap-2 border-b border-slate-50 px-2.5 py-1 text-[11px] last:border-b-0">
                <span className="w-48 shrink-0 truncate text-slate-500">{f.channel}</span>
                <span className="text-slate-400">→</span>
                <span className="font-semibold text-slate-800">{f.studentName}</span>
              </div>
            ))}
            {askSample.map((a) => (
              <div key={a.id} className="flex items-center gap-2 border-b border-slate-50 px-2.5 py-1 text-[11px] last:border-b-0">
                <span className="w-48 shrink-0 truncate text-slate-500">{a.channel}</span>
                <span className="text-slate-400">→</span>
                <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">
                  {a.candidates.map((c) => c.name).join(" · ")} 중 누구?
                </span>
              </div>
            ))}
          </div>
          {(summary.fill > sample.length || summary.ask > askSample.length) && (
            <p className="mt-1 text-[10px] text-indigo-700">
              … 위는 앞쪽 몇 줄입니다. 누르면 채울 수 있는 {summary.fill}줄 전부에 반영됩니다.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
