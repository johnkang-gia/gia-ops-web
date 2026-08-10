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
//
// 요청: "세줄정도로 해서 한눈에 모든 차량을 체크할 수 있게... 모바일 환경을 최대한 이용해서
// 양쪽으로 반공간이 없도록 자동으로 채우고" - 미도착/도착함/출발함을 따로 나눈 목록 대신, 모든
// 노선을 한 화면 그리드에 함께 놓고 상태별로 테두리 색만 다르게 표시합니다. 그리드 열 수는
// 노선 개수를 3으로 나눠 자동 계산해서 화면 너비를 가득 채웁니다(약 3줄).
//
// 요청: "타는 아이들도 차량 아래에 표시되었으면 좋겠어... 이름은 작은 뱃지로 관리되고... 안
// 탔을때는 빨간색으로, 동승선생님이 탑승을 누르면 초록으로... 지금은 동승선생님 편에 기능이
// 없으니 그냥 전부 이름뱃지만 보이도록" - 학생별 개별 탑승 체크 기능은 아직 이 화면에 없어서,
// 모든 학생 이름을 "미탑승(빨간색)" 뱃지로만 보여주는 자리표시자입니다. 나중에 동승선생님이
// 탑승 버튼을 눌러 초록색으로 바뀌는 기능을 이 뱃지 위에 얹을 예정입니다.
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

  const routes = useMemo(() => {
    return [...(data?.routes ?? [])].sort((a, b) => natCompare(a.routeNo, b.routeNo));
  }, [data]);

  // 요청: "세줄정도로 해서 한눈에 모든 차량을 체크할 수 있게" - 노선 개수를 3으로 나눠 열
  // 수를 정하고, 그 열 수만큼 그리드가 화면 너비를 가득 채웁니다(auto-fill이 아니라 정확히
  // N등분이라 양쪽에 남는 공간이 생기지 않습니다).
  const cols = Math.max(1, Math.ceil(routes.length / 3));

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-2 pb-8">
      <div className="mb-2 pt-1 text-center">
        <p className="text-xs font-bold text-slate-500">{data?.label ?? "도착체크"}</p>
        <h1 className="text-base font-black text-slate-800">🚌 차량 도착·출발 체크</h1>
      </div>

      {routes.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">노선이 없습니다.</p>
      ) : (
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {routes.map((r) => {
            const hasArrived = r.events.some((e) => e.event === "현장도착");
            const hasDeparted = r.events.some((e) => e.event === "출발");
            const status: "waiting" | "arrived" | "departed" = hasDeparted ? "departed" : hasArrived ? "arrived" : "waiting";
            const isBusy = busyRoute === r.routeId;
            return (
              <div
                key={r.routeId}
                className={
                  "flex min-w-0 flex-col rounded-lg border-2 p-1.5 " +
                  (status === "arrived"
                    ? "border-amber-300 bg-amber-50"
                    : status === "departed"
                      ? "border-slate-200 bg-slate-100"
                      : "border-blue-200 bg-white")
                }
              >
                <div className="mb-1 flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p
                      className={
                        "truncate text-sm font-black leading-tight " +
                        (status === "arrived" ? "text-amber-700" : status === "departed" ? "text-slate-400" : "text-blue-700")
                      }
                    >
                      {r.routeNo}호
                    </p>
                    <p className="truncate text-[9px] font-semibold text-slate-400">{r.name ?? ""}</p>
                  </div>
                  {status === "waiting" && (
                    <button
                      onClick={() => act(r.routeId, "arrive")}
                      disabled={isBusy}
                      className="shrink-0 rounded-md bg-blue-600 px-1.5 py-1 text-[10px] font-bold text-white active:scale-95 disabled:opacity-40"
                    >
                      도착
                    </button>
                  )}
                  {status === "arrived" && (
                    <button
                      onClick={() => act(r.routeId, "depart")}
                      disabled={isBusy}
                      className="shrink-0 rounded-md bg-emerald-600 px-1.5 py-1 text-[10px] font-bold text-white active:scale-95 disabled:opacity-40"
                    >
                      출발
                    </button>
                  )}
                  {status === "departed" && <span className="shrink-0 text-[10px] font-bold text-slate-400">완료</span>}
                </div>
                {r.roster.length > 0 && (
                  <div className="flex flex-wrap gap-0.5">
                    {r.roster.map((name, i) => (
                      <span
                        key={i}
                        className="rounded border border-red-300 bg-red-50 px-1 py-0.5 text-[9px] font-semibold leading-none text-red-600"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
