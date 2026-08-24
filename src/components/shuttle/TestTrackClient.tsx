"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { loadKakaoMaps } from "@/lib/kakaoMap";

// 강경원 GPS 테스트 화면. 설치 링크(QR) + 실시간 위치 + 오늘 이동 히스토리.
// 요청: "24시간 추적한다고 하고 실시간으로 체크 (...) 히스토리처럼 남겨줘 (...) 다음날 출근해서
// 잘 되었는지 노선은 정확한지 체크".

type Ping = { lat: number; lng: number; speed: number | null; at: string };
type Data = {
  label: string;
  setupCode: string | null;
  alwaysOn: boolean;
  enabled: boolean;
  lastSeen: string | null;
  live: Ping | null;
  latest: Ping | null;
  count: number;
  history: Ping[];
};

const POLL_MS = 5000;
const GIA = { lat: 37.5108, lng: 127.0322 }; // 지도 초기 중심(카카오 지오코딩 전 대략값). 실제 기준점은 서버가 관리.

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

export default function TestTrackClient() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
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
        if (!res.ok) {
          setErr(json.error ?? "불러오지 못했습니다.");
          return;
        }
        setErr(null);
        setData(json as Data);
      } catch {
        /* 잠시 후 재시도 */
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (setupUrl) QRCode.toDataURL(setupUrl, { width: 220, margin: 1 }).then(setQr).catch(() => setQr(null));
  }, [setupUrl]);

  // 지도: 오늘 경로선 + 최신 위치 마커.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !divRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(divRef.current, {
            center: new kakao.maps.LatLng(data?.latest?.lat ?? GIA.lat, data?.latest?.lng ?? GIA.lng),
            level: 5,
          });
        }
        const map = mapRef.current;
        for (const o of overlaysRef.current) o.setMap(null);
        overlaysRef.current = [];

        const hist = data?.history ?? [];
        if (hist.length > 1) {
          const path = hist.map((p) => new kakao.maps.LatLng(p.lat, p.lng));
          const line = new kakao.maps.Polyline({ path, strokeWeight: 5, strokeColor: "#2563eb", strokeOpacity: 0.7 });
          line.setMap(map);
          overlaysRef.current.push(line);
        }
        const latest = data?.latest ?? null;
        if (latest) {
          const live = !!data?.live;
          const dot = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(latest.lat, latest.lng),
            content: `<div style="background:${live ? "#16a34a" : "#64748b"};color:#fff;font-size:12px;font-weight:800;padding:4px 9px;border-radius:999px;box-shadow:0 0 0 4px ${live ? "rgba(22,163,74,.25)" : "rgba(100,116,139,.2)"};white-space:nowrap">📍 강경원</div>`,
            yAnchor: 1,
          });
          dot.setMap(map);
          overlaysRef.current.push(dot);
          map.setCenter(new kakao.maps.LatLng(latest.lat, latest.lng));
        }
      } catch {
        if (!cancelled) setMapError("지도를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const recent = (data?.history ?? []).slice(-30).reverse();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3">
        <h1 className="text-lg font-bold text-slate-800">🛰️ GPS 테스트 (강경원)</h1>
        <p className="text-xs text-slate-500">
          내 휴대폰으로 24시간 추적 테스트. 설치 후 위치가 실시간으로 뜨는지, 다음 날 이동 경로가 정확한지 확인하세요.
        </p>
      </div>

      {err && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">{err}</p>}

      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        {/* 지도 + 히스토리 */}
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div ref={divRef} style={{ width: "100%", height: 340, background: "#eef2f7" }} />
            {mapError && <p className="px-3 py-2 text-xs text-slate-400">{mapError}</p>}
          </div>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-sm font-bold text-slate-700">오늘 이동 기록</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{data?.count ?? 0}개 지점</span>
            </div>
            {recent.length === 0 ? (
              <p className="py-4 text-center text-xs text-slate-400">아직 위치 기록이 없습니다. 앱을 설치하고 잠시 기다려 주세요.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {recent.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-1.5 text-[11px]">
                    <span className="font-mono text-slate-600">{hhmmss(p.at)}</span>
                    <span className="text-slate-400">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </span>
                    <span className="font-semibold text-slate-500">{p.speed != null ? `${Math.round(p.speed)}km/h` : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 상태 + 설치 링크 */}
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-500">실시간 상태</p>
            <div className="mt-1 flex items-center gap-2">
              <span className={"h-2.5 w-2.5 rounded-full " + (data?.live ? "bg-emerald-500" : "bg-slate-300")} />
              <span className={"text-sm font-bold " + (data?.live ? "text-emerald-600" : "text-slate-400")}>
                {data?.live ? "위치 수신 중" : "신호 대기"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">마지막 신호: {agoLabel(data?.lastSeen ?? data?.latest?.at ?? null)}</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{data?.alwaysOn ? "24시간 기록 켜짐" : "시간대 제한"}</p>
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
            <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
              휴대폰 카메라로 QR을 찍어 열고, 안내대로 Traccar Client 앱을 설치·설정하면 됩니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
