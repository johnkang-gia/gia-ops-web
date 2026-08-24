"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { loadKakaoMaps } from "@/lib/kakaoMap";

// GPS 테스트 지도. 요청: "지도 크게 (...) 노선이 보이도록 (...) GIA에서부터 출발하면서 지나는
// 경로 선으로 트래킹 (...) 차량을 가운데 두지말고 지도를 확대하고 노선이 보이도록".
//
// 그려주는 것: GIA(학교) 마커 · 노선 계획 경로(연한 회색 점선) · 정류장 점 · 오늘 실제 이동
// 자취(진한 파란 실선) · 현재 위치 마커. 지도는 "차량 중심"이 아니라 노선 전체가 한눈에 들어오게
// 자동으로 확대/축소(fit bounds)합니다.

type Pt = { lat: number; lng: number };
type TrailPt = Pt & { speed: number | null; at: string };
type Data = {
  routeNo: string | null;
  routeName: string | null;
  label: string | null;
  deviceId: string;
  setupCode: string | null;
  alwaysOn: boolean;
  lastSeen: string | null;
  lastHitAt: string | null;
  lastHitReason: string | null;
  school: Pt | null;
  planned: Pt[];
  stops: (Pt & { seq: number; address: string | null })[];
  trail: TrailPt[];
  latest: TrailPt | null;
  live: TrailPt | null;
  count: number;
};

const POLL_MS = 5000;

function hhmmss(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function agoLabel(iso: string | null): string {
  if (!iso) return "신호 없음";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}
function reasonLabel(r: string | null): string {
  switch (r) {
    case "stored": return "위치 저장됨 ✓";
    case "out_of_window": return "하원 시간대 아님(미저장) — [24h 테스트]로 지금 확인 가능";
    case "no_coords": return "좌표 없음 — 위치 권한 확인";
    default: return "";
  }
}

export default function TestTrackClient() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
  const fittedRef = useRef(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const setupUrl =
    typeof window !== "undefined" && data?.setupCode ? `${window.location.origin}/s/${data.setupCode}` : null;

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/shuttle/track-test");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) { setErr(json.error ?? "불러오지 못했습니다."); return; }
        setErr(null);
        setData(json as Data);
      } catch { /* 잠시 후 재시도 */ }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (setupUrl) QRCode.toDataURL(setupUrl, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [setupUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !divRef.current || !data) return;
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(divRef.current, {
            center: new kakao.maps.LatLng(data.school?.lat ?? 37.5108, data.school?.lng ?? 127.0322),
            level: 6,
          });
        }
        const map = mapRef.current;
        for (const o of overlaysRef.current) o.setMap(null);
        overlaysRef.current = [];

        const bounds = new kakao.maps.LatLngBounds();
        let hasPoint = false;
        const extend = (p: Pt) => { bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)); hasPoint = true; };

        // 학교(GIA) — 노선의 출발점.
        if (data.school) {
          const m = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(data.school.lat, data.school.lng),
            content: `<div style="background:#2563eb;color:#fff;font-size:12px;font-weight:800;padding:3px 9px;border-radius:999px;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,.4)">GIA</div>`,
            yAnchor: 0.5, zIndex: 5,
          });
          m.setMap(map); overlaysRef.current.push(m); extend(data.school);
        }

        // 계획 경로(연한 회색 점선) — 노선이 대략 어디를 지나는지 참고선.
        if (data.planned.length > 1) {
          const line = new kakao.maps.Polyline({
            path: data.planned.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
            strokeWeight: 4, strokeColor: "#94a3b8", strokeOpacity: 0.55, strokeStyle: "shortdash",
          });
          line.setMap(map); overlaysRef.current.push(line);
          for (const p of data.planned) extend(p);
        }

        // 정류장 점.
        for (const s of data.stops) {
          const dot = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(s.lat, s.lng),
            content: `<div style="width:10px;height:10px;border-radius:999px;background:#fff;border:2px solid #64748b;box-shadow:0 0 0 2px #fff"></div>`,
            yAnchor: 0.5, zIndex: 6,
          });
          dot.setMap(map); overlaysRef.current.push(dot); extend(s);
        }

        // 오늘 실제 이동 자취(진한 파란 실선) — GIA에서 출발해 지나온 길.
        if (data.trail.length > 1) {
          const line = new kakao.maps.Polyline({
            path: data.trail.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
            strokeWeight: 6, strokeColor: "#2563eb", strokeOpacity: 0.9, strokeStyle: "solid",
          });
          line.setMap(map); overlaysRef.current.push(line);
          for (const p of data.trail) extend(p);
        }

        // 현재 위치.
        if (data.latest) {
          const live = !!data.live;
          const dot = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(data.latest.lat, data.latest.lng),
            content: `<div style="background:${live ? "#16a34a" : "#64748b"};color:#fff;font-size:12px;font-weight:800;padding:4px 9px;border-radius:999px;box-shadow:0 0 0 4px ${live ? "rgba(22,163,74,.25)" : "rgba(100,116,139,.2)"};white-space:nowrap">📍 ${data.routeNo ? data.routeNo + "호" : "차량"}</div>`,
            yAnchor: 1, zIndex: 10,
          });
          dot.setMap(map); overlaysRef.current.push(dot); extend(data.latest);
        }

        // 차량 중심으로 따라가지 않습니다. 노선 전체가 한눈에 보이게 한 번만 맞춥니다(요청).
        // 이후 폴링에서 매번 다시 맞추면 사용자가 확대/이동한 걸 되돌려 방해되므로, 처음 한 번만.
        if (hasPoint && !fittedRef.current) {
          map.setBounds(bounds, 48, 48, 48, 48);
          fittedRef.current = true;
        }
      } catch {
        if (!cancelled) setMapError("지도를 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [data]);

  const recent = (data?.trail ?? []).slice(-30).reverse();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-800">🛰️ GPS 테스트{data?.routeNo ? ` · ${data.routeNo}호` : ""}</h1>
          <p className="text-xs text-slate-500">
            GIA에서 출발해 지나온 길을 파란 선으로 그립니다. 지도는 노선 전체가 보이게 맞춰집니다.
          </p>
        </div>
        <button
          onClick={() => { fittedRef.current = false; setData((d) => (d ? { ...d } : d)); }}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
        >
          노선 전체 다시 맞추기
        </button>
      </div>

      {err && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{err}</p>}

      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div ref={divRef} style={{ width: "100%", height: 460, background: "#eef2f7" }} />
            {mapError && <p className="px-3 py-2 text-xs text-slate-400">{mapError}</p>}
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700">오늘 이동 기록</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{data?.count ?? 0}개 지점</span>
            </div>
            {recent.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">아직 위치 기록이 없습니다. 앱 설치 후 잠시 기다려 주세요.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {recent.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono text-slate-600">{hhmmss(p.at)}</span>
                    <span className="text-slate-400">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
                    <span className="font-semibold text-slate-500">{p.speed != null ? `${Math.round(p.speed)}km/h` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-500">실시간 상태</p>
            <div className="mt-1 flex items-center gap-2">
              <span className={"h-2.5 w-2.5 rounded-full " + (data?.live ? "bg-emerald-500" : "bg-slate-300")} />
              <span className={"text-sm font-bold " + (data?.live ? "text-emerald-600" : "text-slate-400")}>
                {data?.live ? "위치 수신 중" : "신호 대기"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">앱 신호: {agoLabel(data?.lastHitAt ?? data?.lastSeen ?? null)}</p>
            {data?.lastHitReason && reasonLabel(data.lastHitReason) && (
              <p className="mt-0.5 text-[11px] text-slate-500">{reasonLabel(data.lastHitReason)}</p>
            )}
            <p className="mt-0.5 font-mono text-[10px] text-slate-400">기기 {data?.deviceId}</p>
          </div>

          <div className="rounded-xl border border-slate-200 p-3 text-center">
            <p className="text-xs font-semibold text-slate-500">휴대폰에서 설치</p>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="설치 QR" className="mx-auto my-2 h-40 w-40" />
            ) : (
              <p className="py-6 text-xs text-slate-400">링크 준비 중…</p>
            )}
            {setupUrl && (
              <a href={setupUrl} target="_blank" rel="noreferrer" className="block break-all text-[11px] text-blue-600 underline">
                {setupUrl}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
