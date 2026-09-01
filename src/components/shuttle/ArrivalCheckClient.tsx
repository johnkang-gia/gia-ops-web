"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddToHomeScreenBanner from "./AddToHomeScreenBanner";
import { pollDelay } from "@/lib/useSmartPoll";

// 요청: "차량 도착출발과 안내보드간에 연동이 너무 느리고" - 폴링 주기를 5초에서 3초로 줄여
// 다른 교직원 화면·안내보드에 상태가 더 빨리 반영되도록 했습니다.
const POLL_MS = 3000;
// 하원 시간대가 아닐 때(새벽·주말 등) 폴링 간격 - 화면을 종일 켜둬도 호출이 적게 나갑니다.
// 하원 시간대가 아닐 때. 담당자 확인: "하원에 관한 대시보드나 도착체크는 하원시간에만
// 쓰고 있어" - 그 시간 밖에는 화면 앞에 아무도 없으므로 사실상 멈춰도 됩니다. 다만 완전히
// 끊으면 다음 하원 때 스스로 깨어나지 못해서(벽/모바일 화면이라 아무도 새로고침 안 함),
// 15분에 한 번만 남겨둡니다. pollDelay가 하원 시작 시각을 넘겨 자지 않게 잡아줍니다.
const IDLE_POLL_MS = 15 * 60_000;

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
  vehicleNo: string | null;
  roster: { assignmentId: string; studentName: string; status: string }[];
  events: { event: string; created_at: string; createdBy: string | null }[];
  // 기사님 휴대폰이 마지막으로 위치를 보내온 시각(GPS 살아있는지 확인용). 미설정이면 null.
  gpsLastSeen?: string | null;
  hasDevice?: boolean;
};

// GPS 상태를 화면 표시용으로 정리합니다. 마지막 위치 신호가 얼마나 최근인지로 "운행중(살아있음)/
// 끊김/미설정"을 가릅니다. 이 화면은 3초마다 새로 그려지므로 별도 타이머 없이도 갱신됩니다.
function gpsInfo(r: ArrivalRoute): { live: boolean; label: string; tone: "live" | "stale" | "none" } {
  if (!r.hasDevice) return { live: false, label: "GPS 미설정", tone: "none" };
  if (!r.gpsLastSeen) return { live: false, label: "GPS 대기", tone: "none" };
  const ageMs = Date.now() - new Date(r.gpsLastSeen).getTime();
  const min = Math.floor(ageMs / 60000);
  if (ageMs < 4 * 60 * 1000) return { live: true, label: min <= 0 ? "📍 방금" : `📍 ${min}분 전`, tone: "live" };
  if (ageMs < 60 * 60 * 1000) return { live: false, label: `📍 ${min}분 전`, tone: "stale" };
  return { live: false, label: "GPS 끊김", tone: "stale" };
}

/** 오늘 행선지를 아직 안 물어본 학생의 갈 수 있는 노선 한 칸. */
/**
 * 차번호에서 뒤 네 자리만.
 *
 * "77수 0340" → "0340". 네 자리가 안 보이면 빈 값을 돌려주고, 화면은 그 줄을 통째로
 * 비웁니다 - "미등록" 같은 글자를 넣으면 좁은 칸에서 진짜 번호처럼 읽힙니다.
 */
function plateTail(v: string | null | undefined): string {
  const m = (v ?? "").trim().match(/(\d{4})\s*$/);
  return m ? m[1] : "";
}

type PendingChoice = { assignmentId: string; studentName: string; group: string; routeId: string; routeNo: string; stopAddress?: string | null; label?: string | null };

type ArrivalData = { label: string; term: string; routes: ArrivalRoute[]; pendingChoice?: PendingChoice[] };

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
  const [showHelp, setShowHelp] = useState(false);
  const [callSheet, setCallSheet] = useState<{ routeNo: string; driverName: string | null; driverPhone: string | null } | null>(null);
  // 현장에서 아이 하나를 픽업으로 바꾸기 전에 한 번 묻습니다.
  // 잘못 누르면 그 아이가 명단에서 사라지고, 사라진 아이는 아무도 찾지 않습니다.
  const [pickupAsk, setPickupAsk] = useState<{ assignmentId: string; studentName: string; routeNo: string } | null>(null);
  /**
   * 차번호로 찾기.
   *
   * 차가 들어왔을 때 손에 있는 정보는 **번호판 네 자리**입니다. 호차 번호는 차에 안 붙어
   * 있어서, 지금은 눈으로 표 전체를 훑어야 했습니다.
   */
  const [plateQuery, setPlateQuery] = useState("");
  const [pickupBusy, setPickupBusy] = useState(false);

  async function markStudentPickup(assignmentId: string) {
    setPickupBusy(true);
    try {
      const res = await fetch(`/api/shuttle/arrival/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "student_pickup", assignmentId, on: true }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert("픽업으로 바꾸지 못했습니다: " + (b.error ?? res.statusText));
        return;
      }
      // 폴링을 기다리지 않고 바로 명단에서 뺍니다. 옆에 학부모님이 서 계신 자리입니다.
      setData((prev) =>
        prev
          ? {
              ...prev,
              routes: prev.routes.map((r) => ({
                ...r,
                roster: r.roster.map((s) => (s.assignmentId === assignmentId ? { ...s, status: "픽업" } : s)),
              })),
            }
          : prev,
      );
      setPickupAsk(null);
    } finally {
      setPickupBusy(false);
    }
  }
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
    // 서버 호출 절감(Vercel 무료 한도): 화면이 안 보이면 건너뛰고, 하원 시간대가 아니면
    // 훨씬 느리게 돕니다. 창을 다시 보면 즉시 한 번 새로고침해 화면이 낡아 보이지 않습니다.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void poll();
        tick();
      }, pollDelay(POLL_MS, IDLE_POLL_MS, 15, 19));
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
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
                events: [
                  ...r.events,
                  { event: action === "arrive" ? "현장도착" : "출발", created_at: new Date().toISOString(), createdBy: null },
                ],
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

  // 행선지를 아직 안 물어본 학생을 이름별로 묶습니다. 한 아이가 갈 수 있는 노선이 여럿이라
  // 이름 하나에 버튼이 여러 개 붙습니다.
  const choiceByStudent = useMemo(() => {
    const m = new Map<string, PendingChoice[]>();
    for (const c of data?.pendingChoice ?? []) {
      const list = m.get(c.studentName) ?? [];
      list.push(c);
      m.set(c.studentName, list);
    }
    for (const list of m.values()) list.sort((a, b) => natCompare(a.routeNo, b.routeNo));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko"));
  }, [data]);

  async function choose(assignmentId: string, mode: "ride" | "skip") {
    setBusyRoute(assignmentId);
    try {
      const res = await fetch(`/api/shuttle/arrival/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "choose", assignmentId, mode }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorMsg(j?.error ?? "저장하지 못했습니다.");
        return;
      }
      // 폴링을 기다리지 않고 바로 목록에서 뺍니다. 물어본 직후에 화면이 안 바뀌면
      // 눌렸는지 확신할 수 없어 한 번 더 누르게 됩니다.
      const fresh = await fetch(`/api/shuttle/arrival/${token}`);
      if (fresh.ok) setData((await fresh.json()) as ArrivalData);
    } finally {
      setBusyRoute(null);
    }
  }

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg font-bold text-slate-600">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-2 pb-10">
      <AddToHomeScreenBanner />
      <div className="mb-2 flex items-center justify-between gap-2 pt-1">
        <div className="flex-1 text-center">
          <p className="text-xs font-bold text-slate-500">{data?.label ?? "도착체크"}</p>
          <h1 className="text-base font-black text-slate-800">🚌 차량 도착·출발 체크</h1>
          <p className="mt-0.5 text-[10px] text-slate-400">
            눌러서 <b className="text-blue-600">●</b> 미도착 → <b className="text-emerald-600">●</b> 도착 →{" "}
            <b className="text-slate-400">●</b> 출발 · 📍는 GPS 연결됨 · 이름을 누르면 개별하원
          </p>
        </div>
        {/* 요청: "전체 리셋을 반으로 잘라서, 전체리셋은 그냥 원 화살표(리셋로고로 많이씀)와
            물음표로 아이콘만 띄워서 누르면 리셋은 리셋되고, 물음표는 안내하도록" - 글자 버튼
            대신 절반씩 나눈 아이콘 두 개로 바꿨습니다: 왼쪽은 눌러서 바로 리셋, 오른쪽은
            사용법 안내 팝업만 띄웁니다. */}
        <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-white">
          <button
            onClick={resetAll}
            disabled={resetting || routes.length === 0}
            title="전체 리셋"
            className="flex h-8 w-8 items-center justify-center border-r border-slate-300 text-base font-bold text-slate-500 active:scale-95 disabled:opacity-40"
          >
            ⟲
          </button>
          <button
            onClick={() => setShowHelp(true)}
            title="사용법 안내"
            className="flex h-8 w-8 items-center justify-center text-sm font-bold text-slate-500 active:scale-95"
          >
            ?
          </button>
        </div>
      </div>

      {/* 차번호 네 자리로 바로 찾습니다. 호차로도 찾히게 해서, 무엇이 손에 있든 통합니다. */}
      <div className="mb-2 flex items-center gap-1.5">
        <input
          value={plateQuery}
          onChange={(e) => setPlateQuery(e.target.value)}
          inputMode="numeric"
          placeholder="차번호 뒤 4자리 · 호차로 찾기"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        {plateQuery && (
          <button
            type="button"
            onClick={() => setPlateQuery("")}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-500 active:scale-95"
          >
            ✕
          </button>
        )}
      </div>

      {routes.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">오늘 탈 학생이 있는 노선이 없습니다.</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5">
          {routes
            .filter((r) => {
              const k = plateQuery.replace(/\s+/g, "").toLowerCase();
              if (!k) return true;
              return (
                (r.vehicleNo ?? "").replace(/\s+/g, "").toLowerCase().includes(k) ||
                r.routeNo.toLowerCase().includes(k) ||
                (r.name ?? "").toLowerCase().includes(k)
              );
            })
            .map((r) => {
            const hasArrived = r.events.some((e) => e.event === "현장도착");
            const departEvent = r.events.find((e) => e.event === "출발");
            const hasDeparted = !!departEvent;
            const status: "waiting" | "arrived" | "departed" = hasDeparted ? "departed" : hasArrived ? "arrived" : "waiting";
            const isBusy = busyRoute === r.routeId;
            // 요청: "출발 체크를 까먹거나 늦어져서 계속 화면에 차량이 뜨는 경우가 너무 많아" -
            // 사람이 안 눌러도 GPS로 학교에서 멀어진 걸 감지하거나(정확), 그마저 없으면 20분
            // 시간 초과로 자동 정리됩니다(정리 목적, 실제 출발 확인은 아님). 자동으로 처리된
            // 경우 사람이 직접 누른 것과 구분해 작게 표시해서, 왜 출발함으로 바뀌었는지 알 수
            // 있게 합니다.
            const autoLabel =
              departEvent?.createdBy === "GPS 자동감지" ? "GPS 감지" : departEvent?.createdBy === "시간초과 자동정리" ? "시간 초과" : null;
            // 도착이 GPS로 자동 잡혔는지(사람이 누른 게 아니라).
            const arrivedByGps = r.events.find((e) => e.event === "현장도착")?.createdBy === "GPS 자동감지";
            // GPS 신호 상태(살아있음/끊김/미설정)와, 아직 도착 전인데 GPS가 살아있으면 "운행중".
            const gps = gpsInfo(r);
            // 하원 체크표에서 픽업(부모님이 직접 데려가심)·결석으로 체크한 학생은 이 차를 안
            // 타므로 "미도착 명단"에서 뺍니다(요청: "결석이나, 픽업을 체크하면 실시간으로 교직원
            // 차량 도착 출발체크에 반영이 되고" - 안내보드와 같은 필터링 방식).
            const waiting = r.roster.filter((s) => s.status !== "탑승" && s.status !== "픽업" && s.status !== "결석");
            const pickedUpCount = r.roster.filter((s) => s.status === "픽업").length;
            const absentCount = r.roster.filter((s) => s.status === "결석").length;
            return (
              <div
                key={r.routeId}
                className={
                  // 색이 상태를 말합니다(요청). 청색=미도착 · 초록=도착 · 회색=출발.
                  "flex min-w-0 flex-col overflow-hidden rounded-lg border-2 " +
                  (status === "arrived" ? "border-emerald-400" : status === "departed" ? "border-slate-200" : "border-blue-300")
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
                      ? "bg-emerald-500 text-white"
                      : status === "departed"
                        ? "bg-slate-200 text-slate-500"
                        : "bg-white text-blue-700")
                  }
                >
                  {/* 왼쪽 동그라미가 상태입니다. 청색=미도착 · 초록=도착 · 회색=출발.
                      핀은 **GPS가 붙어 신호가 오는 차에만** 뜹니다. 핀이 없으면 GPS 대기입니다.
                      글자로 또 적으면 좁은 칸이 글자로 가득 차서 정작 호차가 안 보입니다. */}
                  <span className="flex items-center gap-1 leading-tight">
                    <span
                      aria-hidden
                      className={
                        "inline-block h-2.5 w-2.5 shrink-0 rounded-full " +
                        (status === "arrived"
                          ? "bg-emerald-300 ring-1 ring-white"
                          : status === "departed"
                            ? "bg-slate-400"
                            : "bg-blue-500")
                      }
                      title={status === "arrived" ? "도착" : status === "departed" ? "출발" : "미도착"}
                    />
                    {gps.tone === "live" && (
                      <span className="shrink-0 text-[10px] leading-none" title={`GPS 연결됨 · ${gps.label}`}>
                        📍
                      </span>
                    )}
                    <span className="text-base font-black">{r.routeNo}호</span>
                  </span>
                  {r.name && <span className="max-w-full truncate text-[8px] font-semibold leading-tight opacity-80">{r.name}</span>}
                  {/* 담당자: "호차 / 차량번호 / 기사님 / 타는 애들 뱃지 이렇게 뜨게."
                      차량번호를 아직 못 적은 차도 있어서, 없으면 그 줄을 그냥 비워둡니다
                      ("미등록" 같은 글자를 넣으면 좁은 칸에서 진짜 번호처럼 읽힙니다). */}
                  {/* 차번호는 **뒤 네 자리만** 크게 적습니다.
                      사람이 외우고 부르는 것은 뒤 네 자리입니다. 앞 글자("77수")까지 넣으면
                      좁은 칸에서 전체가 작아져, 정작 필요한 네 자리가 안 보입니다. */}
                  {plateTail(r.vehicleNo) && (
                    <span className="max-w-full truncate text-sm font-black leading-tight tracking-wide">
                      {plateTail(r.vehicleNo)}
                    </span>
                  )}
                  {r.driverName && (
                    <span className="max-w-full truncate text-[7px] font-medium leading-tight opacity-60">{r.driverName} 기사님</span>
                  )}
                  {/* 상태는 위 동그라미가 말합니다. 여기에는 **연결 상태만** 아주 작게.
                      사람이 누른 건지 GPS가 잡은 건지는 이 줄에 함께 붙입니다. */}
                  <span
                    className={
                      "mt-0.5 text-[7px] font-semibold leading-none " +
                      (status === "arrived" ? "text-emerald-100" : status === "departed" ? "text-slate-400" : "text-slate-400")
                    }
                  >
                    {status === "departed" && autoLabel
                      ? `자동·${autoLabel}`
                      : status === "arrived" && arrivedByGps
                        ? "자동·GPS"
                        : gps.label}
                  </span>
                </button>
                {(waiting.length > 0 || pickedUpCount > 0 || absentCount > 0) && (
                  <div className="flex flex-wrap content-start gap-0.5 bg-slate-50 p-1">
                    {/* 이름을 누르면 그 아이만 픽업으로 바꿉니다.
                        하원 지도 중에 학부모님이 찾아오셔서 데려가시는 일이 하루에도 여러 번
                        있습니다. 그 자리에서 못 누르면 나중에 옮겨 적어야 하고, 옮겨 적는 일은
                        반드시 언젠가 빠집니다.

                        **손가락으로 누를 수 있는 크기**로 키웠습니다. 8px 글자에 여백이 거의
                        없던 뱃지는 휴대폰에서 사실상 못 누릅니다. 잘못 눌렀을 때가 더 위험하므로
                        (아이가 명단에서 사라집니다) 누르면 바로 바꾸지 않고 한 번 묻습니다. */}
                    {waiting.map((s) => (
                      <button
                        key={s.assignmentId}
                        type="button"
                        onClick={() => setPickupAsk({ assignmentId: s.assignmentId, studentName: s.studentName, routeNo: r.routeNo })}
                        className="min-h-[22px] rounded border border-red-300 bg-red-50 px-1 py-0.5 text-[10px] font-bold leading-tight text-red-600 active:scale-95"
                      >
                        {s.studentName}
                      </button>
                    ))}
                    {(pickedUpCount > 0 || absentCount > 0) && (
                      <span className="px-0.5 py-0.5 text-[7px] font-semibold leading-none text-slate-400">
                        {pickedUpCount > 0 && <>픽업 {pickedUpCount}</>}
                        {pickedUpCount > 0 && absentCount > 0 && " · "}
                        {absentCount > 0 && <>결석 {absentCount}</>}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}


      {/* 담당자: "이준서, 이준우 너무 많이 차지해. 몇 호인지만 선택하게 해주고 아래쪽으로 내려줘."
          맞습니다 - 이건 하루에 두 번 누르는 일인데 화면 맨 위 절반을 잡아먹고 있었습니다.
          차량 카드가 먼저 보여야 합니다. 정류장 주소는 버튼을 꾹 누르면 뜨게 남겨뒀습니다. */}
      {choiceByStudent.length > 0 && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5">
          <p className="mb-1 text-[10px] font-bold text-amber-800">⚠ 행선지 확인 필요</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {choiceByStudent.map(([name, opts]) => (
              <div key={name} className="flex items-center gap-1 rounded bg-white px-1.5 py-1">
                <span className="text-xs font-bold text-slate-800">{name}</span>
                {opts.map((o) => (
                  <button
                    key={o.assignmentId}
                    onClick={() => choose(o.assignmentId, "ride")}
                    disabled={busyRoute === o.assignmentId}
                    title={`${o.routeNo}호${o.stopAddress ? ` · ${o.stopAddress}` : ""}`}
                    className={
                      "rounded px-2 py-0.5 text-[11px] font-bold active:scale-95 disabled:opacity-40 " +
                      // 갈 곳 이름이 안 붙은 줄은 회색으로 둡니다.
                      //
                      // 이름이 없다는 건 **우리도 그게 뭔지 모른다**는 뜻입니다. 파란 버튼으로
                      // 나란히 두면 아는 것처럼 보여서, 물어본 대답과 상관없이 눌러버릴 수
                      // 있습니다. 눌리면 그 호차에 태워집니다.
                      (o.label ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-400")
                    }
                  >
                    {/* 담당자: "차량으로 하지 말고 학원인지 집·기업은행인지 누르도록.
                        우리가 물어보는 게 그거니까."
                        아이에게 "몇 호차 타?"라고 묻지 않습니다. "어디 가?"라고 묻습니다.
                        화면이 물어보는 말과 다르게 생기면 듣고 나서 머릿속으로 한 번 더
                        바꿔야 하고, 그때 틀립니다. 호차 배정은 눌린 뒤에 알아서 됩니다. */}
                    {o.label ?? `${o.routeNo}호?`}
                  </button>
                ))}
                <button
                  onClick={() => choose(opts[0].assignmentId, "skip")}
                  disabled={busyRoute === opts[0].assignmentId}
                  className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 active:scale-95 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pickupAsk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3" onClick={() => setPickupAsk(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-lg font-black text-slate-800">{pickupAsk.studentName}</p>
            <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
              {pickupAsk.routeNo}호를 타지 않고 <b className="text-slate-700">보호자가 데려가는 것</b>으로 표시합니다.
              <br />
              명단에서 빠지고, 아이들이 보는 안내보드에 <b className="text-slate-700">개별하원</b>으로 뜹니다.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pickupBusy}
                onClick={() => void markStudentPickup(pickupAsk.assignmentId)}
                className="flex-1 rounded-xl bg-pink-600 py-3 text-base font-bold text-white active:scale-95 disabled:opacity-50"
              >
                {pickupBusy ? "…" : "🚗 개별하원으로"}
              </button>
              <button
                type="button"
                onClick={() => setPickupAsk(null)}
                className="rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold text-slate-600"
              >
                취소
              </button>
            </div>
          </div>
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

      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHelp(false)}>
          <div className="w-full max-w-xs rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-2 text-sm font-bold text-slate-800">ℹ️ 사용법</p>
            <ul className="list-disc space-y-1.5 pl-4 text-[11px] leading-relaxed text-slate-600">
              <li>차량 카드를 누르면 미도착 → 도착함 → 출발함 → 미도착 순서로 바뀝니다.</li>
              <li><b>GPS가 켜진 차량은 자동으로 색이 바뀝니다</b> — 운행 중이면 초록, 학교 근처에 도착하면 주황(도착함), 멀어지면 회색(출발함).</li>
              <li>카드 맨 아래 <b>📍 표시</b>로 기사님 휴대폰 GPS가 살아있는지 확인할 수 있습니다(초록=방금 신호, 회색=끊김/미설정).</li>
              <li>자동으로 안 바뀌어도 카드를 눌러 직접 도착·출발을 표시할 수 있습니다.</li>
              <li>차량 카드를 꾹 누르면 기사님께 바로 전화할 수 있습니다.</li>
              <li>카드 아래 빨간 뱃지는 아직 안 탄 학생이고, 픽업·결석 학생은 자동으로 빠집니다.</li>
              <li>⟲를 누르면 오늘 체크한 모든 차량의 도착·출발 상태가 한 번에 초기화됩니다.</li>
            </ul>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="mt-3 w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
