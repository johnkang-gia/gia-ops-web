"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import type { ShuttleStop } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kakao = any;

const DEFAULT_CENTER = { lat: 37.5172, lng: 127.0473 }; // 강남/논현 일대 기본값(좌표를 하나도 못 구했을 때)

// 주소 하나를 좌표로 변환합니다. 카카오 Geocoder는 콜백 방식이라 Promise로 감쌌습니다.
function geocodeAddress(kakao: Kakao, address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, (result: Kakao, status: string) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
      } else {
        resolve(null);
      }
    });
  });
}

export default function RouteMap({
  stops,
  direction,
  routeLabel,
}: {
  stops: ShuttleStop[]; // 이미 seq 오름차순으로 정렬되어 들어온다고 가정합니다.
  direction: "등원" | "하원";
  routeLabel: string;
}) {
  const notify = useToast();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<Kakao>(null);
  const markersRef = useRef<Kakao[]>([]);
  const lineRef = useRef<Kakao>(null);
  const clickListenerRef = useRef<Kakao>(null);

  const [localStops, setLocalStops] = useState(stops);
  const [sdkStatus, setSdkStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sdkError, setSdkError] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [pinTarget, setPinTarget] = useState<string | null>(null); // 지도를 클릭해 좌표를 지정할 정류장 id

  useEffect(() => setLocalStops(stops), [stops]);

  const missing = localStops.filter((s) => s.address && (s.lat == null || s.lng == null));
  const geocoded = localStops.filter((s) => s.lat != null && s.lng != null);

  // 지도 SDK를 불러오고, 이 노선에 속한 정류장 중 좌표가 없는 것들을 순서대로 자동 지오코딩합니다.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !mapDivRef.current) return;
        if (!mapObjRef.current) {
          mapObjRef.current = new kakao.maps.Map(mapDivRef.current, {
            center: new kakao.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
            level: 7,
          });
        }
        setSdkStatus("ready");

        // 주소는 있는데 좌표가 없는 정류장을 하나씩 지오코딩(카카오 API가 콜백 기반이라 순차 처리).
        const toGeocode = stops.filter((s) => s.address && (s.lat == null || s.lng == null));
        if (toGeocode.length > 0) {
          setGeocoding(true);
          const supabase = createClient();
          for (const s of toGeocode) {
            if (cancelled) break;
            const coord = await geocodeAddress(kakao, s.address!);
            if (coord) {
              await supabase
                .from("shuttle_stops")
                .update({ lat: coord.lat, lng: coord.lng, geocoded_at: new Date().toISOString() })
                .eq("id", s.id);
              if (!cancelled) {
                setLocalStops((prev) => prev.map((p) => (p.id === s.id ? { ...p, ...coord } : p)));
              }
            }
          }
          if (!cancelled) setGeocoding(false);
        }
      } catch (e) {
        if (!cancelled) {
          setSdkStatus("error");
          setSdkError(e instanceof Error ? e.message : "지도를 불러오지 못했습니다.");
        }
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  // 좌표가 채워질 때마다 마커/경로선을 다시 그립니다.
  useEffect(() => {
    async function render() {
      if (sdkStatus !== "ready") return;
      const kakao = await loadKakaoMaps();
      const map = mapObjRef.current;
      if (!map) return;

      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      lineRef.current?.setMap(null);
      lineRef.current = null;

      const pts = localStops.filter((s) => s.lat != null && s.lng != null);
      if (pts.length === 0) return;

      const path: Kakao[] = [];
      pts.forEach((s, i) => {
        const pos = new kakao.maps.LatLng(s.lat!, s.lng!);
        path.push(pos);
        const overlay = new kakao.maps.CustomOverlay({
          position: pos,
          yAnchor: 1,
          content: `<div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-4px)">
            <div style="background:${direction === "등원" ? "#d97706" : "#4f46e5"};color:#fff;border-radius:9999px;
              width:22px;height:22px;display:flex;align-items:center;justify-content:center;
              font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">
              ${s.seq}
            </div>
          </div>`,
        });
        overlay.setMap(map);
        markersRef.current.push(overlay);
        void i;
      });

      if (path.length >= 2) {
        const polyline = new kakao.maps.Polyline({
          path,
          strokeWeight: 3,
          strokeColor: direction === "등원" ? "#d97706" : "#4f46e5",
          strokeOpacity: 0.7,
          strokeStyle: "solid",
        });
        polyline.setMap(map);
        lineRef.current = polyline;
      }

      const bounds = new kakao.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.setBounds(bounds, 60, 60, 60, 60);
    }
    render();
  }, [localStops, sdkStatus, direction]);

  // 수동 좌표 지정 모드: 지도를 클릭하면 그 위치를 pinTarget 정류장의 좌표로 저장합니다.
  useEffect(() => {
    async function attach() {
      const kakao = await loadKakaoMaps();
      const map = mapObjRef.current;
      if (!map) return;
      if (clickListenerRef.current) {
        kakao.maps.event.removeListener(map, "click", clickListenerRef.current);
        clickListenerRef.current = null;
      }
      if (!pinTarget) return;
      const handler = async (e: Kakao) => {
        const lat = e.latLng.getLat();
        const lng = e.latLng.getLng();
        const supabase = createClient();
        const { error } = await supabase
          .from("shuttle_stops")
          .update({ lat, lng, geocoded_at: new Date().toISOString() })
          .eq("id", pinTarget);
        if (error) {
          notify("좌표를 저장하지 못했습니다: " + error.message, "error");
          return;
        }
        setLocalStops((prev) => prev.map((p) => (p.id === pinTarget ? { ...p, lat, lng } : p)));
        setPinTarget(null);
        notify("좌표를 지정했습니다.", "success");
      };
      clickListenerRef.current = handler;
      kakao.maps.event.addListener(map, "click", handler);
    }
    if (sdkStatus === "ready") attach();
  }, [pinTarget, sdkStatus, notify]);

  if (!process.env.NEXT_PUBLIC_KAKAO_MAP_KEY) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
        지도 기능을 쓰려면 카카오맵 키(NEXT_PUBLIC_KAKAO_MAP_KEY) 설정이 필요합니다.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          {routeLabel} · 정류장 {localStops.length}곳 중 좌표 {geocoded.length}곳 표시
          {geocoding && <span className="ml-1 text-amber-600">· 주소로 좌표 찾는 중…</span>}
        </p>
        {pinTarget && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            지도를 클릭해 위치를 지정하세요 · <button onClick={() => setPinTarget(null)} className="underline">취소</button>
          </span>
        )}
      </div>

      {sdkStatus === "error" ? (
        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50 p-6 text-center text-sm text-red-500">
          {sdkError || "지도를 불러오지 못했습니다."}
        </div>
      ) : (
        <div className="min-h-0 flex-[3] overflow-hidden rounded-xl border border-slate-200">
          <div ref={mapDivRef} className="h-full w-full" />
        </div>
      )}

      {missing.length > 0 && (
        <div className="max-h-32 shrink-0 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 p-2">
          <p className="text-[11px] font-semibold text-amber-700">
            ⚠️ 자동으로 위치를 못 찾은 정류장 {missing.length}곳 (동 이름만 있는 주소 등) - 눌러서 지도에 직접 표시하세요.
          </p>
          {missing.map((s) => (
            <button
              key={s.id}
              onClick={() => setPinTarget(s.id)}
              className={
                "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] transition " +
                (pinTarget === s.id ? "bg-amber-200" : "bg-white hover:bg-amber-100")
              }
            >
              <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 font-bold text-slate-600">{s.seq}</span>
              <span className="truncate text-slate-600">{s.address}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
