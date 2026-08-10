"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";

const POLL_MS = 7000;

// PushManager.subscribe에 넘길 공개키는 base64url 문자열을 Uint8Array로 바꿔야 합니다(표준 패턴).
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type TrackDirection = {
  direction: "등원" | "하원";
  routeNo: string;
  routeName: string | null;
  departTime: string;
  stopTime: string | null;
  stopAddress: string | null;
  lastPing: { lat: number; lng: number; accuracy: number | null; recorded_at: string } | null;
  running: boolean;
  completed: boolean;
  boardingStatus: "예정" | "탑승" | "미탑승" | "결석" | "픽업";
  alighted: boolean;
  etaSeconds: number | null;
};

function formatEta(etaSeconds: number): string {
  const min = Math.max(1, Math.round(etaSeconds / 60));
  const arrival = new Date(Date.now() + etaSeconds * 1000);
  const arrivalLabel = arrival.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  return `약 ${min}분 후 도착 예정 (${arrivalLabel})`;
}

type TrackData = { studentName: string; studentNameEn: string | null; directions: TrackDirection[] };

// 학부모 테스트 조회 화면 - 로그인 없이 링크(토큰)로만 접속해, 자녀가 배정된 셔틀의 현재 위치를
// 확인합니다. 도착예정시각·자동알림은 아직 없습니다(2단계 예정) - 지금은 "지금 어디 있는지"만
// 보여주는 1단계 범위입니다(요청: "학부모는 실질적으로 연결하지는 말고 기능만 구현").
export default function ParentTrackClient({ token }: { token: string }) {
  const [data, setData] = useState<TrackData | null>(null);
  const [tab, setTab] = useState<"등원" | "하원">("등원");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pushState, setPushState] = useState<"idle" | "checking" | "subscribed" | "unsupported">("checking");
  const [pushBusy, setPushBusy] = useState(false);

  // 이미 구독돼 있는지(예: 페이지 새로고침) 조용히 확인합니다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setPushState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setPushState(existing ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setPushState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubscribe() {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setErrorMsg("알림 기능이 아직 서버에 설정되지 않았습니다.");
      return;
    }
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushBusy(false);
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      await fetch(`/api/shuttle/parent/subscribe/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setPushState("subscribed");
    } catch {
      setErrorMsg("알림 신청에 실패했습니다.");
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/shuttle/parent/track/${token}`);
        if (!res.ok) {
          if (!cancelled) setErrorMsg("조회에 실패했습니다.");
          return;
        }
        const json = (await res.json()) as TrackData;
        if (cancelled) return;
        setData(json);
        setErrorMsg(null);
        setTab((prev) => (json.directions.some((d) => d.direction === prev) ? prev : json.directions[0]?.direction ?? "등원"));
      } catch {
        if (!cancelled) setErrorMsg("조회에 실패했습니다.");
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token]);

  const current = data?.directions.find((d) => d.direction === tab) ?? null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "24px 16px",
        fontFamily: "sans-serif",
        background: "#f8fafc",
        gap: 16,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>GIA 셔틀 · 학부모 테스트 화면</p>
        <p style={{ fontSize: 22, fontWeight: 700, margin: "4px 0", color: "#0f172a" }}>
          {data?.studentName ?? "학생"} {data?.studentNameEn ? `(${data.studentNameEn})` : ""}
        </p>
      </div>

      {errorMsg && <p style={{ color: "#dc2626", fontSize: 13 }}>{errorMsg}</p>}

      {data && data.directions.length === 0 && (
        <p style={{ color: "#64748b", fontSize: 14, textAlign: "center", maxWidth: 320 }}>
          이 학생에게 배정된 노선이 아직 없습니다. 담당자에게 문의해주세요.
        </p>
      )}

      {data && data.directions.length > 1 && (
        <div style={{ display: "flex", gap: 6, background: "#e2e8f0", borderRadius: 999, padding: 3 }}>
          {data.directions.map((d) => (
            <button
              key={d.direction}
              onClick={() => setTab(d.direction)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                background: tab === d.direction ? "#fff" : "transparent",
                color: tab === d.direction ? "#0f172a" : "#64748b",
              }}
            >
              {d.direction === "등원" ? "🌅 등원" : "🌆 하원"}
            </button>
          ))}
        </div>
      )}

      {current && (
        <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: 14, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", margin: 0 }}>
              {current.routeNo}호차 {current.routeName && `· ${current.routeName}`}
            </p>
            <p style={{ fontSize: 13, margin: "4px 0 0", color: current.running ? "#1d4ed8" : current.completed ? "#059669" : "#94a3b8" }}>
              {current.running ? "🔵 운행중" : current.completed ? "✅ 운행 종료" : "대기중(운행 시작 전)"}
            </p>
            {current.stopTime && (
              <p style={{ fontSize: 12, color: "#94a3b8", margin: "2px 0 0" }}>
                내 정류장 예정 시각 {current.stopTime}
              </p>
            )}
            {current.running && current.etaSeconds != null && (
              <p style={{ fontSize: 14, fontWeight: 700, margin: "6px 0 0", color: "#0f172a" }}>
                {formatEta(current.etaSeconds)}
              </p>
            )}
            {(current.boardingStatus !== "예정" || current.alighted) && (
              <p style={{ fontSize: 13, fontWeight: 700, margin: "6px 0 0", color: "#1d4ed8" }}>
                {current.boardingStatus !== "예정" && `${current.boardingStatus} 확인됨`}
                {current.boardingStatus !== "예정" && current.alighted && " · "}
                {current.alighted && "하차 확인됨"}
              </p>
            )}
          </div>

          <ParentLiveMap lat={current.lastPing?.lat} lng={current.lastPing?.lng} />

          {pushState === "subscribed" ? (
            <p style={{ fontSize: 13, fontWeight: 700, color: "#059669", textAlign: "center", margin: 0 }}>
              🔔 알림이 켜져 있습니다 (탑승·하차 시 알림)
            </p>
          ) : pushState === "idle" ? (
            <button
              onClick={handleSubscribe}
              disabled={pushBusy}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 16px",
                fontSize: 14,
                fontWeight: 700,
                cursor: pushBusy ? "default" : "pointer",
                background: "#1d4ed8",
                color: "#fff",
                opacity: pushBusy ? 0.6 : 1,
              }}
            >
              🔔 탑승·하차 알림 받기
            </button>
          ) : null}

          <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
            지금은 테스트 화면입니다. 실제 학부모 서비스는 정식 개발 완료 후 안내드릴 예정입니다.
          </p>
        </div>
      )}
    </div>
  );
}

// PilotMonitorClient의 지도와 같은 방식(마지막 위치 하나만 표시)입니다.
function ParentLiveMap({ lat, lng }: { lat?: number; lng?: number }) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapObjRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const kakao = await loadKakaoMaps();
      if (cancelled || !mapDivRef.current) return;
      const center = new kakao.maps.LatLng(lat ?? 37.5, lng ?? 127.0);
      if (!mapObjRef.current) {
        mapObjRef.current = new kakao.maps.Map(mapDivRef.current, { center, level: 6 });
      }
      if (lat != null && lng != null) {
        const pos = new kakao.maps.LatLng(lat, lng);
        if (!markerRef.current) {
          markerRef.current = new kakao.maps.Marker({ position: pos, map: mapObjRef.current });
        } else {
          markerRef.current.setPosition(pos);
        }
        mapObjRef.current.setCenter(pos);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return (
    <div style={{ height: 260, width: "100%", borderRadius: 14, overflow: "hidden", background: "#e2e8f0" }}>
      {lat == null ? (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#94a3b8" }}>
          아직 수신된 위치가 없습니다
        </div>
      ) : (
        <div ref={mapDivRef} style={{ height: "100%", width: "100%" }} />
      )}
    </div>
  );
}
