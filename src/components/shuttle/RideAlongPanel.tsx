"use client";

import { useState } from "react";
import { useToast } from "@/components/common/ToastProvider";

/**
 * 오늘만 같이 타는 아이.
 *
 * "서이 셔틀에 하임이두 같이 보내주세요" 같은 연락에서 자동으로 읽어낸 것입니다.
 * 정식 배정이 아니라 **오늘 하루짜리**라, 표 안에 섞어 넣지 않고 위에 따로 세웁니다 -
 * 기사님·동승선생님이 "평소 명단에 없는 아이가 오늘 탄다"는 것을 알아야 하기 때문입니다.
 */
export type RideAlongRow = {
  id: string;
  studentId: string | null;
  studentName: string | null;
  studentSurface: string | null;
  hostName: string | null;
  hostSurface: string | null;
  routeId: string | null;
  routeNo: string | null;
  status: "확인대기" | "확정" | "취소";
  note: string | null;
  rawText: string | null;
  /** 확인대기일 때 고를 수 있는 학생들. 이름이 여럿에 걸렸다는 뜻입니다. */
  candidates: { id: string; name: string; label: string }[];
};

export default function RideAlongPanel({
  rows,
  routes,
}: {
  rows: RideAlongRow[];
  routes: { id: string; routeNo: string }[];
}) {
  const notify = useToast();
  const [list, setList] = useState(rows);
  const [busy, setBusy] = useState<string | null>(null);

  const active = list.filter((r) => r.status !== "취소");
  if (active.length === 0) return null;

  const confirmed = active.filter((r) => r.status === "확정");
  const pending = active.filter((r) => r.status === "확인대기");

  async function call(body: Record<string, unknown>, id: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/shuttle/ride-along", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      // 실패를 조용히 넘기면 태우기로 한 아이가 명단에 없는 채로 차가 떠납니다.
      if (!res.ok) {
        notify(out.error ?? "저장하지 못했습니다.", "error");
        return null;
      }
      return out;
    } finally {
      setBusy(null);
    }
  }

  async function resolve(row: RideAlongRow, studentId: string, routeId?: string) {
    const out = await call({ action: "resolve", id: row.id, studentId, routeId }, row.id);
    if (!out) return;
    const picked = row.candidates.find((c) => c.id === studentId);
    setList((p) =>
      p.map((r) =>
        r.id === row.id
          ? { ...r, status: "확정", studentId, studentName: picked?.name ?? r.studentName, routeId: routeId ?? r.routeId }
          : r,
      ),
    );
    notify(`${picked?.name ?? "학생"}을(를) 오늘 명단에 올렸습니다.`, "success");
  }

  async function cancel(row: RideAlongRow) {
    const out = await call({ action: "cancel", id: row.id }, row.id);
    if (!out) return;
    setList((p) => p.map((r) => (r.id === row.id ? { ...r, status: "취소" } : r)));
    notify("오늘 동승을 취소했습니다.", "success");
  }

  return (
    <div className="mb-3 rounded-xl border-2 border-amber-300 bg-amber-50/70 p-2.5 print:hidden">
      <p className="mb-1.5 text-[12px] font-black text-amber-900">
        🚌 오늘만 같이 타는 아이 {confirmed.length}명
        {pending.length > 0 && <span className="ml-1.5 text-rose-700">· 확인 필요 {pending.length}건</span>}
      </p>

      {confirmed.map((r) => (
        <div key={r.id} className="mb-1 flex flex-wrap items-center gap-1.5 rounded-lg bg-white/80 px-2 py-1.5 text-[12px]">
          <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-black text-amber-900">오늘만</span>
          <b className="text-slate-800">{r.studentName ?? r.studentSurface}</b>
          <span className="text-slate-500">
            → {r.routeNo ? `${r.routeNo}호` : "차량 미정"}
            {r.hostName ? ` (${r.hostName} 차)` : ""}
          </span>
          {r.rawText && (
            <span className="min-w-0 flex-1 overflow-hidden text-[11px] text-slate-400 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]">
              {r.rawText}
            </span>
          )}
          <button
            onClick={() => void cancel(r)}
            disabled={busy === r.id}
            className="ml-auto shrink-0 text-[11px] font-semibold text-slate-400 hover:text-rose-600"
            title="오늘 동승 취소"
          >
            취소
          </button>
        </div>
      ))}

      {pending.map((r) => (
        <div key={r.id} className="mb-1 rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-[12px]">
          <p className="font-bold text-rose-800">
            &ldquo;{r.hostSurface} 차에 {r.studentSurface} 같이&rdquo; 로 읽었는데, 누구인지 가리지 못했습니다.
          </p>
          {r.rawText && <p className="mt-0.5 text-[11px] text-slate-500">{r.rawText}</p>}
          {r.note && <p className="mt-0.5 text-[11px] text-slate-400">{r.note}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {r.candidates.length === 0 ? (
              <span className="text-[11px] text-slate-400">명부에서 후보를 찾지 못했습니다 — 직접 확인해주세요.</span>
            ) : (
              r.candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void resolve(r, c.id, r.routeId ?? undefined)}
                  disabled={busy === r.id}
                  className="rounded-full bg-teal-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-teal-700 disabled:opacity-40"
                >
                  {c.label}
                </button>
              ))
            )}
            {/* 차량이 안 정해진 경우 - 태우는 아이의 배정을 못 찾았을 때입니다. */}
            {!r.routeId && r.candidates.length > 0 && (
              <select
                onChange={(e) => {
                  const routeId = e.target.value;
                  if (!routeId) return;
                  setList((p) => p.map((x) => (x.id === r.id ? { ...x, routeId } : x)));
                }}
                defaultValue=""
                className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
              >
                <option value="">차량 고르기</option>
                {routes.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.routeNo}호
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => void cancel(r)}
              disabled={busy === r.id}
              className="ml-auto text-[11px] font-semibold text-slate-400 hover:text-rose-600"
            >
              아님 · 취소
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
