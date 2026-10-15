"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 「오늘 숫자를 기준선으로 남기기」 — 인증 증거 화면 위에만 뜨고 인쇄에는 안 나옵니다.
 *
 * 왜 사람이 누르게 하는가: 자동으로 매일 남기면 줄이 수백 개가 되고, 그중 어느 줄이 «전수 점검을 마친 날»인지 아무도
 * 모릅니다. 비교는 아무 두 날이 아니라 **의미 있는 두 시점** 사이에서 해야 하므로, 그 시점을 아는 사람이 누릅니다.
 * 메모 칸이 있는 이유도 그것입니다.
 */
export default function SnapshotButton() {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function take() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/accreditation/library-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; snapshot?: { taken_on: string; titles: number; copies: number } };
      if (!res.ok || json.error) {
        setMsg(json.error ?? "기록하지 못했습니다.");
      } else {
        setMsg(
          `${json.snapshot?.taken_on} 기준으로 남겼습니다 — ${json.snapshot?.titles.toLocaleString()}종 · ${json.snapshot?.copies.toLocaleString()}권`
        );
        router.refresh();
      }
    } catch {
      setMsg("기록하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="no-print inline-flex items-center gap-1.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="메모(예: 전수 장서 점검 직후)"
        className="w-52 rounded border border-slate-300 px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => void take()}
        disabled={busy}
        className="rounded bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? "남기는 중…" : "오늘 숫자를 기준선으로 남기기"}
      </button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </span>
  );
}
