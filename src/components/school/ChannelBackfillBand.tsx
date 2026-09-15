"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useToast } from "@/components/common/ToastProvider";

type Summary = { fill: number; house: number; ask: number; skip: number };
type FillRow = { id: string; studentId: string; studentName: string; channel: string; why: string };
type AskRow = { id: string; channel: string; candidates: { id: string; name: string }[]; text: string | null };

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
  /** 지금 고르고 있는 줄. 형제 중 누구인지 사람이 정해야 하는 것들입니다. */
  const [picking, setPicking] = useState<AskRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/toddle/backfill");
    const j = (await res.json().catch(() => null)) as
      | { error?: string; summary?: Summary; sample?: FillRow[]; ask?: AskRow[] }
      | null;
    // 조용히 넘기면 「채울 것이 없다」와 「못 읽었다」가 구별되지 않습니다(CLAUDE.md 5).
    if (!res.ok) {
      setError(j?.error ?? "되짚을 줄을 읽지 못했습니다.");
      return;
    }
    setError(null);
    setSummary(j?.summary ?? null);
    setSample(j?.sample ?? []);
    setAskSample(j?.ask ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/toddle/backfill", { method: "POST" });
      const j = (await res.json().catch(() => null)) as
        | { error?: string; filled?: number; housed?: number; failed?: number; stillAsk?: number }
        | null;
      if (!res.ok) {
        notify(j?.error ?? "채우지 못했습니다.", "error");
        return;
      }
      notify(
        `학생 ${j?.filled}줄 · 집 ${j?.housed}줄을 채웠습니다.` +
          (j?.failed ? ` ${j.failed}건은 실패했습니다.` : "") +
          (j?.stillAsk ? ` 형제방 출결 ${j.stillAsk}줄은 사람이 골라야 합니다.` : ""),
        j?.failed ? "error" : "success",
      );
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  /**
   * 형제 중 하나를 고릅니다.
   *
   * **고른 뒤에 목록을 다시 읽습니다.** 화면이 자기 상태를 손으로 고치면, 저장이 실패했는데도
   * 화면에서는 사라져 「됐다」로 보입니다.
   */
  async function pick(row: AskRow, studentId: string, studentName: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/toddle/backfill", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, studentId }),
      });
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        notify(j?.error ?? "정하지 못했습니다.", "error");
        return;
      }
      notify(`${studentName} 으로 정했습니다.`, "success");
      setPicking(null);
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
  if (!summary || (summary.fill === 0 && summary.house === 0 && summary.ask === 0)) return null;

  return (
    <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/60">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="text-[12px] font-bold text-indigo-900">🔗 이어 둔 방으로 지난 연락 채우기</span>
        <span className="text-[11px] text-indigo-800">
          {summary.fill > 0 && <><b>{summary.fill}줄</b>은 아이가 정해집니다. </>}
          {summary.house > 0 && <><b>{summary.house}줄</b>은 아이를 한 명 정할 필요가 없는 글이라 <b>집만</b> 붙입니다. </>}
          {summary.ask > 0 && <>출결·하원인데 형제 중 누구인지 못 가른 <b>{summary.ask}줄</b>만 사람이 봅니다.</>}
          {summary.ask === 0 && <span className="text-emerald-700">사람이 볼 줄은 없습니다.</span>}
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
            disabled={busy || summary.fill + summary.house === 0}
            onClick={() => void apply()}
            title="밤마다 저절로도 돕니다. 지금 바로 돌리고 싶을 때 누릅니다."
            className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {busy ? "채우는 중…" : `지금 돌리기 (${summary.fill + summary.house}줄)`}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-indigo-200 px-3 py-2">
          <p className="mb-1.5 text-[10px] leading-relaxed text-indigo-800">
            <b>밤마다 저절로 돕니다.</b> 사람이 확인한 방만 씁니다. 토들은 한 집에 방이 하나라 <b>형제방은 본문을
            읽어</b> 가릅니다 — 한 아이만 나오거나 한 아이만 결석·픽업으로 적혀 있으면 그 아이입니다.
            <br />
            못 갈랐을 때는 <b>글의 성격을 봅니다</b> — 「아이들 방과후 신청합니다」처럼 아이를 한 명 정할 필요가 없는
            글은 <b>집만 붙이고</b> 그 집 아이들 모두의 이력에 띄웁니다. 한 명을 찍으면 다른 아이 기록에서 그 연락이
            사라지니까요. 출결·하원처럼 <b>한 명이어야만 하는 글</b>만 사람에게 남깁니다. 방을 못 찾은 {summary.skip}줄은
            그대로 둡니다.
          </p>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-indigo-100 bg-white">
            {sample.map((f) => (
              <div key={f.id} className="border-b border-slate-50 px-2.5 py-1 text-[11px] last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="w-48 shrink-0 truncate text-slate-500">{f.channel}</span>
                  <span className="text-slate-400">→</span>
                  <span className="font-semibold text-slate-800">{f.studentName}</span>
                </div>
                {/* **왜 그 아이인지 적습니다.** 형제방은 본문을 읽어 가르므로, 근거 없이
                    이름만 뜨면 사람이 맞는지 판단할 수가 없습니다. */}
                <p className="ml-[13.5rem] text-[10px] text-slate-400">{f.why}</p>
              </div>
            ))}
            {/* **누르면 그 자리에서 고릅니다.** 목록에 띄우기만 하고 고를 데가 없으면,
                보고도 어디 가서 고쳐야 하는지 몰라 아무도 안 고칩니다. */}
            {askSample.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setPicking(a)}
                className="block w-full border-b border-slate-50 px-2.5 py-1 text-left text-[11px] last:border-b-0 hover:bg-amber-50"
              >
                <div className="flex items-center gap-2">
                  <span className="w-48 shrink-0 truncate text-slate-500">{a.channel}</span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">
                    {a.candidates.map((c) => c.name).join(" · ")} 중 누구?
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-amber-700">고르기 →</span>
                </div>
                {a.text && <p className="ml-[13.5rem] truncate text-[10px] text-slate-400">{a.text}</p>}
              </button>
            ))}
          </div>
          {summary.fill > sample.length && (
            <p className="mt-1 text-[10px] text-indigo-700">
              … 채울 줄은 앞쪽 몇 개만 보입니다. 누르면 {summary.fill}줄 전부에 반영됩니다. 고를 줄은 전부 보입니다.
            </p>
          )}
        </div>
      )}

      {/* ── 형제 중 누구인지 고르는 팝업 ────────────────────────────────────
          **원문을 통째로 보여줍니다.** 목록의 한 줄로는 앞부분만 보이는데, 형제를 가르는
          단서가 뒤에 있을 수 있습니다. 읽고 나서 고르는 것이 순서입니다. */}
      {picking &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
            onClick={() => setPicking(null)}
          >
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-4 shadow-2xl">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800">형제 중 누구인가요?</span>
                <button
                  type="button"
                  onClick={() => setPicking(null)}
                  className="ml-auto rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>
              <p className="mb-2 text-[11px] text-slate-500">{picking.channel}</p>

              <p className="mb-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700">
                {picking.text || "(본문이 없습니다. 무슨 글인지 알 수 없으면 고르지 말고 닫아 주세요.)"}
              </p>

              <div className="flex flex-wrap gap-1.5">
                {picking.candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void pick(picking, c.id, c.name)}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-[12px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              {/* **모르면 안 고르는 것이 맞습니다.** 둘 중 하나를 찍으면 오는 아이가 셔틀에서
                  빠지거나 안 오는 아이가 남고, 하원 시간의 착오는 되돌릴 수 없습니다. */}
              <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                이 글은 출결·하원에 반영되는 글이라 아이가 한 명으로 정해져야 합니다. <b>본문만으로 모르겠으면 고르지
                말고 닫으세요</b> — 잘못 고르면 오는 아이가 셔틀에서 빠집니다. 토들에서 학부모께 여쭙는 편이 낫습니다.
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
