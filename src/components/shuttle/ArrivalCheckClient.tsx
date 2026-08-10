"use client";

import { useEffect, useMemo, useState } from "react";

const POLL_MS = 5000;

type ArrivalRoute = {
  routeId: string;
  routeNo: string;
  name: string | null;
  roster: string[];
  events: { event: string; created_at: string }[];
};

type ArrivalData = { label: string; term: string; routes: ArrivalRoute[] };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 교직원이 로그인 없이 링크 하나로 접속해, 노선별로 "도착" → "출발(다 태움)" 두 버튼만 누르는
// 단독 화면입니다(요청: "교직원이 모바일로 도착한 차량 누를 수 있는 단독 링크" - 여름캠프처럼
// GPS 위치 전송·학생별 개별 탑승 체크 없이 빠르게 도착·출발만 알리면 되는 경우). 도착을 누르면
// 안내보드에 그 차량과 명단이 뜨고, 출발을 누르면 안내보드에서 사라집니다.
export default function ArrivalCheckClient({ token }: { token: string }) {
  const [data, setData] = useState<ArrivalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyRoute, setBusyRoute] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/shuttle/arrival/${token}`);
        if (!res.ok) {
          if (!cancelled) setErrorMsg("유효하지 않거나 종료된 링크입니다.");
          return;
        }
        const json = (await res.json()) as ArrivalData;
        if (cancelled) return;
        setErrorMsg(null);
        setData(json);
      } catch {
        if (!cancelled) setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  async function act(routeId: string, action: "arrive" | "depart") {
    setBusyRoute(routeId);
    try {
      const res = await fetch(`/api/shuttle/arrival/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, action }),
      });
      if (res.ok) {
        // 폴링 주기를 기다리지 않고 바로 화면에 반영되도록, 로컬 상태를 낙관적으로 갱신합니다.
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            routes: prev.routes.map((r) =>
              r.routeId === routeId
                ? {
                    ...r,
                    events: [
                      ...r.events,
                      { event: action === "arrive" ? "현장도착" : "출발", created_at: new Date().toISOString() },
                    ],
                  }
                : r
            ),
          };
        });
      }
    } finally {
      setBusyRoute(null);
    }
  }

  const { waiting, arrived, departed } = useMemo(() => {
    const routes = data?.routes ?? [];
    const w: ArrivalRoute[] = [];
    const a: ArrivalRoute[] = [];
    const d: ArrivalRoute[] = [];
    for (const r of routes) {
      const hasArrived = r.events.some((e) => e.event === "현장도착");
      const hasDeparted = r.events.some((e) => e.event === "출발");
      if (hasDeparted) d.push(r);
      else if (hasArrived) a.push(r);
      else w.push(r);
    }
    const sortFn = (x: ArrivalRoute, y: ArrivalRoute) => natCompare(x.routeNo, y.routeNo);
    return { waiting: w.sort(sortFn), arrived: a.sort(sortFn), departed: d.sort(sortFn) };
  }, [data]);

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-slate-50 p-3 pb-10">
      <div className="mb-3 pt-2 text-center">
        <p className="text-sm font-bold text-slate-500">{data?.label ?? "도착체크"}</p>
        <h1 className="text-lg font-black text-slate-800">🚌 차량 도착·출발 체크</h1>
      </div>

      {arrived.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-bold text-amber-600">🟠 도착함 · 탑승 대기중</p>
          <div className="flex flex-col gap-2">
            {arrived.map((r) => (
              <div key={r.routeId} className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xl font-black text-amber-700">
                    {r.routeNo}호 {r.name ?? ""}
                  </p>
                  <button
                    onClick={() => act(r.routeId, "depart")}
                    disabled={busyRoute === r.routeId}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white active:scale-95 disabled:opacity-40"
                  >
                    🏁 출발 (다 태움)
                  </button>
                </div>
                {r.roster.length > 0 && (
                  <p className="text-xs text-amber-700">
                    탈 아이들: {r.roster.join(", ")} ({r.roster.length}명)
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-bold text-blue-600">🔵 미도착 · 차가 보이면 눌러주세요</p>
        {waiting.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">남은 미도착 차량이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {waiting.map((r) => (
              <button
                key={r.routeId}
                onClick={() => act(r.routeId, "arrive")}
                disabled={busyRoute === r.routeId}
                className="rounded-xl border-2 border-blue-200 bg-white px-2 py-4 text-center font-black text-blue-700 shadow-sm active:scale-95 disabled:opacity-40"
              >
                <div className="text-2xl">{r.routeNo}호</div>
                <div className="mt-0.5 truncate text-[11px] font-semibold text-blue-500">{r.name ?? ""}</div>
                <div className="mt-1 text-[11px] font-bold text-blue-600">🚌 도착 체크</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {departed.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-bold text-slate-400">⚪ 출발 완료 (오늘)</p>
          <div className="flex flex-wrap gap-1.5">
            {departed.map((r) => (
              <span key={r.routeId} className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500">
                {r.routeNo}호 출발함
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
