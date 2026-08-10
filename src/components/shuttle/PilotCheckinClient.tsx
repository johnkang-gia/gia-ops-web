"use client";

import { useEffect, useRef, useState } from "react";

const PING_INTERVAL_MS = 5000;
// 안전운행지수(3단계-a) 튜닝값 - 실측 없이 시작하는 v1이라 다소 보수적으로 잡았습니다(오탐이
// 잦으면 의미가 없으므로). magnitude는 "직전 완만한 평균(중력 포함) 대비 이번 순간의 차이"로,
// 급브레이크·급출발처럼 짧고 강한 변화만 잡아내고 평소 흔들림(방지턱, 손떨림)은 걸러냅니다.
const ACCEL_THRESHOLD = 4.5; // m/s^2
const SAFETY_EVENT_COOLDOWN_MS = 4000; // 같은 종류 이벤트 연속 전송 방지

type Status = "idle" | "running" | "stopped";
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

// 기사님·동승선생님이 로그인 없이 이 링크 하나로 접속하는 실시간 위치 체크인 화면입니다.
// "운행 시작"을 누르면 5초 간격으로 위치만 서버에 보내고, 그 외 정보는 전혀 전송하지 않습니다.
// 화면 조작 없이 내비게이션 앱으로 넘어가셔도 되지만, 브라우저 특성상 화면이 완전히 꺼지거나
// 다른 앱으로 오래 전환하면 전송이 잠시 멈출 수 있습니다.
// 2단계-a: 위치 전송과는 별개로, 오늘 이 노선에 배정된 학생별 탑승·결석·하차를 터치 한 번으로
// 체크할 수 있습니다(옐로우버스 방식 - 목록에서 버튼 하나만 누르면 됩니다).
// 3단계-a: 운행 중에는 휴대폰 가속도 센서로 급가속·급감속도 함께 감지해 안전운행지수 계산에 씁니다.
export default function PilotCheckinClient({
  token,
  routeNo,
  direction,
  routeName,
  initialRoster,
}: {
  token: string;
  routeNo: string;
  direction: "등원" | "하원";
  routeName: string;
  initialRoster: BoardingRosterItem[];
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [sentCount, setSentCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roster, setRoster] = useState(initialRoster);
  const [accelCount, setAccelCount] = useState(0);
  const [decelCount, setDecelCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const motionBaselineRef = useRef<number | null>(null);
  const lastSafetyEventAtRef = useRef<{ 급가속: number; 급감속: number }>({ 급가속: 0, 급감속: 0 });
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

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

  async function sendEvent(event: "출발" | "도착") {
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

  async function start() {
    setErrorMsg(null);
    setStatus("running");
    setSentCount(0);
    setFailCount(0);
    setAccelCount(0);
    setDecelCount(0);
    await sendEvent("출발");
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

  async function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopMotion();
    setStatus("stopped");
    await sendEvent("도착");
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
      stopMotion();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = status === "running";

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
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>GIA 셔틀 실시간 위치</p>
        <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0", color: "#0f172a" }}>
          {direction} {routeNo}호 {routeName && `· ${routeName}`}
        </p>
      </div>

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
        <p style={{ fontSize: 16, fontWeight: 600, color: running ? "#1d4ed8" : "#64748b", margin: "0 0 4px" }}>
          {status === "idle" && "운행 대기중"}
          {status === "running" && "운행중 - 위치 전송 중"}
          {status === "stopped" && "운행 종료됨"}
        </p>
        {running && (
          <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
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

      {errorMsg && (
        <p style={{ color: "#dc2626", fontSize: 14, textAlign: "center", maxWidth: 320 }}>{errorMsg}</p>
      )}

      {status !== "stopped" ? (
        <button
          onClick={running ? stop : start}
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "18px 0",
            borderRadius: 14,
            border: "none",
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            background: running ? "#dc2626" : "#2563eb",
            cursor: "pointer",
          }}
        >
          {running ? "운행 종료하기" : "운행 시작하기"}
        </button>
      ) : (
        <button
          onClick={start}
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "18px 0",
            borderRadius: 14,
            border: "none",
            fontSize: 18,
            fontWeight: 700,
            color: "#fff",
            background: "#2563eb",
            cursor: "pointer",
          }}
        >
          다시 시작하기
        </button>
      )}

      <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
        운행 시작을 누른 뒤부터 운행 종료를 누를 때까지만 위치가 전송됩니다. 그 외 정보는 전송되지 않습니다.
      </p>

      {roster.length > 0 && (
        <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#334155", margin: "8px 0 0" }}>오늘 탑승 학생 ({roster.length}명)</p>
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
    </div>
  );
}
