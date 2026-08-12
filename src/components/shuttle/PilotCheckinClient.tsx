"use client";

import { useEffect, useRef, useState } from "react";
import { haversineMeters } from "@/lib/shuttleRecommend";

const PING_INTERVAL_MS = 5000;
// 아직 "현장도착"이 안 찍힌 상태에서, 도착했는지 확인하려고 주기적으로 확인하는 간격입니다.
// GPS 전송(5초)보다 훨씬 여유 있게 잡아 배터리를 아낍니다.
const STATUS_POLL_MS = 20_000;
// 오늘의 마지막 정류장에서 이 거리(m) 안으로 들어오면(+연속 확인) 다 왔다고 보고 자동으로
// 위치 전송을 멈춥니다. 학교 출발 자동감지(도착체크)와 같은 반경을 씁니다.
const FINAL_STOP_RADIUS_M = 100;
// 정류장끼리 가까이 붙어있을 때, 지나가기만 해도 "다 왔다"고 오판하지 않도록 반경 안에 연속
// 몇 번 들어와야 인정할지(약 15초 = 3회 * 5초 간격, 실제로 멈춰선 경우만 걸러집니다).
const FINAL_STOP_CONFIRM_COUNT = 3;
// 안전운행지수(3단계-a) 튜닝값 - 실측 없이 시작하는 v1이라 다소 보수적으로 잡았습니다(오탐이
// 잦으면 의미가 없으므로). magnitude는 "직전 완만한 평균(중력 포함) 대비 이번 순간의 차이"로,
// 급브레이크·급출발처럼 짧고 강한 변화만 잡아내고 평소 흔들림(방지턱, 손떨림)은 걸러냅니다.
const ACCEL_THRESHOLD = 4.5; // m/s^2
const SAFETY_EVENT_COOLDOWN_MS = 4000; // 같은 종류 이벤트 연속 전송 방지

type BoardingStatusValue = "예정" | "탑승" | "미탑승" | "결석" | "픽업";

export type BoardingRosterItem = {
  assignmentId: string;
  studentName: string;
  stopSeq: number;
  stopTime: string | null;
  status: BoardingStatusValue;
  alighted: boolean;
};

const STATUS_BUTTONS: { value: BoardingStatusValue; label: string; color: string }[] = [
  { value: "탑승", label: "탑승", color: "#16a34a" },
  { value: "결석", label: "결석", color: "#dc2626" },
  { value: "미탑승", label: "미탑승", color: "#d97706" },
];

// 동승선생님이 로그인 없이 이 링크 하나로 접속하는 하원 셔틀 체크인 화면입니다(요청: "일단은
// 기사님과 동승선생님 둘다 관리하기 보다는 동승선생님들만 설치해서 작동하도록... 등원은 패스하고
// 하원만 진행"). 화면 흐름은 ① 학생 탑승을 먼저 확인하고 ② 학교 '현장도착'이 확인되면 버튼 없이
// 자동으로 위치 전송이 시작되어 ③ 오늘의 마지막 정류장 근처에 닿으면 자동으로 멈추는 순서입니다
// (요청: "기사님들이 버튼을 눌러달라고 하면 운행하느라 빼먹을 경우가 많아서 키고 끄는 걸 우리가
// 제어하게끔 해줘" - 조작 없이도 동작하고, 자동 감지가 늦거나 안 될 때만 쓰는 작은 예비 버튼을
// 남겨뒀습니다). 완전한 백그라운드 전송은 브라우저 특성상(특히 아이폰 사파리) 불가능해 네비 앱
// 등으로 오래 전환하면 전송이 잠시 멈출 수 있지만, 화면으로 돌아올 때마다 바로 이어서 보냅니다.
// 2단계-a: 위치 전송과는 별개로, 오늘 이 노선에 배정된 학생별 탑승·결석·하차를 터치 한 번으로
// 체크할 수 있습니다(옐로우버스 방식 - 목록에서 버튼 하나만 누르면 됩니다).
// 3단계-a: 이동 중에는 휴대폰 가속도 센서로 급가속·급감속도 함께 감지해 안전운행지수 계산에 씁니다.
type AutoPhase = "waiting" | "running" | "completed";

export default function PilotCheckinClient({
  token,
  routeNo,
  direction,
  routeName,
  initialRoster,
  initialHasArrived,
  initialHasFinalArrived,
  lastStop,
}: {
  token: string;
  routeNo: string;
  direction: "등원" | "하원";
  routeName: string;
  initialRoster: BoardingRosterItem[];
  initialHasArrived: boolean;
  initialHasFinalArrived: boolean;
  lastStop: { lat: number; lng: number } | null;
}) {
  const [sentCount, setSentCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roster, setRoster] = useState(initialRoster);
  const [accelCount, setAccelCount] = useState(0);
  const [decelCount, setDecelCount] = useState(0);
  // 요청: "gia출발부터 마지막 정류장 도착까지 켜두고... 키고 끄는 걸 우리가 제어하게끔" - 기사님
  // 조작 없이 학교 '현장도착'이 찍히면 자동 시작, 오늘의 마지막 정류장 근처에 닿으면 자동
  // 종료됩니다. autoPhase가 이 자동 흐름의 단계이고, start()/stop() 수동 버튼은 자동이 안 될
  // 때를 대비한 예비 수단으로만 남겨둡니다.
  const [autoPhase, setAutoPhase] = useState<AutoPhase>(
    initialHasFinalArrived ? "completed" : initialHasArrived ? "running" : "waiting"
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const motionBaselineRef = useRef<number | null>(null);
  const lastSafetyEventAtRef = useRef<{ 급가속: number; 급감속: number }>({ 급가속: 0, 급감속: 0 });
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);
  const finalStopHitCountRef = useRef(0);
  const autoStartedRef = useRef(false);

  async function setBoardingStatus(assignmentId: string, next: BoardingStatusValue) {
    // 이미 같은 상태를 누르면 "예정"으로 되돌립니다(잘못 눌렀을 때 취소하는 용도).
    const wasSame = roster.find((r) => r.assignmentId === assignmentId)?.status === next;
    const finalValue: BoardingStatusValue = wasSame ? "예정" : next;
    setRoster((prev) => prev.map((r) => (r.assignmentId === assignmentId ? { ...r, status: finalValue } : r)));
    try {
      await fetch("/api/shuttle/pilot/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, assignmentId, field: "status", value: finalValue }),
      });
    } catch {
      // 네트워크 오류는 조용히 무시 - 화면은 이미 낙관적으로 갱신됨. 필요하면 다시 눌러 재시도.
    }
  }

  async function toggleAlighted(assignmentId: string) {
    const nextValue = !roster.find((r) => r.assignmentId === assignmentId)?.alighted;
    setRoster((prev) => prev.map((r) => (r.assignmentId === assignmentId ? { ...r, alighted: nextValue } : r)));
    try {
      await fetch("/api/shuttle/pilot/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, assignmentId, field: "alighted", value: nextValue }),
      });
    } catch {
      // 조용히 무시(위와 동일).
    }
  }

  function sendSafetyEvent(eventType: "급가속" | "급감속", magnitude: number) {
    setAccelCount((c) => (eventType === "급가속" ? c + 1 : c));
    setDecelCount((c) => (eventType === "급감속" ? c + 1 : c));
    fetch("/api/shuttle/pilot/safety-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, eventType, magnitude }),
    }).catch(() => {
      // 안전지표는 참고용이라 전송 실패해도 조용히 넘어갑니다(위치 전송을 막지 않음).
    });
  }

  // 가속도 센서로 급가속/급감속을 감지합니다(3단계-a). accelerationIncludingGravity(중력 포함
  // 값 - 기종에 상관없이 항상 지원됨)의 크기를 완만한 이동평균(baseline)과 비교해, 그 차이가
  // 기준치를 넘는 "순간"만 이벤트로 봅니다. baseline 자체가 중력·기울기를 서서히 따라가므로
  // 별도 보정 없이도 방지턱 같은 잔진동이 아니라 급브레이크·급출발처럼 짧고 강한 변화만 걸러집니다.
  function startMotion() {
    if (typeof DeviceMotionEvent === "undefined") return;
    const requestPermission = (
      DeviceMotionEvent as unknown as { requestPermission?: () => Promise<"granted" | "denied"> }
    ).requestPermission;

    function attach() {
      motionBaselineRef.current = null;
      const handler = (e: DeviceMotionEvent) => {
        const g = e.accelerationIncludingGravity;
        if (!g || g.x == null || g.y == null || g.z == null) return;
        const magnitude = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
        if (motionBaselineRef.current == null) {
          motionBaselineRef.current = magnitude;
          return;
        }
        const delta = magnitude - motionBaselineRef.current;
        motionBaselineRef.current = motionBaselineRef.current * 0.9 + magnitude * 0.1;
        const now = Date.now();
        if (Math.abs(delta) < ACCEL_THRESHOLD) return;
        const type: "급가속" | "급감속" = delta > 0 ? "급가속" : "급감속";
        if (now - lastSafetyEventAtRef.current[type] < SAFETY_EVENT_COOLDOWN_MS) return;
        lastSafetyEventAtRef.current[type] = now;
        sendSafetyEvent(type, Math.abs(delta));
      };
      motionHandlerRef.current = handler;
      window.addEventListener("devicemotion", handler);
    }

    if (typeof requestPermission === "function") {
      // iOS 13+는 사용자 동작(이 버튼 탭) 안에서 명시적으로 권한을 물어야 합니다.
      requestPermission().then((res) => {
        if (res === "granted") attach();
      }).catch(() => {});
    } else {
      attach();
    }
  }

  function stopMotion() {
    if (motionHandlerRef.current) {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
  }

  // "출발" 이벤트는 더 이상 이 화면에서 보내지 않습니다 - 학교 도착체크·GPS 자동감지 크론이
  // 이미 그 역할을 맡고 있고, 같은 노선·같은 날에는 하나만 기록되도록 DB에서 막아뒀습니다(v0.122.0
  // 부분 유니크 인덱스). 여기서는 "도착(운행 종료)"만 기록합니다.
  async function sendEvent(event: "도착") {
    try {
      await fetch("/api/shuttle/pilot/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, event }),
      });
    } catch {
      // 이벤트 전송 실패는 위치 전송을 막지 않습니다 - 조용히 넘어갑니다.
    }
  }

  // 요청: "gia출발부터 마지막 정류장 도착까지 켜두고 계속 주기적으로 전달" - 매 위치 전송마다
  // 오늘의 마지막 정류장과의 거리를 함께 확인해서, 다 왔으면 자동으로 종료합니다. 정류장끼리
  // 붙어있어 지나가기만 해도 오판하지 않도록 반경 안에 연속으로 몇 번(FINAL_STOP_CONFIRM_COUNT)
  // 들어와야만 "도착"으로 인정합니다.
  function checkFinalStopProximity(lat: number, lng: number) {
    if (!lastStop) return;
    const distance = haversineMeters(lastStop.lat, lastStop.lng, lat, lng);
    if (distance <= FINAL_STOP_RADIUS_M) {
      finalStopHitCountRef.current += 1;
      if (finalStopHitCountRef.current >= FINAL_STOP_CONFIRM_COUNT) {
        finishTracking(true);
        setAutoPhase("completed");
      }
    } else {
      finalStopHitCountRef.current = 0;
    }
  }

  function sendPing() {
    if (!navigator.geolocation) {
      setErrorMsg("이 기기/브라우저는 위치 기능을 지원하지 않습니다.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLastAccuracy(pos.coords.accuracy);
        try {
          const res = await fetch("/api/shuttle/pilot/ping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          });
          if (res.ok) {
            setSentCount((c) => c + 1);
            setLastSentAt(new Date());
            setErrorMsg(null);
            checkFinalStopProximity(pos.coords.latitude, pos.coords.longitude);
          } else {
            setFailCount((c) => c + 1);
          }
        } catch {
          setFailCount((c) => c + 1);
        }
      },
      (err) => {
        setFailCount((c) => c + 1);
        if (err.code === err.PERMISSION_DENIED) {
          setErrorMsg("위치 권한이 꺼져 있습니다. 브라우저 설정에서 위치 접근을 허용해주세요.");
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }

  // 위치 전송을 시작합니다(자동 감지든 수동 예비 버튼이든 공통). 요청: "키고 끄는 걸 우리가
  // 제어하게끔" - "출발" 이벤트는 더 이상 여기서 쓰지 않습니다(학교 도착체크·GPS 자동감지
  // 크론이 이미 그 역할을 하고, 같은 노선·같은 날에는 하나만 기록되도록 DB에서 막아뒀습니다).
  async function beginTracking() {
    setErrorMsg(null);
    setSentCount(0);
    setFailCount(0);
    setAccelCount(0);
    setDecelCount(0);
    finalStopHitCountRef.current = 0;
    sendPing();
    timerRef.current = setInterval(sendPing, PING_INTERVAL_MS);
    startMotion();
    try {
      // 화면이 꺼지면 위치 전송이 멈출 수 있어, 지원하는 브라우저에서는 화면이 자동으로
      // 꺼지지 않도록 요청합니다(운행 중에만, 미지원 브라우저에서는 조용히 무시됩니다).
      const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
      if (nav.wakeLock) wakeLockRef.current = await nav.wakeLock.request("screen");
    } catch {
      // Wake Lock 미지원/거부는 무시 - 핵심 기능(위치 전송)에는 영향 없습니다.
    }
  }

  // 위치 전송을 멈춥니다. sendArrivalEvent가 true면 "도착(운행 종료)" 이벤트도 함께 기록합니다
  // (자동 종료·수동 종료 모두 여기로 모입니다. 자동 재시도 방지를 위한 시간초과 등 예외적인
  // 경우에만 false로 부를 수 있게 남겨둡니다).
  async function finishTracking(sendArrivalEvent: boolean) {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopMotion();
    if (sendArrivalEvent) await sendEvent("도착");
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }

  // 수동 시작(예비 버튼) - 자동 감지가 늦거나 안 될 때를 위한 대비용입니다.
  async function start() {
    autoStartedRef.current = true;
    setAutoPhase("running");
    await beginTracking();
  }

  // 수동 종료(예비 버튼) - 위와 동일하게 자동 감지가 안 될 때의 대비용입니다.
  async function stop() {
    await finishTracking(true);
    setAutoPhase("completed");
  }

  // 요청: "기사님들이 버튼을 눌러달라고 하면... 우리가 제어하게끔 해줘" - 버튼 없이도 학교
  // '현장도착'이 찍히면(도착체크·GPS 자동감지) 자동으로 위치 전송을 시작합니다. 아직 대기
  // 중일 때만 짧은 주기로 상태를 확인하고, 시작된 뒤에는 더 이상 확인하지 않아 배터리를
  // 아낍니다. 페이지를 열었을 때 이미 '현장도착'이 찍혀 있으면(서버에서 받은 initialHasArrived)
  // 곧바로 자동 시작됩니다.
  useEffect(() => {
    if (autoPhase === "completed") return;
    if (autoPhase === "running") {
      if (!autoStartedRef.current) {
        autoStartedRef.current = true;
        beginTracking();
      }
      return;
    }
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/shuttle/pilot/status?token=${token}`);
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { hasArrived?: boolean; hasFinalArrived?: boolean };
        if (cancelled) return;
        if (json.hasFinalArrived) {
          setAutoPhase("completed");
          return;
        }
        if (json.hasArrived && !autoStartedRef.current) {
          autoStartedRef.current = true;
          setAutoPhase("running");
          beginTracking();
        }
      } catch {
        // 폴링 실패는 조용히 넘어가고 다음 주기에 다시 시도합니다.
      }
    }
    poll();
    statusPollRef.current = setInterval(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPhase]);

  // 요청: "핸드폰을 조작하는데 이 앱이 방해를 해서는 안돼... 백그라운드에서 돌아갈 수 있도록" -
  // 완전한 백그라운드 위치 전송은 브라우저(특히 아이폰 사파리) 특성상 불가능하지만, 기사님이
  // 네비 앱 등으로 전환했다가 화면으로 돌아올 때마다 즉시 한 번 더 전송해서, 끊긴 동안의 공백을
  // 최대한 빨리 메웁니다.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible" && autoPhase === "running") sendPing();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPhase]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      stopMotion();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = autoPhase === "running";

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: 24,
        fontFamily: "sans-serif",
        background: running ? "#eff6ff" : "#f8fafc",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>GIA 하원 셔틀 · 동승선생님 체크인</p>
        <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0", color: "#0f172a" }}>
          {direction} {routeNo}호 {routeName && `· ${routeName}`}
        </p>
      </div>

      {errorMsg && (
        <p style={{ color: "#dc2626", fontSize: 14, textAlign: "center", maxWidth: 320 }}>{errorMsg}</p>
      )}

      {roster.length > 0 && (
        <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#334155", margin: 0 }}>① 학생 탑승 확인 ({roster.length}명)</p>
          {roster.map((r) => (
            <div
              key={r.assignmentId}
              style={{
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "10px 12px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>{r.studentName}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{r.stopTime ?? ""}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_BUTTONS.map((b) => (
                  <button
                    key={b.value}
                    onClick={() => setBoardingStatus(r.assignmentId, b.value)}
                    style={{
                      flex: 1,
                      minWidth: 64,
                      padding: "8px 0",
                      borderRadius: 8,
                      border: "none",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      color: r.status === b.value ? "#fff" : b.color,
                      background: r.status === b.value ? b.color : `${b.color}18`,
                    }}
                  >
                    {r.status === b.value ? `✓ ${b.label}` : b.label}
                  </button>
                ))}
                <button
                  onClick={() => toggleAlighted(r.assignmentId)}
                  style={{
                    flex: 1,
                    minWidth: 64,
                    padding: "8px 0",
                    borderRadius: 8,
                    border: "none",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    color: r.alighted ? "#fff" : "#2563eb",
                    background: r.alighted ? "#2563eb" : "#2563eb18",
                  }}
                >
                  {r.alighted ? "✓ 하차" : "하차"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          width: "100%",
          maxWidth: 360,
          borderRadius: 16,
          padding: 20,
          background: "#fff",
          border: "1px solid #e2e8f0",
          textAlign: "center",
        }}
      >
        <p style={{ fontSize: 13, fontWeight: 700, color: "#334155", margin: "0 0 8px" }}>② 위치 전송 (자동)</p>
        <p style={{ fontSize: 16, fontWeight: 600, color: running ? "#1d4ed8" : "#64748b", margin: "0 0 4px" }}>
          {autoPhase === "waiting" && "🕐 학교 도착 대기 중"}
          {autoPhase === "running" && "🟢 위치 자동 전송 중"}
          {autoPhase === "completed" && "✅ 오늘 운행 종료됨"}
        </p>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>
          {autoPhase === "waiting" && "학교에서 출발이 확인되면 자동으로 시작됩니다"}
          {autoPhase === "running" && "마지막 정류장에 도착하면 자동으로 멈춥니다"}
          {autoPhase === "completed" && "따로 하실 조작은 없습니다"}
        </p>
        {running && (
          <p style={{ fontSize: 13, color: "#64748b", margin: "8px 0 0" }}>
            {sentCount}회 전송{failCount > 0 ? ` · 실패 ${failCount}회` : ""}
            {lastSentAt && ` · 마지막 ${lastSentAt.toLocaleTimeString("ko-KR")}`}
          </p>
        )}
        {running && lastAccuracy != null && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "2px 0 0" }}>정확도 약 {Math.round(lastAccuracy)}m</p>
        )}
        {running && (accelCount > 0 || decelCount > 0) && (
          <p style={{ fontSize: 12, color: "#d97706", margin: "4px 0 0" }}>
            ⚠️ 급가속 {accelCount}회 · 급감속 {decelCount}회 감지됨
          </p>
        )}
      </div>

      {/* 요청: "키고 끄는 걸 우리가 제어하게끔 해줘" - 자동으로 시작·종료되므로 평소에는 버튼을
          누르실 필요가 없습니다. 자동 감지가 늦거나 안 될 때만 쓰시라고 작은 예비 버튼으로
          남겨뒀습니다(주 CTA가 아니라 보조 수단이라는 걸 보여주려고 크기·색을 낮췄습니다). */}
      {autoPhase !== "completed" && (
        <button
          onClick={running ? stop : start}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            fontSize: 12,
            fontWeight: 600,
            color: "#64748b",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          {running ? "지금 수동으로 종료" : "지금 수동으로 시작"}
        </button>
      )}
      {autoPhase === "completed" && (
        <button
          onClick={start}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            fontSize: 12,
            fontWeight: 600,
            color: "#64748b",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          다시 시작하기
        </button>
      )}

      <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
        위치는 학교 출발부터 마지막 정류장 도착까지만 자동으로 전송되고, 학부모님께는 전달되지 않습니다. 담당 직원이 차량 위치 확인·하원 운영에만 사용합니다.
      </p>
    </div>
  );
}
