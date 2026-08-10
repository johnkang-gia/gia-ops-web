"use client";

import { useEffect, useRef, useState } from "react";

const PING_INTERVAL_MS = 5000;

type Status = "idle" | "running" | "stopped";

// 기사님·동승선생님이 로그인 없이 이 링크 하나로 접속하는 파일럿 체크인 화면입니다.
// "운행 시작"을 누르면 5초 간격으로 위치만 서버에 보내고, 그 외 정보는 전혀 전송하지 않습니다.
// 화면 조작 없이 내비게이션 앱으로 넘어가셔도 되지만, 브라우저 특성상 화면이 완전히 꺼지거나
// 다른 앱으로 오래 전환하면 전송이 잠시 멈출 수 있습니다(이번 파일럿에서 바로 이 부분도 함께
// 확인합니다 - 문제가 확인되면 정식 앱은 처음부터 네이티브로 만드는 근거 자료가 됩니다).
export default function PilotCheckinClient({
  token,
  routeNo,
  direction,
  routeName,
}: {
  token: string;
  routeNo: string;
  direction: "등원" | "하원";
  routeName: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [sentCount, setSentCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [lastAccuracy, setLastAccuracy] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);

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
    await sendEvent("출발");
    sendPing();
    timerRef.current = setInterval(sendPing, PING_INTERVAL_MS);
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
    };
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
        <p style={{ fontSize: 14, color: "#64748b", margin: 0 }}>GIA 셔틀 파일럿</p>
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
    </div>
  );
}
