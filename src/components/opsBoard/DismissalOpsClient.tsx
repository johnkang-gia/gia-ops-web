"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useKstClock } from "@/lib/useKstClock";
import { useBoardDensity, type BoardScale } from "@/lib/useBoardDensity";

// 요청: "셔틀시작시간때(4:00)가 되면 화면이 전환되면서 실시간 셔틀 운행지도가 뜨고 지도에서 각
// 셔틀이 어떤 경로로 가고있는지 볼 수 있게 하면서, 아래쪽에는 아이들이 차량을 다 탑승했는지
// 하원차량 체크화면이 뜨고, 거기에서 몇호가 도착했고, 또 출발했는지 기사님의 핸드폰을 통해서
// 추척하고 더 정확하게 매번 자동으로 수정하도록 하는 시스템"
//
// 위: 전체 노선을 한 지도에 올리고, 기사님 휴대폰(Traccar)에서 들어오는 최신 위치로 차량 마커를
//     움직입니다. 운행 중인 노선만 경로선을 진하게 그려 어디를 지나는지 바로 보입니다.
// 아래: 노선별 카드로 도착·출발 상태와 탑승 진행률을 보여줍니다. 사람이 누른 것과 GPS가 자동으로
//     잡은 것을 구분해 표시합니다.

const POLL_MS = 10_000;

type Ping = { lat: number; lng: number; speed: number | null; recordedAt: string };
type RouteRow = {
  routeId: string;
  routeNo: string;
  name: string | null;
  vehicleNo: string | null;
  driverName: string | null;
  departTime: string | null;
  status: "대기" | "도착함" | "운행중";
  arrivedAt: string | null;
  departedAt: string | null;
  arrivedAuto: boolean;
  departedAuto: boolean;
  departedBy: string | null;
  ping: Ping | null;
  pingFresh: boolean;
  path: { lat: number; lng: number }[] | null;
  stops: { id: string; seq: number; stopTime: string | null; address: string | null; lat: number | null; lng: number | null }[];
  riders: { name: string; boarded: boolean }[];
  boardedCount: number;
  expectedCount: number;
  pickupCount: number;
  absentCount: number;
};
type Data = { label: string; today: string; school: { lat: number; lng: number } | null; routes: RouteRow[] };

// 노선마다 다른 색을 줘서 지도에서 어느 차인지 구분되게 합니다.
const ROUTE_COLORS = ["#f97316", "#22d3ee", "#a3e635", "#f472b6", "#facc15", "#818cf8", "#34d399", "#fb7185"];

const STATUS_STYLE: Record<RouteRow["status"], { bg: string; fg: string; label: string }> = {
  대기: { bg: "#1e293b", fg: "#64748b", label: "대기" },
  도착함: { bg: "#7c2d12", fg: "#fdba74", label: "도착함" },
  운행중: { bg: "#065f46", fg: "#6ee7b7", label: "운행중" },
};

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

export default function DismissalOpsClient({
  token,
  endLabel,
  isFullscreen,
  onToggleFullscreen,
  onEnd,
}: {
  token: string;
  // 자동으로 평소 대시보드로 돌아가는 시각(기본 17:30). 상단에 적어두면 "이 화면이 언제까지
  // 떠 있는지"를 지나가며 볼 수 있습니다.
  endLabel?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  // [하원 종료]를 누르면 전체화면이 풀리고 평소 대시보드(CCTV 반반 배치)로 돌아갑니다.
  onEnd?: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  // 하원 운행 중에는 "지금 몇 시 몇 분 몇 초"가 중요해서 여기도 초까지 보여줍니다.
  const clock = useKstClock();
  // 요청: "cctv프로그램이 너무 많이 차지해서 공간이 많이 없더라고" - 전체화면을 못 쓰는 날에는
  // 이 화면도 같은 좁은 창에 들어가므로, 창 크기에 맞춰 글자·여백을 함께 줄입니다.
  const sc = useBoardDensity("opsBoardDensity:dismissal");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops-board/${token}/dismissal`);
      if (!res.ok) {
        setErrorMsg("유효하지 않거나 종료된 링크입니다.");
        return;
      }
      setErrorMsg(null);
      setData((await res.json()) as Data);
    } catch {
      setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
    }
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (errorMsg && !data) return <Center text={errorMsg} />;
  if (!data) return <Center text="불러오는 중..." muted />;

  const running = data.routes.filter((r) => r.status === "운행중").length;
  const arrived = data.routes.filter((r) => r.status === "도착함").length;
  const totalBoarded = data.routes.reduce((s, r) => s + r.boardedCount, 0);
  const totalExpected = data.routes.reduce((s, r) => s + r.expectedCount, 0);

  return (
    <div style={{ height: "100dvh", background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: sc.s(12, 6), padding: `${sc.s(8, 5)}px ${sc.s(14, 8)}px`, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: sc.s(20, 14), fontWeight: 800, color: "#fff" }}>🚌 하원 운행</span>
        {clock && (
          <span style={{ fontSize: sc.s(22, 15), fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{clock}</span>
        )}
        <Chip label="운행중" value={running} color="#34d399" sc={sc} />
        <Chip label="도착함" value={arrived} color="#fdba74" sc={sc} />
        <Chip label="탑승" value={`${totalBoarded}/${totalExpected}`} color="#93c5fd" sc={sc} />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: sc.s(8, 5) }}>
          {/* 좁은 창에서는 이 안내 문구가 한 줄을 통째로 차지해 지도가 그만큼 작아집니다.
              버튼이 먼저입니다. */}
          {!sc.narrow && (
            <span style={{ fontSize: sc.s(12, 10), color: "#475569" }}>
              10초마다 자동 갱신{endLabel ? ` · ${endLabel} 자동 종료` : ""}
            </span>
          )}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              title={isFullscreen ? "전체화면 끄기" : "전체화면으로 보기"}
              style={{
                background: "transparent",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#94a3b8",
                fontSize: sc.s(13, 10),
                padding: `${sc.s(5, 3)}px ${sc.s(10, 7)}px`,
                cursor: "pointer",
              }}
            >
              {isFullscreen ? "⤡ 전체화면 끄기" : "⤢ 전체화면"}
            </button>
          )}
          {/* 요청: "하원종료버튼을 누르거나 종료시간이 되면 다시 화면 되돌리게" - 마지막 차가
              일찍 복귀한 날에는 종료 시각까지 기다리지 않고 바로 되돌릴 수 있어야 합니다.
              눌러도 오늘 하루만 종료되고, 잘못 눌렀으면 평소 화면 위쪽의 [하원 화면 다시 열기]로
              되돌아올 수 있습니다. */}
          {onEnd && (
            <button
              onClick={onEnd}
              style={{
                background: "#7f1d1d",
                border: "none",
                borderRadius: 8,
                color: "#fecaca",
                fontSize: sc.s(14, 11),
                fontWeight: 800,
                padding: `${sc.s(6, 4)}px ${sc.s(14, 9)}px`,
                cursor: "pointer",
              }}
            >
              하원 종료
            </button>
          )}
        </div>
      </div>

      {/* 위: 전체 셔틀 지도.
          좁은 창에서는 지도 비중을 줄입니다 - 폭이 좁으면 지도에 담기는 범위가 어차피 작아서
          "어디쯤인지"를 읽기 어렵고, 그보다 아래 차량 카드가 다 보이는 편이 실제로 쓸모 있습니다. */}
      <div style={{ flex: sc.narrow ? "1 1 42%" : "1 1 55%", minHeight: 0, padding: `0 ${sc.s(14, 8)}px` }}>
        <AllRoutesMap routes={data.routes} school={data.school} />
      </div>

      {/* 아래: 하원차량 체크 */}
      <div
        style={{
          flex: sc.narrow ? "1 1 58%" : "1 1 45%",
          minHeight: 0,
          overflowY: "auto",
          padding: `${sc.s(10, 6)}px ${sc.s(14, 8)}px ${sc.s(14, 8)}px`,
        }}
      >
        {data.routes.length === 0 ? (
          <p style={{ textAlign: "center", color: "#475569", fontSize: sc.s(15, 12) }}>운행 중인 하원 노선이 없습니다.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${sc.s(210, 148)}px, 1fr))`, gap: sc.s(8, 5) }}>
            {data.routes.map((r, i) => (
              <RouteCard key={r.routeId} route={r} color={ROUTE_COLORS[i % ROUTE_COLORS.length]} sc={sc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RouteCard({ route: r, color, sc }: { route: RouteRow; color: string; sc: BoardScale }) {
  const s = STATUS_STYLE[r.status];
  const pct = r.expectedCount > 0 ? Math.round((r.boardedCount / r.expectedCount) * 100) : 0;
  const complete = r.expectedCount > 0 && r.boardedCount === r.expectedCount;
  const notBoarded = r.riders.filter((x) => !x.boarded);
  // 좁은 창에서는 카드가 작아져 이름이 여덟이면 카드가 세로로 길어집니다. 몇 명이 남았는지는
  // +N으로 알 수 있으니, 이름은 줄이고 카드 개수가 다 보이는 쪽을 택합니다.
  const nameLimit = sc.narrow ? 5 : 8;

  return (
    <div style={{ background: "#111c33", borderRadius: sc.s(12, 7), padding: `${sc.s(8, 5)}px ${sc.s(10, 6)}px`, borderLeft: `5px solid ${color}`, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: sc.s(6, 4) }}>
        <span style={{ fontSize: sc.s(19, 13), fontWeight: 900, color: "#fff" }}>{r.routeNo}호</span>
        {r.vehicleNo && <span style={{ fontSize: sc.s(10, 9), color: "#64748b" }}>{r.vehicleNo}</span>}
        <span style={{ marginLeft: "auto", background: s.bg, color: s.fg, fontSize: sc.s(11, 9), fontWeight: 800, padding: `2px ${sc.s(8, 5)}px`, borderRadius: 999 }}>
          {s.label}
        </span>
      </div>
      {r.name && <div style={{ fontSize: sc.s(11, 9), color: "#94a3b8", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>}

      {/* 탑승 진행률 */}
      <div style={{ marginTop: sc.s(6, 4) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
          <span style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: complete ? "#34d399" : "#fff" }}>
            {r.boardedCount}/{r.expectedCount}
          </span>
          <span style={{ fontSize: sc.s(11, 9), color: "#64748b" }}>탑승</span>
          {complete && <span style={{ fontSize: sc.s(11, 9), color: "#34d399", fontWeight: 700 }}>완료</span>}
          {(r.pickupCount > 0 || r.absentCount > 0) && (
            <span style={{ marginLeft: "auto", fontSize: sc.s(10, 9), color: "#475569" }}>
              {r.pickupCount > 0 && `픽업 ${r.pickupCount}`}
              {r.pickupCount > 0 && r.absentCount > 0 && " · "}
              {r.absentCount > 0 && `결석 ${r.absentCount}`}
            </span>
          )}
        </div>
        <div style={{ height: sc.s(5, 3), background: "#1e293b", borderRadius: 999, marginTop: 3, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: complete ? "#10b981" : color }} />
        </div>
      </div>

      {/* 아직 안 탄 학생 */}
      {notBoarded.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: sc.s(5, 3) }}>
          {notBoarded.slice(0, nameLimit).map((x, i) => (
            <span key={i} style={{ background: "#3f1d1d", color: "#fca5a5", fontSize: sc.s(10, 9), padding: `2px ${sc.s(5, 4)}px`, borderRadius: 4 }}>
              {x.name}
            </span>
          ))}
          {notBoarded.length > nameLimit && (
            <span style={{ fontSize: sc.s(10, 9), color: "#64748b" }}>+{notBoarded.length - nameLimit}</span>
          )}
        </div>
      )}

      {/* 도착·출발 시각 + 자동 감지 여부 */}
      <div style={{ display: "flex", gap: sc.s(8, 5), marginTop: sc.s(6, 4), fontSize: sc.s(10, 9), color: "#64748b", flexWrap: "wrap" }}>
        {r.arrivedAt && (
          <span>
            도착 {hhmm(r.arrivedAt)}
            {r.arrivedAuto && <span style={{ color: "#38bdf8" }}> ·자동</span>}
          </span>
        )}
        {r.departedAt && (
          <span>
            출발 {hhmm(r.departedAt)}
            {r.departedAuto && <span style={{ color: "#38bdf8" }}> ·자동</span>}
          </span>
        )}
        <span style={{ marginLeft: "auto", color: r.pingFresh ? "#34d399" : "#475569" }}>
          {r.pingFresh ? "GPS 수신중" : "GPS 없음"}
        </span>
      </div>
    </div>
  );
}

// 모든 노선을 한 지도에 올립니다. 운행 중인 노선은 경로선을 진하게, 나머지는 흐리게 그려서
// 지금 움직이는 차가 어디를 지나는지 한눈에 보이도록 했습니다.
function AllRoutesMap({ routes, school }: { routes: RouteRow[]; school: { lat: number; lng: number } | null }) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !divRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(divRef.current, {
            center: new kakao.maps.LatLng(school?.lat ?? 37.5045, school?.lng ?? 127.0495),
            level: 7,
          });
        }
        const map = mapRef.current;

        // 이전에 그린 것을 모두 지우고 다시 그립니다(갱신 주기가 10초라 부담 없습니다).
        for (const o of overlaysRef.current) o.setMap(null);
        overlaysRef.current = [];

        const bounds = new kakao.maps.LatLngBounds();
        let hasPoint = false;

        if (school) {
          const marker = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(school.lat, school.lng),
            content: `<div style="background:#2563eb;color:#fff;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap">GIA</div>`,
            yAnchor: 0.5,
          });
          marker.setMap(map);
          overlaysRef.current.push(marker);
          bounds.extend(new kakao.maps.LatLng(school.lat, school.lng));
          hasPoint = true;
        }

        routes.forEach((r, i) => {
          const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
          const active = r.status === "운행중";

          // 경로선 - 실도로 캐시가 있으면 그것, 없으면 정류장을 이은 직선.
          const line = r.path?.length ? r.path : r.stops.map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
          if (line.length > 1) {
            const polyline = new kakao.maps.Polyline({
              path: line.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
              strokeWeight: active ? 5 : 2,
              strokeColor: color,
              strokeOpacity: active ? 0.9 : 0.25,
              strokeStyle: "solid",
            });
            polyline.setMap(map);
            overlaysRef.current.push(polyline);
          }

          // 차량 마커 - 기사님 휴대폰에서 들어온 최신 위치.
          if (r.ping && r.pingFresh) {
            const overlay = new kakao.maps.CustomOverlay({
              position: new kakao.maps.LatLng(r.ping.lat, r.ping.lng),
              content: `<div style="background:${color};color:#0f172a;font-size:13px;font-weight:900;padding:3px 9px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.5);white-space:nowrap">${r.routeNo}호</div>`,
              yAnchor: 0.5,
              zIndex: 10,
            });
            overlay.setMap(map);
            overlaysRef.current.push(overlay);
            bounds.extend(new kakao.maps.LatLng(r.ping.lat, r.ping.lng));
            hasPoint = true;
          }
        });

        if (hasPoint) map.setBounds(bounds, 40, 40, 40, 40);
      } catch (err) {
        if (!cancelled) setMapError(err instanceof Error ? err.message : "지도를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, school]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 14, overflow: "hidden", background: "#1e293b" }}>
      <div ref={divRef} style={{ width: "100%", height: "100%" }} />
      {mapError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 14, textAlign: "center", padding: 16 }}>
          {mapError}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value, color, sc }: { label: string; value: number | string; color: string; sc: BoardScale }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, background: "#1e293b", borderRadius: 999, padding: `3px ${sc.s(10, 7)}px` }}>
      <span style={{ fontSize: sc.s(11, 9), color: "#64748b" }}>{label}</span>
      <b style={{ fontSize: sc.s(15, 11), color }}>{value}</b>
    </span>
  );
}

function Center({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: muted ? "#64748b" : "#e2e8f0", fontSize: 20 }}>
      {text}
    </div>
  );
}
