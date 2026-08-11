"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// 요청: "차량 도착출발과 안내보드간에 연동이 너무 느리고" - 폴링 주기를 5초에서 3초로 줄여
// 다른 교직원 화면·안내보드에 상태가 더 빨리 반영되도록 했습니다.
const POLL_MS = 3000;

// 요청: "모바일에서 호차 꾹누르면 기사님께 전화하기 메뉴가 떴으면 좋겠어" - 이 시간(ms) 이상
// 눌러야 "꾹 누름"으로 보고 전화 메뉴를 띄웁니다. 이보다 짧으면 원래대로 도착·출발 상태가
// 바뀝니다(누르고 있는 동안 상태가 바뀌면 안 되니, 길게 누른 경우는 클릭 동작을 건너뜁니다).
const LONG_PRESS_MS = 550;

type ArrivalRoute = {
  routeId: string;
  routeNo: string;
  name: string | null;
  driverName: string | null;
  driverPhone: string | null;
  roster: string[];
  events: { event: string; created_at: string }[];
};

type ArrivalData = { label: string; term: string; routes: ArrivalRoute[] };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

// 교직원이 로그인 없이 링크 하나로 접속해, 노선별로 상태 버튼 하나만 눌러서 "미도착 → 도착함 →
// 출발함" 순서로 넘기는 단독 화면입니다(요청: "교직원이 모바일로 도착한 차량 누를 수 있는 단독
// 링크"). 도착함으로 바뀌면 안내보드에 그 차량과 명단이 뜨고, 출발함이 되면 안내보드에서
// 출발하는 애니메이션과 함께 사라집니다.
//
// 요청: "박스 다 무너지고 아이들 이름 너무 쭉 나열식이야... 차 노선 한줄당 4대씩 보이게 하고
// 아래로 아주 작게 학생 이름 뱃지 해서 제대로 보이게" - 노선 개수와 상관없이 한 줄에 항상 4대씩
// 고정 배치하고, 화면은 아래로 스크롤합니다. 각 카드 아래에 그 차를 타는 학생 이름을 아주 작은
// 뱃지로 표시합니다.
//
// 요청: "지금은 미도착버튼을 누르면 오렌지색으로 도착함으로 버튼색과 글자가 바뀌고, 한번더
// 누르면 출발함이 되어서" - 노선당 버튼 하나가 상태(미도착/도착함/출발함)를 겸해서, 누를 때마다
// 색과 글자가 바뀝니다. 나중에 학생별 개별 탑승 체크가 생기기 전까지는 이 버튼이 도착·출발을
// 알리는 유일한 조작입니다.
//
// 요청: "출발함 상태에서는 다시 못돌려, 매일매일 체크하는거니까, 전체 리셋 할 수 있고, 출발함
// 상태에서 한번 더 누르면 다시 원래상태로 돌아올 수 있도록" - 출발함에서 한 번 더 누르면
// 미도착으로 되돌아가고(미도착 → 도착함 → 출발함 → 미도착 순환), 위쪽 "전체 리셋" 버튼으로
// 오늘 체크한 모든 차량을 한 번에 미도착 상태로 되돌릴 수 있습니다.
export default function ArrivalCheckClient({ token }: { token: string }) {
  const [data, setData] = useState<ArrivalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyRoute, setBusyRoute] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [callSheet, setCallSheet] = useState<{ routeNo: string; driverName: string | null; driverPhone: string | null } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);

  function startLongPress(r: ArrivalRoute) {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      suppressClickRef.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
      setCallSheet({ routeNo: r.routeNo, driverName: r.driverName, driverPhone: r.driverPhone });
    }, LONG_PRESS_MS);
  }
  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

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

  async function act(routeId: string, action: "arrive" | "depart" | "reset") {
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
            routes: prev.routes.map((r) => {
              if (r.routeId !== routeId) return r;
              if (action === "reset") {
                return { ...r, events: r.events.filter((e) => e.event !== "현장도착" && e.event !== "출발") };
              }
              return {
                ...r,
                events: [...r.events, { event: action === "arrive" ? "현장도착" : "출발", created_at: new Date().toISOString() }],
              };
            }),
          };
        });
      }
    } finally {
      setBusyRoute(null);
    }
  }

  // 요청: "매일매일 체크하는거니까, 전체 리셋 할 수 있고" - 오늘 체크한 모든 차량의 도착·출발
  // 기록을 한 번에 지워서 전부 미도착 상태로 되돌립니다.
  async function resetAll() {
    if (!window.confirm("오늘 체크한 모든 차량의 도착·출발 상태를 초기화할까요?")) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/shuttle/arrival/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),
      });
      if (res.ok) {
        setData((prev) =>
          prev
            ? { ...prev, routes: prev.routes.map((r) => ({ ...r, events: r.events.filter((e) => e.event !== "현장도착" && e.event !== "출발") })) }
            : prev
        );
      }
    } finally {
      setResetting(false);
    }
  }

  const routes = useMemo(() => {
    return [...(data?.routes ?? [])].sort((a, b) => natCompare(a.routeNo, b.routeNo));
  }, [data]);

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-2 pb-10">
      <div className="mb-2 flex items-center justify-between gap-2 pt-1">
        <div className="flex-1 text-center">
          <p className="text-xs font-bold text-slate-500">{data?.label ?? "도착체크"}</p>
          <h1 className="text-base font-black text-slate-800">🚌 차량 도착·출발 체크</h1>
          <p className="mt-0.5 text-[10px] text-slate-400">버튼을 누르면 미도착 → 도착함 → 출발함 → 미도착 순서로 바뀝니다</p>
        </div>
        <button
          onClick={resetAll}
          disabled={resetting || routes.length === 0}
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-500 active:scale-95 disabled:opacity-40"
        >
          ⟲ 전체 리셋
        </button>
      </div>

      {routes.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">노선이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {routes.map((r) => {
            const hasArrived = r.events.some((e) => e.event === "현장도착");
            const hasDeparted = r.events.some((e) => e.event === "출발");
            const status: "waiting" | "arrived" | "departed" = hasDeparted ? "departed" : hasArrived ? "arrived" : "waiting";
            const isBusy = busyRoute === r.routeId;
            return (
              <div
                key={r.routeId}
                className={
                  "flex min-w-0 flex-col overflow-hidden rounded-lg border-2 " +
                  (status === "arrived"
                    ? "border-orange-400"
                    : status === "departed"
                      ? "border-slate-200"
                      : "border-blue-200")
                }
              >
                <button
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    act(r.routeId, status === "waiting" ? "arrive" : status === "arrived" ? "depart" : "reset");
                  }}
                  onTouchStart={() => startLongPress(r)}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={isBusy}
                  className={
                    "flex w-full flex-col items-center gap-0.5 px-0.5 py-1.5 active:scale-95 disabled:opacity-70 " +
                    (status === "arrived"
                      ? "bg-orange-500 text-white"
                      : status === "departed"
                        ? "bg-slate-200 text-slate-500"
                        : "bg-white text-blue-700")
                  }
                >
                  <span className="text-base font-black leading-tight">{r.routeNo}호</span>
                  {r.name && <span className="max-w-full truncate text-[8px] font-semibold leading-tight opacity-80">{r.name}</span>}
                  <span className="text-[9px] font-bold leading-tight">
                    {status === "waiting" ? "미도착" : status === "arrived" ? "도착함" : "출발함"}
                  </span>
                </button>
                {r.roster.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 bg-slate-50 p-1">
                    {r.roster.map((name, i) => (
                      <span
                        key={i}
                        className="rounded border border-red-300 bg-red-50 px-1 py-0.5 text-[8px] font-semibold leading-none text-red-600"
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

      {callSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setCallSheet(null)}>
          <div className="w-full max-w-xs rounded-t-2xl bg-white p-4 pb-6 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-center text-sm font-bold text-slate-800">{callSheet.routeNo}호 {callSheet.driverName ?? ""} 기사님</p>
            {callSheet.driverPhone ? (
              <a
                href={`tel:${callSheet.driverPhone}`}
                className="block rounded-xl bg-emerald-500 px-3 py-3 text-center text-sm font-bold text-white active:scale-95"
              >
                📞 {callSheet.driverPhone} 전화 걸기
              </a>
            ) : (
              <p className="rounded-xl bg-slate-100 px-3 py-3 text-center text-xs font-semibold text-slate-400">
                등록된 기사님 연락처가 없습니다.
              </p>
            )}
            <button
              type="button"
              onClick={() => setCallSheet(null)}
              className="mt-2 w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-400"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
