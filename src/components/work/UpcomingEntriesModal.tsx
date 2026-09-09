"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { todayKst } from "@/lib/kst";

/**
 * **앞으로 예정된 출결을 한자리에서 보고 내립니다.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 중앙 대시보드의 「예정」에 한우영 9/16~23 이 계속 떠 있었습니다. 출결내역에서는 그 줄에
 * **닿을 수가 없었습니다** — 출결내역은 지금 인박스에 남아 있는 메시지와 짝지어진 줄만
 * 보여주는데, 원본 메시지가 이미 지나가 버린 줄은 화면 어디에도 나오지 않습니다.
 *
 * 그래서 **화면에는 보이는데 사람이 손댈 수 없는 줄**이 생겼습니다. 잘못 들어간 것을 알면서
 * 지울 방법이 없는 상태가 가장 나쁩니다 - 그 뒤로는 그 화면 전체를 안 믿게 됩니다.
 *
 * 여기는 원본 메시지와 상관없이 `attendance_entries` 를 그대로 보여줍니다. 화면에 보이는
 * 것은 언제나 손댈 수 있어야 합니다.
 *
 * ── 지우지 않고 내립니다 ─────────────────────────────────────────────
 *
 * 줄을 통째로 지우면 「왜 없어졌는지」가 사라지고, 같은 메시지를 다시 훑을 때 또 만들어집니다.
 * 그래서 상태만 「무시」로 바꿉니다 - 대시보드에서는 사라지고, 기록은 남습니다.
 */

type Row = {
  id: string;
  student_name: string;
  grade: string | null;
  class_name: string | null;
  status: string;
  date_from: string;
  date_to: string;
  source: string | null;
  raw_text: string | null;
  state: string;
};

const TONE: Record<string, string> = {
  결석: "border-rose-200 bg-rose-50 text-rose-700",
  지각: "border-amber-200 bg-amber-50 text-amber-800",
  조퇴: "border-violet-200 bg-violet-50 text-violet-700",
  픽업: "border-sky-200 bg-sky-50 text-sky-700",
};

function dayShort(k: string): string {
  const [, m, d] = k.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function UpcomingEntriesModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = todayKst();
    const { data, error: err } = await createClient()
      .from("attendance_entries")
      .select("id, student_name, grade, class_name, status, date_from, date_to, source, raw_text, state")
      .eq("state", "등록")
      // **오늘 이후에 시작하는 것 + 오늘을 품고 있는 것** 둘 다 봅니다. 대시보드에 뜨는
      // 줄이 둘 중 하나라, 한쪽만 보면 「보이는데 여기 없는」 줄이 또 생깁니다.
      .gte("date_to", today)
      .order("date_from", { ascending: true })
      .limit(200);
    if (err) {
      // 못 읽었으면 빈 목록으로 보여주지 않습니다 - 「지울 게 없다」와 「못 읽었다」가
      // 같아 보이면 사람은 다시 대시보드로 돌아가 그대로 둡니다.
      setError(`예정 목록을 읽지 못했습니다: ${err.message}`);
      setRows([]);
      return;
    }
    setError(null);
    setRows((data as Row[] | null) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function drop(r: Row) {
    if (!confirm(`${r.student_name} ${r.status} (${dayShort(r.date_from)}~${dayShort(r.date_to)}) 를 내립니다.\n대시보드에서 사라지고 기록은 남습니다.`)) return;
    setBusy(r.id);
    // **PATCH 입니다.** POST 는 「새로 넣기」 창구라 id 로 고치는 요청을 안 받습니다 -
    // 여기서 POST 로 보내는 바람에 [내리기]가 늘 실패했습니다.
    const res = await fetch("/api/attendance/entries", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, state: "무시" }),
    });
    setBusy(null);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      notify(b.error ?? "내리지 못했습니다.", "error");
      return;
    }
    setRows((prev) => (prev ?? []).filter((x) => x.id !== r.id));
    notify(`${r.student_name} ${r.status} 을(를) 내렸습니다.`, "success");
  }

  const today = todayKst();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center gap-2">
          <b className="text-sm">📅 예정된 출결 정리</b>
          <span className="text-[11px] text-slate-500">대시보드에 떠 있는 줄을 여기서 내립니다</span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            닫기
          </button>
        </div>

        {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">⚠️ {error}</p>}

        {rows === null ? (
          <p className="py-8 text-center text-xs text-slate-400">읽는 중…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">앞으로 예정된 출결이 없습니다.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((r) => {
              const ongoing = r.date_from <= today && today <= r.date_to;
              return (
                <div key={r.id} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                  <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + (TONE[r.status] ?? "bg-slate-100 text-slate-600")}>
                    {r.status}
                  </span>
                  <b className="text-[12px]">{r.student_name}</b>
                  {r.class_name && <span className="text-[10px] text-slate-400">{r.class_name}</span>}
                  <span className="tabular-nums text-[11px] font-semibold text-slate-600">
                    {dayShort(r.date_from)}
                    {r.date_from !== r.date_to ? `~${dayShort(r.date_to)}` : ""}
                  </span>
                  {/* 지금 진행 중인 것과 앞으로 올 것을 갈라 적습니다. 내릴 때 판단이 다릅니다. */}
                  <span className={"rounded px-1 text-[9px] font-bold " + (ongoing ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                    {ongoing ? "진행 중" : "예정"}
                  </span>
                  {r.source && <span className="text-[9px] text-slate-400">{r.source}</span>}
                  {r.raw_text && (
                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400" title={r.raw_text}>
                      {r.raw_text}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy === r.id}
                    onClick={() => void drop(r)}
                    className="ml-auto shrink-0 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-600 hover:border-rose-400 hover:text-rose-700 disabled:opacity-40"
                  >
                    {busy === r.id ? "…" : "내리기"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-2 text-[10px] text-slate-400">
          내리면 대시보드·체크표에서 사라지고 기록은 남습니다. 통째로 지우지 않는 이유는, 지우면 같은 메시지를 다시 훑을 때 또
          만들어지기 때문입니다.
        </p>
      </div>
    </div>
  );
}
