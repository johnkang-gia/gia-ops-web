"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { haversineMeters } from "@/lib/shuttleRecommend";
import { convergence, directionLabel, precisionGrade, LEARN_WINDOW_DAYS } from "@/lib/shuttleStopLearn";
import { kstDateOffset } from "@/lib/kst";
import type { ShuttleStop } from "@/lib/types";

/**
 * **정류장 학습 지도** — 등록 주소와 실제 정차 자리를 한 지도에서 견줍니다.
 *
 * 지입차라 하차 장소를 기사님께 맡길 수밖에 없고, 실제로 어디서 내려주는지는 GPS로만 알 수
 * 있습니다. 그런데 화면에는 「기존 좌표와 85m 차이」라는 숫자와 카카오맵 링크(학습 점 하나)뿐
 * 이라, **어디서 어디로 85m인지, 매일 같은 자리인지, 날이 갈수록 모이고 있는지**를 볼 수
 * 없었습니다.
 *
 * 지도에 함께 그리는 것:
 *   · 회색 「주소」 — 등록된 주소를 지금 지도에서 찾은 자리
 *   · 파란 「실제」 — GPS로 학습한 정차 자리(그날그날 선 자리의 중앙값)
 *   · 작은 점 — 날마다 실제로 선 자리. 최근일수록 진합니다
 *   · 옅은 원 — 매일 선 자리의 퍼짐(중앙값). 작을수록 매일 같은 자리입니다
 *
 * 옆 목록에는 실제 정차 자리의 **도로명 주소**를 적습니다 - 「주소에서 남쪽 85m」보다 「논현로
 * 123 앞」이 기사님과 학부모께 바로 쓸 수 있는 말입니다.
 */

type Obs = {
  id: number;
  lat: number;
  lng: number;
  service_date: string;
  dwell_seconds: number | null;
  sample_count: number | null;
  matched_stop_id: string | null;
  assigned_by_human: boolean | null;
  verdict: string | null;
};

type Pt = { lat: number; lng: number };

export default function StopLearnMapModal({
  routeId,
  routeLabel,
  focusStopId,
  onClose,
  onChanged,
}: {
  routeId: string;
  routeLabel: string;
  focusStopId?: string | null;
  onClose: () => void;
  /** 반영·재계산으로 정류장 좌표가 바뀌었을 때. 바깥 목록이 다시 읽습니다. */
  onChanged?: () => void;
}) {
  const [stops, setStops] = useState<ShuttleStop[] | null>(null);
  const [obs, setObs] = useState<Obs[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(focusStopId ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** 주소 → 지도 좌표(그 자리에서 찾음), 실제 정차 → 도로명 주소. 정류장 번호로 담아 둡니다. */
  const [addrPt, setAddrPt] = useState<Record<string, Pt | null>>({});
  const [gpsAddr, setGpsAddr] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    const supabase = createClient();
    const since = kstDateOffset(-LEARN_WINDOW_DAYS);
    const [s, o] = await Promise.all([
      supabase.from("shuttle_stops").select("*").eq("route_id", routeId).order("seq"),
      supabase
        .from("shuttle_stop_observations")
        .select("id, lat, lng, service_date, dwell_seconds, sample_count, matched_stop_id, assigned_by_human, verdict")
        .eq("route_id", routeId)
        .gte("service_date", since)
        .order("service_date"),
    ]);
    // 못 읽은 채로 빈 지도를 띄우면 「아직 관측이 없구나」로 읽힙니다. 다른 말입니다.
    if (s.error || o.error) return setError((s.error ?? o.error)?.message ?? "읽지 못했습니다.");
    setStops((s.data as ShuttleStop[] | null) ?? []);
    setObs((o.data as Obs[] | null) ?? []);
  }, [routeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const runDays = useMemo(() => new Set(obs.map((o) => o.service_date)).size, [obs]);
  const obsOf = useCallback((stopId: string) => obs.filter((o) => o.matched_stop_id === stopId && (o.verdict === "stop" || o.assigned_by_human)), [obs]);

  // ── 주소 찾기(정방향) · 실제 정차 주소(역방향) ─────────────────────────────
  useEffect(() => {
    if (!stops) return;
    let alive = true;
    void (async () => {
      try {
        const kakao = await loadKakaoMaps();
        const geocoder = new kakao.maps.services.Geocoder();
        for (const s of stops) {
          if (s.address && !(s.id in addrPt)) {
            await new Promise<void>((done) =>
              geocoder.addressSearch(s.address, (res: { x: string; y: string }[], status: string) => {
                if (alive) setAddrPt((p) => ({ ...p, [s.id]: status === kakao.maps.services.Status.OK && res[0] ? { lat: Number(res[0].y), lng: Number(res[0].x) } : null }));
                done();
              }),
            );
          }
          if (s.gps_lat != null && s.gps_lng != null && !(s.id in gpsAddr)) {
            await new Promise<void>((done) =>
              geocoder.coord2Address(s.gps_lng, s.gps_lat, (res: { road_address?: { address_name: string; building_name?: string } | null; address?: { address_name: string } }[], status: string) => {
                const r = status === kakao.maps.services.Status.OK ? res[0] : null;
                const name = r ? (r.road_address ? `${r.road_address.address_name}${r.road_address.building_name ? ` (${r.road_address.building_name})` : ""}` : r.address?.address_name ?? null) : null;
                if (alive) setGpsAddr((p) => ({ ...p, [s.id]: name }));
                done();
              }),
            );
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops]);

  // ── 지도 ───────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layersRef = useRef<any[]>([]);

  useEffect(() => {
    if (!stops || !divRef.current) return;
    let alive = true;
    void (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (!alive || !divRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(divRef.current, { center: new kakao.maps.LatLng(37.5108, 127.0322), level: 5 });
        }
        const map = mapRef.current;
        for (const l of layersRef.current) l.setMap(null);
        layersRef.current = [];
        const bounds = new kakao.maps.LatLngBounds();
        let any = false;
        const ext = (p: Pt) => {
          bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
          any = true;
        };
        const put = (p: Pt, html: string, z: number, yAnchor = 0.5) => {
          const o = new kakao.maps.CustomOverlay({ position: new kakao.maps.LatLng(p.lat, p.lng), content: html, yAnchor, zIndex: z });
          o.setMap(map);
          layersRef.current.push(o);
        };

        const shown = selected ? stops.filter((s) => s.id === selected) : stops;
        const dates = [...new Set(obs.map((o) => o.service_date))].sort();
        for (const s of shown) {
          const a = addrPt[s.id] ?? (s.lat != null && s.lng != null && s.gps_lat == null ? { lat: s.lat, lng: s.lng } : null);
          const g = s.gps_lat != null && s.gps_lng != null ? { lat: s.gps_lat, lng: s.gps_lng } : null;
          const big = !!selected;

          // 날마다 선 자리 — 최근일수록 진하게.
          if (big) {
            for (const o of obsOf(s.id)) {
              const age = dates.length > 1 ? dates.indexOf(o.service_date) / (dates.length - 1) : 1;
              const alpha = (0.25 + 0.75 * age).toFixed(2);
              put(
                o,
                `<div title="${o.service_date} · ${o.dwell_seconds ?? "?"}초${o.assigned_by_human ? " · 사람이 지정" : ""}" style="width:10px;height:10px;border-radius:999px;background:rgba(37,99,235,${alpha});border:1px solid #fff"></div>`,
                4,
              );
              ext(o);
            }
            if (g && s.gps_spread_m != null && s.gps_spread_m > 0) {
              const c = new kakao.maps.Circle({
                center: new kakao.maps.LatLng(g.lat, g.lng),
                radius: s.gps_spread_m,
                strokeWeight: 1,
                strokeColor: "#2563eb",
                strokeOpacity: 0.6,
                fillColor: "#3b82f6",
                fillOpacity: 0.08,
              });
              c.setMap(map);
              layersRef.current.push(c);
            }
          }
          if (a && g) {
            const line = new kakao.maps.Polyline({
              path: [new kakao.maps.LatLng(a.lat, a.lng), new kakao.maps.LatLng(g.lat, g.lng)],
              strokeWeight: big ? 3 : 2,
              strokeColor: "#f97316",
              strokeOpacity: 0.9,
              strokeStyle: "shortdash",
            });
            line.setMap(map);
            layersRef.current.push(line);
          }
          if (a) {
            put(a, `<div style="background:#fff;color:#475569;border:2px solid #94a3b8;font-size:11px;font-weight:800;padding:1px 7px;border-radius:999px;white-space:nowrap">${s.seq} 주소</div>`, 6, 1.2);
            ext(a);
          }
          if (g) {
            put(g, `<div style="background:#2563eb;color:#fff;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.35)">${s.seq} 실제</div>`, 8, -0.2);
            ext(g);
          }
        }
        if (any) map.setBounds(bounds, 40, 40, 40, 40);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [stops, obs, selected, addrPt, obsOf]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function call(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const res = await fetch("/api/shuttle/tracker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; stopsUpdated?: number };
    setBusy(false);
    if (!res.ok) {
      setNote(null);
      setError(j.error ?? "저장하지 못했습니다.");
      return false;
    }
    setError(null);
    if (typeof j.stopsUpdated === "number") setNote(`다시 계산했습니다 — 정류장 ${j.stopsUpdated}곳 갱신`);
    return true;
  }

  async function apply(s: ShuttleStop) {
    if (await call({ action: "apply_gps", stopId: s.id })) {
      setNote(`${s.seq}번 정류장 좌표를 실제 정차 자리로 바꿨습니다.`);
      await load();
      onChanged?.();
    }
  }
  async function relearn() {
    if (await call({ action: "relearn", routeId })) {
      setGpsAddr({});
      await load();
      onChanged?.();
    }
  }

  const sel = stops?.find((s) => s.id === selected) ?? null;
  const trend = useMemo(() => (sel ? convergence(obsOf(sel.id)) : []), [sel, obsOf]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <b className="text-sm text-slate-800">📍 {routeLabel} 정류장 학습 지도</b>
          <span className="text-[11px] text-slate-500">최근 {LEARN_WINDOW_DAYS}일 · 운행 {runDays}일 기록</span>
          <button
            onClick={() => void relearn()}
            disabled={busy}
            className="ml-auto rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-40"
            title="이 호차의 정류장 좌표를 지금 다시 셉니다. 정차를 정류장에 골라 준 뒤 바로 결과를 볼 때 누르세요."
          >
            {busy ? "계산 중…" : "↻ 지금 다시 계산"}
          </button>
          <button onClick={onClose} className="px-1 text-lg font-bold text-slate-400 hover:text-slate-700" title="닫기 (Esc)">
            ✕
          </button>
        </div>
        {error && <p className="mx-3 mt-2 whitespace-pre-line rounded-lg bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700">{error}</p>}
        {note && <p className="mx-3 mt-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700">{note}</p>}

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-5">
          {/* ── 정류장 목록 ─────────────────────────────────────────── */}
          <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-2 md:col-span-2">
            <button
              onClick={() => setSelected(null)}
              className={"mb-1 w-full rounded-lg px-2 py-1 text-left text-[11px] font-bold " + (!selected ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600")}
            >
              전체 정류장 한눈에
            </button>
            {!stops && <p className="p-4 text-center text-xs text-slate-400">읽는 중…</p>}
            {(stops ?? []).map((s) => {
              const a = addrPt[s.id] ?? null;
              const g = s.gps_lat != null && s.gps_lng != null ? { lat: s.gps_lat, lng: s.gps_lng } : null;
              const dist = a && g ? Math.round(haversineMeters(a.lat, a.lng, g.lat, g.lng)) : null;
              const grade = g ? precisionGrade(s.gps_spread_m, s.gps_day_count) : null;
              const applied = g && s.lat != null && s.lng != null && haversineMeters(s.lat, s.lng, g.lat, g.lng) <= 10;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={
                    "mb-1 w-full rounded-lg border px-2 py-1.5 text-left text-[11px] " +
                    (selected === s.id ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50")
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <b className="text-[12px] text-slate-800">{s.seq}번</b>
                    {grade ? (
                      <span
                        className={
                          "rounded px-1 text-[10px] font-bold " +
                          (grade.tone === "good" ? "bg-emerald-100 text-emerald-700" : grade.tone === "mid" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500")
                        }
                      >
                        {grade.label}
                      </span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-400">아직 학습 전</span>
                    )}
                    {applied && <span className="text-[10px] font-bold text-emerald-700">✓ 반영됨</span>}
                  </div>
                  <div className="truncate text-slate-500">📮 {s.address ?? "(주소 없음)"}</div>
                  {g && (
                    <>
                      <div className="truncate font-semibold text-blue-800">🚐 {gpsAddr[s.id] ?? "실제 정차 자리 주소 찾는 중…"}</div>
                      <div className="text-slate-500">
                        {dist != null ? (
                          <span className={dist > 100 ? "font-bold text-orange-600" : ""}>
                            주소에서 {directionLabel(a!, g)} {dist}m
                          </span>
                        ) : (
                          "주소 위치를 못 찾음"
                        )}
                        {" · "}
                        {runDays > 0 ? `${runDays}일 중 ${s.gps_day_count ?? 0}일` : ""}
                        {s.gps_spread_m != null ? ` · 매일 ±${s.gps_spread_m}m` : ""}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── 지도 + 선택한 정류장 ────────────────────────────────────── */}
          <div className="flex min-h-0 flex-col md:col-span-3">
            <div ref={divRef} className="min-h-[260px] flex-1 bg-slate-100" />
            <div className="border-t border-slate-200 p-2 text-[11px]">
              <div className="mb-1 flex flex-wrap gap-3 text-slate-500">
                <span>
                  <b className="rounded-full border-2 border-slate-400 px-1.5 text-slate-600">주소</b> 등록 주소 자리
                </span>
                <span>
                  <b className="rounded-full bg-blue-600 px-1.5 text-white">실제</b> GPS로 찾은 정차 자리
                </span>
                <span>● 날마다 선 자리(최근일수록 진함)</span>
                <span>◯ 매일 선 자리의 퍼짐</span>
              </div>
              {sel && (
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-slate-800">{sel.seq}번</b>
                  {/* 날이 갈수록 모이고 있는가. 하루씩 더하며 그때까지의 중심이 지금 중심에서 얼마였나. */}
                  {trend.length > 1 ? (
                    <span className="flex items-end gap-0.5" title="날짜순으로 하루씩 더했을 때 그때까지의 정차 중심이 지금 중심에서 떨어져 있던 거리. 0에 붙으면 수렴한 것입니다.">
                      <span className="mr-1 text-slate-500">수렴</span>
                      {trend.map((t) => (
                        <span key={t.date} className="flex flex-col items-center">
                          <span
                            className={"w-2.5 rounded-sm " + (t.offM <= 10 ? "bg-emerald-500" : t.offM <= 40 ? "bg-amber-400" : "bg-rose-400")}
                            style={{ height: `${Math.max(3, Math.min(28, t.offM / 3))}px` }}
                          />
                        </span>
                      ))}
                      <span className="ml-1 text-slate-500">
                        첫날 {trend[0].offM}m → 지금 {trend[trend.length - 1].offM}m
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-400">관측이 이틀 이상 쌓이면 수렴 추이가 보입니다.</span>
                  )}
                  {sel.gps_lat != null && (
                    <>
                      <a
                        href={`https://map.kakao.com/link/roadview/${sel.gps_lat},${sel.gps_lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-600"
                        title="실제 정차 자리를 거리뷰로 봅니다 - 어느 건물 앞인지 눈으로 확인"
                      >
                        거리뷰
                      </a>
                      <button
                        onClick={() => void apply(sel)}
                        disabled={busy}
                        className="ml-auto rounded-lg bg-blue-600 px-2.5 py-1 font-bold text-white disabled:opacity-40"
                        title="이 정류장 좌표를 실제 정차 자리로 바꿉니다(주소 글자는 그대로 둡니다)"
                      >
                        실제 자리로 반영
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
