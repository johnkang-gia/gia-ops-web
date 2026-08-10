"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";

const POLL_MS = 7000;

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
};

type TrackData = { studentName: string; studentNameEn: string | null; directions: TrackDirection[] };

// 학부모 테스트 조회 화면 - 로그인 없이 링크(토큰)로만 접속해, 자녀가 배정된 셔틀의 현재 위치를
// 확인합니다. 도착예정시각·자동알림은 아직 없습니다(2단계 예정) - 지금은 "지금 어디 있는지"만
// 보여주는 1단계 범위입니다(요청: "학부모는 실질적으로 연결하지는 말고 기능만 구현").
export default function ParentTrackClient({ token }: { token: string }) {
  const [data, setData] = useState<TrackData | null>(null);
  const [tab, setTab] = useState<"등원" | "하원">("등원");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
            {(current.boardingStatus !== "예정" || current.alighted) && (
              <p style={{ fontSize: 13, fontWeight: 700, margin: "6px 0 0", color: "#1d4ed8" }}>
                {current.boardingStatus !== "예정" && `${current.boardingStatus} 확인됨`}
                {current.boardingStatus !== "예정" && current.alighted && " · "}
                {current.alighted && "하차 확인됨"}
              </p>
            )}
          </div>

          <ParentLiveMap lat={current.lastPing?.lat} lng={current.lastPing?.lng} />

          <p style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
            지금은 테스트 화면이라 도착예정시각·알림은 아직 표시되지 않습니다. 실제 서비스는 정식 개발 완료 후 안내드릴 예정입니다.
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
