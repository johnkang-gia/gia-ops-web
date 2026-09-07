"use client";

import { useEffect, useState } from "react";

/**
 * 교실 ↔ 행정실 주고받은 기록.
 *
 * 처리가 끝난 것은 대시보드·태블릿에서 내려갑니다. 그게 맞습니다 - 끝난 일이 계속 떠 있으면
 * 지금 할 일이 안 보입니다. 그런데 **내려간 것이 사라지면 안 됩니다.** 「그때 그 아이 다친
 * 건 어떻게 처리했더라」를 나중에 되짚을 자리가 있어야 합니다.
 *
 * 그래서 지우지 않고 여기 남깁니다. 보낸 시각 · 읽은 시각 · 처리 시각 · **누가 처리했다고
 * 했는지**까지 그대로 둡니다. 교실이 끝났다고 한 것과 행정실이 끝났다고 한 것은 다른
 * 이야기라, 나중에 둘이 어긋났을 때 어느 쪽을 확인해야 하는지 알 수 있습니다.
 */

type Row = {
  id: string;
  className: string;
  kind: string;
  studentName: string | null;
  body: string;
  urgent: boolean;
  at: string;
  readAt: string | null;
  reply: string | null;
  doneAt: string | null;
  doneBy: string | null;
};

const hhmm = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function ClassroomHistory() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/classroom/history", { cache: "no-store" }).catch(() => null);
      if (!res || !res.ok) {
        setRows([]);
        return;
      }
      const j = (await res.json()) as { rows?: Row[] };
      setRows(j.rows ?? []);
    })();
  }, []);

  if (rows === null) return <p className="py-4 text-center text-xs text-slate-400">불러오는 중…</p>;

  const shown = onlyOpen ? rows.filter((r) => !r.doneAt) : rows;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-bold text-slate-800">🗂 교실 ↔ 행정실 기록</h2>
        <span className="text-[11px] text-slate-400">최근 30일 · 처리된 것도 남습니다</span>
        <button
          type="button"
          onClick={() => setOnlyOpen((v) => !v)}
          className={
            "ml-auto rounded-lg px-2 py-1 text-[11px] font-semibold " +
            (onlyOpen ? "bg-amber-100 text-amber-800" : "border border-slate-200 text-slate-500 hover:bg-slate-50")
          }
        >
          {onlyOpen ? "아직 안 끝난 것만 보는 중" : "아직 안 끝난 것만"}
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">기록이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {shown.map((r) => (
            <div
              key={r.id}
              className={
                "flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl border px-2.5 py-2 text-xs " +
                (r.doneAt ? "border-slate-100 bg-slate-50/60" : r.urgent ? "border-rose-200 bg-rose-50/60" : "border-sky-200 bg-sky-50/50")
              }
            >
              <b className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] font-black tracking-wide text-white">{r.className}</b>
              <span className="text-[11px] font-semibold text-slate-500">
                {r.urgent ? "🔴 " : ""}
                {r.kind}
              </span>
              {r.studentName && <b className="text-slate-800">{r.studentName}</b>}
              <span className="text-slate-700">{r.body}</span>
              {r.reply && <span className="text-sky-700">↩ {r.reply}</span>}

              {/* 시각 셋을 나란히. 사이가 벌어져 있으면 그 자체가 신호입니다 -
                  보낸 지 한참 뒤에 읽혔다면 그날 무슨 일이 있었던 것입니다. */}
              <span className="ml-auto whitespace-nowrap text-[11px] text-slate-400">
                보냄 {hhmm(r.at)}
                {r.readAt ? ` · 읽음 ${hhmm(r.readAt)}` : " · 안 읽음"}
                {r.doneAt ? ` · 처리 ${hhmm(r.doneAt)}${r.doneBy ? `(${r.doneBy})` : ""}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
