"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadKakaoMaps } from "@/lib/kakaoMap";
import { useKstClock } from "@/lib/useKstClock";
import { useBoardDensity, type BoardScale } from "@/lib/useBoardDensity";
import { useIdleCursor } from "@/lib/useIdleCursor";
import { useSmartPoll } from "@/lib/useSmartPoll";

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
// 하원 시간대가 아닐 때 폴링 간격(새벽·주말 등).
const IDLE_POLL_MS = 120_000;

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
  // 오늘 실제 지나온 자취(GIA 출발 → 현재). 노선 색 실선으로 그립니다.
  trail?: { lat: number; lng: number; at?: string }[];
  stops: { id: string; seq: number; stopTime: string | null; address: string | null; lat: number | null; lng: number | null }[];
  riders: { name: string; boarded: boolean }[];
  boardedCount: number;
  expectedCount: number;
  pickupCount: number;
  absentCount: number;
  // 정류장별 도착·하차(GPS). 요청: "어디정류장에 도착 (...) 누가 내리는지".
  stopProgress?: StopProgress[];
  currentStopSeq?: number | null;
  nextStopSeq?: number | null;
  nextStopAddress?: string | null;
};
type StopProgress = {
  stopId: string;
  seq: number;
  address: string | null;
  stopTime: string | null;
  arrived: boolean;
  arrivedAt: string | null;
  alighting: string[];
};
type PickupRow = {
  name: string;
  routeNo: string | null;
  time: string | null;
  source: string | null;
  justChanged: boolean;
  afterDeparture: boolean;
};
type TestMarker = { label: string; lat: number; lng: number; at: string; fresh: boolean };

type Data = {
  label: string;
  today: string;
  school: { lat: number; lng: number } | null;
  routes: RouteRow[];
  pickups?: PickupRow[];
  testMarkers?: TestMarker[];
  gpsAlerts?: { routeNo: string; driverName: string | null }[];
};

// 노선마다 색을 줍니다. 요청: "셔틀색도 각 번호 색으로 (...) 각 번호는 지역으로 나눠져 있도록".
// 노선 목록은 sort_order(대체로 지역 묶음) 순서라, 순서대로 색상환(HSL)을 고르게 나눠주면
// 가까운 노선끼리 비슷한 계열, 전체적으로는 서로 구분되는 색이 됩니다. 48개 노선이어도 겹치지
// 않게 index로 색을 만듭니다.
function routeColorAt(i: number, total: number): string {
  const hue = Math.round((i / Math.max(1, total)) * 360);
  return `hsl(${hue}, 72%, 45%)`;
}

// 두 좌표 사이 진행 방향(북=0, 시계방향 도). 요청: "가는 방향도 알 수 있도록".
function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// 지도 위 차량 마커 - "위에서 본" 셔틀 밴(요청: "옆에서보는 모양말고 위에서 본 모양"). 밴은
// 노선 색으로 칠하고(요청: "셔틀색도 각 번호 색으로"), 진행 방향으로 회전합니다(요청: "가는
// 방향도 알 수 있도록"). 번호는 회전과 무관하게 항상 똑바로 읽히게 밴 위에 겹쳐 올립니다.
function vanMarkerHtml(routeNo: string, routeColor: string, heading: number): string {
  const n = String(routeNo).replace(/호$/, "");
  const fs = n.length >= 3 ? 11 : 15;
  // 위에서 본 밴(기본은 북쪽=위를 향함). 앞유리(연파랑)가 있는 쪽이 앞. heading만큼 회전.
  const van = `
    <svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg"
         style="transform:rotate(${Math.round(heading)}deg);transform-origin:50% 50%;display:block">
      <!-- 진행방향 화살촉 -->
      <path d="M20 0 L26 8 L14 8 Z" fill="${routeColor}"/>
      <!-- 차체 -->
      <rect x="8" y="6" width="24" height="42" rx="7" fill="${routeColor}" stroke="#111827" stroke-width="1.6"/>
      <!-- 앞유리(앞쪽) -->
      <rect x="11" y="9" width="18" height="7" rx="2.5" fill="#dbeafe" opacity="0.95"/>
      <!-- 뒷유리(뒤쪽) -->
      <rect x="12" y="40" width="16" height="4.5" rx="2" fill="#0f172a" opacity="0.35"/>
      <!-- 사이드미러 -->
      <rect x="4" y="15" width="4" height="3" rx="1.5" fill="#111827"/>
      <rect x="32" y="15" width="4" height="3" rx="1.5" fill="#111827"/>
    </svg>`;
  return `<div style="position:relative;width:40px;height:52px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))">
    ${van}
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                font-family:Arial,Helvetica,sans-serif;font-size:${fs}px;font-weight:900;color:#fff;
                text-shadow:0 0 3px rgba(0,0,0,.9),0 1px 2px rgba(0,0,0,.9)">${n}</div>
  </div>`;
}

// 전체 지도(왼쪽 overview)용 작은 점 마커 - 점 안에 노선 번호만. 요청: "전체화면에서는 그냥
// 점안에 차호수 들어있는 작은 점으로". size는 지도 축소 정도에 맞춰 조절합니다(요청: "작아지는
// 만큼 크기 작아지게").
function dotMarkerHtml(routeNo: string, color: string, size: number): string {
  const n = String(routeNo).replace(/호$/, "");
  const fs = Math.max(8, Math.round(size * (n.length >= 3 ? 0.42 : 0.52)));
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-family:Arial,Helvetica,sans-serif;font-size:${fs}px;font-weight:900;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.85)">${n}</div>`;
}

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
  offHoursLabel = null,
}: {
  token: string;
  // 자동으로 평소 대시보드로 돌아가는 시각(기본 17:30). 상단에 적어두면 "이 화면이 언제까지
  // 떠 있는지"를 지나가며 볼 수 있습니다.
  endLabel?: string;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  // [하원 종료]를 누르면 전체화면이 풀리고 평소 대시보드(CCTV 반반 배치)로 돌아갑니다.
  onEnd?: () => void;
  // 하원 시간이 아닌데 사람이 직접 켠 경우의 안내 문구.
  //
  // 담당자: "전환했을 때 하원시간이 아니라면 하원시간 아니라고 표시해주고."
  // 이 화면은 공용 모니터에 걸려 있어서, 낮에 켜져 있으면 지나가는 분들이 "지금 차가
  // 나가나?" 하고 오해합니다. 그리고 이 시간대에는 GPS가 아예 안 들어오므로(15:30~18:30만
  // 저장) 지도가 비어 있는 것도 정상입니다 - 그 사실도 함께 말해줍니다.
  offHoursLabel?: string | null;
}) {
  const [data, setData] = useState<Data | null>(null);
  // 오른쪽 화면이 노선을 하나씩 순환하며 보여줄 때 지금 몇 번째인지(요청: "각 노선별로 순환").
  const [focusIdx, setFocusIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFocusIdx((n) => n + 1), 6000);
    return () => clearInterval(t);
  }, []);
  // 일정 시간 안 움직이면 마우스 커서를 숨깁니다(요청).
  const cursorHidden = useIdleCursor(4000);
  // 하원 운행 중에는 "지금 몇 시 몇 분 몇 초"가 중요해서 여기도 초까지 보여줍니다.
  const clock = useKstClock();
  // 요청: "cctv프로그램이 너무 많이 차지해서 공간이 많이 없더라고" - 전체화면을 못 쓰는 날에는
  // 이 화면도 같은 좁은 창에 들어가므로, 창 크기에 맞춰 글자·여백을 함께 줄입니다.
  const sc = useBoardDensity("opsBoardDensity:dismissal");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // GPS 미시작 경고를 접어둘지. 기본은 접힘 - 지금은 기기가 1대뿐이라 거의 모든 노선이 걸립니다.
  const [gpsOpen, setGpsOpen] = useState(false);

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
  }, [load]);
  // 서버 호출 절감(Vercel 무료 한도): 화면이 안 보이면 멈추고, 하원 시간대(평일 14~19시)가
  // 아니면 느리게 돕니다. 대형 모니터에 하루 종일 띄워둬도 호출량이 크게 줄어듭니다.
  useSmartPoll(load, { activeMs: POLL_MS, idleMs: IDLE_POLL_MS });

  if (errorMsg && !data) return <Center text={errorMsg} />;
  if (!data) return <Center text="불러오는 중..." muted />;

  const running = data.routes.filter((r) => r.status === "운행중").length;
  const arrived = data.routes.filter((r) => r.status === "도착함").length;
  const totalBoarded = data.routes.reduce((s, r) => s + r.boardedCount, 0);
  const totalExpected = data.routes.reduce((s, r) => s + r.expectedCount, 0);

  return (
    <div style={{ height: "100dvh", background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", fontFamily: "sans-serif", cursor: cursorHidden ? "none" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: sc.s(12, 6), padding: `${sc.s(8, 5)}px ${sc.s(14, 8)}px`, flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: sc.s(20, 14), fontWeight: 800, color: "#fff" }}>🚌 하원 운행</span>
        {offHoursLabel && (
          <span
            style={{
              background: "#78350f",
              color: "#fde68a",
              borderRadius: 999,
              padding: `${sc.s(4, 3)}px ${sc.s(12, 8)}px`,
              fontSize: sc.s(13, 10),
              fontWeight: 800,
            }}
            title="이 시간대에는 GPS가 저장되지 않아 지도가 비어 있는 것이 정상입니다."
          >
            ⚠️ {offHoursLabel}
          </span>
        )}
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

      {/* GPS 미시작 경고(요청: "3:50분부터 신호가 안오면 (...) 켜달라고 안내"). 기사님이 직접
          켜고 끄는 방식이라, 켜는 걸 잊으신 노선을 여기 띄워 사무실에서 전화로 안내합니다. */}
      {(data.gpsAlerts?.length ?? 0) > 0 && (
        <div style={{ flexShrink: 0, margin: `0 ${sc.s(14, 8)}px ${sc.s(6, 4)}px`, background: "#7f1d1d", borderRadius: sc.s(10, 6), padding: `${sc.s(6, 4)}px ${sc.s(12, 8)}px`, display: "flex", alignItems: "center", gap: sc.s(8, 5), flexWrap: "wrap" }}>
          {/* 접을 수 있게.
              담당자: "GPS 미시작은 지금은 테스트라 1대 빼고 전부니까 이 항목은 접을 수 있게 해줘."
              거의 모든 노선이 걸려 있으면 경고가 아니라 배경 소음이 됩니다. 화면에서 가장 큰
              자리를 차지하면서 정작 알려주는 게 없으니, 접어두고 숫자만 남깁니다.
              나중에 기기를 다 나눠주면 몇 대만 남을 테고, 그때는 펴두고 쓰시면 됩니다. */}
          <button
            type="button"
            onClick={() => setGpsOpen((v) => !v)}
            style={{ fontSize: sc.s(15, 12), fontWeight: 900, color: "#fecaca", background: "none", border: 0, cursor: "pointer", padding: 0 }}
          >
            {gpsOpen ? "▾" : "▸"} ⚠ GPS 미시작 {(data.gpsAlerts ?? []).length}대
          </button>
          {gpsOpen && (
            <>
              <span style={{ fontSize: sc.s(13, 11), color: "#fee2e2" }}>기사님께 GPS 켜달라고 안내:</span>
              {(data.gpsAlerts ?? []).map((a, i) => (
                <span key={i} style={{ fontSize: sc.s(14, 11), fontWeight: 800, color: "#fff", background: "#991b1b", borderRadius: 999, padding: `${sc.s(2, 1)}px ${sc.s(9, 6)}px` }}>
                  {a.routeNo}호{a.driverName ? ` ${a.driverName}` : ""}
                </span>
              ))}
            </>
          )}
        </div>
      )}

      {/* 위: 지도 영역을 7:3으로 좌우 분할(요청). 왼쪽은 전체 지도(작은 번호 점), 오른쪽은 지금
          운행 중인 노선을 하나씩 순환하며 가까이(위에서 본 밴) 보여줍니다. */}
      {(() => {
        // 순환 대상: GPS가 살아있거나 오늘 자취가 있는 "지금 길 위의 노선". 없으면 전체에서 순환.
        const trackable = data.routes.filter((r) => r.pingFresh || (r.trail?.length ?? 0) > 0);
        const focusList = trackable.length > 0 ? trackable : data.routes;
        const total = focusList.length;
        // 오른쪽은 **한 칸**입니다.
        //
        // 담당자: "왼쪽 지도는 넓게 전체 노선 운행상황을 트래킹하는 거고, 오른쪽은 차량이 어느
        // 골목을 가는지 세밀한 지도를 보려는 의도라서 오른쪽 두 개 화면을 하나로 줄이고
        // 충분히 확대해줘."
        //
        // 두 칸으로 나누면 각 칸이 작아져서 골목이 안 보입니다. 넓게 보는 일은 왼쪽이 이미
        // 하고 있으니, 오른쪽은 한 칸을 크게 쓰고 순환 주기로 여러 노선을 훑는 편이 낫습니다.
        const per = 1;
        const start = total > 0 ? (focusIdx * per) % total : 0;
        const slots: (RouteRow | null)[] = [];
        for (let k = 0; k < per; k += 1) slots.push(k < total ? focusList[(start + k) % total] : null);
        const colorOf = (r: RouteRow | null) => (r ? routeColorAt(data.routes.indexOf(r), data.routes.length) : "#334155");
        return (
          <div style={{ flex: sc.narrow ? "1 1 42%" : "1 1 55%", minHeight: 0, display: "flex", gap: sc.s(8, 5), padding: `0 ${sc.s(14, 8)}px` }}>
            {/* 왼쪽(7): 전체 지도 - 작은 번호 점 */}
            <div style={{ flex: "6 1 0", minWidth: 0 }}>
              <AllRoutesMap routes={data.routes} school={data.school} testMarkers={data.testMarkers ?? []} />
            </div>
            {/* 오른쪽(4): 한 칸을 크게 - 골목이 보이도록 */}
            <div style={{ flex: "4 1 0", minWidth: 0, display: "grid", gridTemplateColumns: "1fr", gridTemplateRows: "1fr", gap: sc.s(6, 4) }}>
              {slots.map((r, k) => (
                <div key={k} style={{ minWidth: 0, minHeight: 0 }}>
                  <RouteFocusMap route={r} school={data.school} color={colorOf(r)} sc={sc} />
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 아래: 호차 요약 띠 + 픽업 학생.
          요청: "아래에 차량호수는 필요없고... 픽업하는 아이들이 누구인지 실시간으로 보여주는게
          낫다" - 호차는 탑승 진행률만 남긴 한 줄짜리 띠로 줄이고, 남는 자리를 전부 픽업 목록에
          줍니다. 하원 중에 눈으로 좇아야 하는 건 "몇 호차가 있다"가 아니라 "누가 차를 안 타는가"
          입니다. */}
      <div
        style={{
          flex: sc.narrow ? "1 1 58%" : "1 1 45%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: sc.s(8, 5),
          padding: `${sc.s(10, 6)}px ${sc.s(14, 8)}px ${sc.s(14, 8)}px`,
        }}
      >
        {data.routes.length === 0 ? (
          <p style={{ textAlign: "center", color: "#475569", fontSize: sc.s(15, 12) }}>운행 중인 하원 노선이 없습니다.</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), flexShrink: 0 }}>
            {data.routes.map((r, i) => (
              <RouteChip key={r.routeId} route={r} color={routeColorAt(i, data.routes.length)} sc={sc} />
            ))}
          </div>
        )}

        <RunningPanel routes={data.routes} sc={sc} />

        <PickupPanel pickups={data.pickups ?? []} sc={sc} />
      </div>
    </div>
  );
}

// 호차 한 줄 요약. 예전 카드에는 미탑승 학생 이름까지 들어 있어 세로로 길었는데, 하원 중에
// 정작 봐야 하는 건 "다 탔는가"와 "누가 안 타는가"입니다. 앞엣것은 이 띠가, 뒤엣것은 아래 픽업
// 목록이 맡습니다.
function RouteChip({ route: r, color, sc }: { route: RouteRow; color: string; sc: BoardScale }) {
  const st = STATUS_STYLE[r.status];
  const complete = r.expectedCount > 0 && r.boardedCount === r.expectedCount;
  return (
    <div
      title={`${r.routeNo}호${r.name ? " " + r.name : ""}${r.vehicleNo ? " · " + r.vehicleNo : ""}${r.arrivedAt ? " · 도착 " + hhmm(r.arrivedAt) : ""}${r.departedAt ? " · 출발 " + hhmm(r.departedAt) : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sc.s(6, 4),
        background: "#111c33",
        borderRadius: sc.s(10, 6),
        borderLeft: `4px solid ${color}`,
        padding: `${sc.s(5, 3)}px ${sc.s(9, 6)}px`,
      }}
    >
      <span style={{ fontSize: sc.s(17, 12), fontWeight: 900, color: "#fff" }}>{r.routeNo}</span>
      <span
        style={{
          background: st.bg,
          color: st.fg,
          fontSize: sc.s(10, 9),
          fontWeight: 800,
          padding: `1px ${sc.s(6, 4)}px`,
          borderRadius: 999,
        }}
      >
        {st.label}
      </span>
      <span style={{ fontSize: sc.s(14, 11), fontWeight: 800, color: complete ? "#34d399" : "#e2e8f0" }}>
        {r.boardedCount}/{r.expectedCount}
      </span>
      {/* GPS가 끊기면 자동 도착·출발 감지가 멈춥니다. 작게라도 계속 보여야 그날 안에 알아챕니다. */}
      <span style={{ fontSize: sc.s(9, 8), color: r.pingFresh ? "#34d399" : "#64748b" }}>{r.pingFresh ? "●" : "○"}</span>
    </div>
  );
}

// 운행 중인 차량의 "지금 어디쯤"을 GPS로 보여줍니다.
//
// 요청: "출발했다면 어느정류장으로 가고있는지, 정류장에 도착했다면 누가 내리는지". 기사님 휴대폰
// GPS가 정류장 반경에 들어오면 그 정류장을 도착으로 잡고(track), 여기서 "방금 어느 정류장에
// 닿았고 거기서 누가 내리며, 다음은 어느 정류장인지"를 한 줄로 보여줍니다. 아직 정류장 좌표가
// 학습되지 않았거나 GPS가 없는 차는 이 목록에 나타나지 않습니다(카드 띠의 도착·출발만 표시).
function RunningPanel({ routes, sc }: { routes: RouteRow[]; sc: BoardScale }) {
  // 출발했거나(운행중) 정류장 도착이 하나라도 잡힌 차만 - "지금 길 위에 있는 차"에 집중합니다.
  const active = routes
    .map((r, i) => ({ r, color: routeColorAt(i, routes.length) }))
    .filter(({ r }) => r.status === "운행중" || (r.stopProgress ?? []).some((s) => s.arrived));
  if (active.length === 0) return null;

  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: sc.s(5, 3), background: "#111c33", borderRadius: sc.s(12, 7), padding: sc.s(10, 6) }}>
      <span style={{ fontSize: sc.s(15, 12), fontWeight: 800, color: "#e2e8f0" }}>🛰️ 운행 상황 (GPS)</span>
      <div style={{ display: "flex", flexDirection: "column", gap: sc.s(5, 3), maxHeight: sc.narrow ? "34%" : undefined, overflowY: "auto" }}>
        {active.map(({ r, color }) => {
          const progress = r.stopProgress ?? [];
          const arrivedStops = progress.filter((s) => s.arrived);
          const current = arrivedStops.length ? arrivedStops[arrivedStops.length - 1] : null;
          const nextAddr = r.nextStopAddress ?? null;
          const doneCount = arrivedStops.length;
          return (
            <div key={r.routeId} style={{ display: "flex", alignItems: "flex-start", gap: sc.s(7, 5), background: "#1e293b", borderLeft: `4px solid ${color}`, borderRadius: sc.s(8, 5), padding: `${sc.s(5, 3)}px ${sc.s(9, 6)}px` }}>
              <span style={{ fontSize: sc.s(15, 12), fontWeight: 900, color: "#fff", whiteSpace: "nowrap" }}>{r.routeNo}호</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                {current ? (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: sc.s(5, 3) }}>
                    <span style={{ fontSize: sc.s(12, 10), fontWeight: 800, color: "#fdba74", whiteSpace: "nowrap" }}>
                      📍 {current.address ?? `${current.seq + 1}번째 정류장`} 도착
                    </span>
                    {current.arrivedAt && <span style={{ fontSize: sc.s(10, 9), color: "#94a3b8" }}>{hhmm(current.arrivedAt)}</span>}
                    {current.alighting.length > 0 && (
                      <span style={{ fontSize: sc.s(11, 9), color: "#cbd5e1" }}>
                        하차: <b style={{ color: "#fff" }}>{current.alighting.join(", ")}</b>
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: sc.s(12, 10), fontWeight: 700, color: "#6ee7b7" }}>출발 · 운행 중</span>
                )}
                {nextAddr && (
                  <div style={{ fontSize: sc.s(10, 9), color: "#7dd3fc", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    → 다음: {nextAddr}
                  </div>
                )}
              </div>
              {progress.length > 0 && (
                <span style={{ fontSize: sc.s(10, 9), color: "#64748b", whiteSpace: "nowrap" }}>{doneCount}/{progress.length}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 오늘 픽업하는 아이들. 이 화면에서 가장 크게 보여야 하는 정보입니다.
//
// 특히 "차가 이미 출발한 뒤에 픽업으로 바뀐" 경우를 맨 위에 빨갛게 띄웁니다 - 그건 그 아이를
// 태우고 떠났다는 뜻이라, 알아채는 것이 몇 분 늦으면 학부모가 빈 학교에서 기다리게 됩니다.
function PickupPanel({ pickups, sc }: { pickups: PickupRow[]; sc: BoardScale }) {
  const urgent = pickups.filter((p) => p.afterDeparture);
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: "#111c33",
        borderRadius: sc.s(12, 7),
        padding: sc.s(10, 6),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(8, 5), flexShrink: 0 }}>
        <span style={{ fontSize: sc.s(16, 12), fontWeight: 800, color: "#e2e8f0" }}>🚶 오늘 픽업</span>
        <span style={{ fontSize: sc.s(20, 14), fontWeight: 900, color: "#38bdf8" }}>{pickups.length}</span>
        {urgent.length > 0 && (
          <span
            style={{
              marginLeft: "auto",
              background: "#7f1d1d",
              color: "#fecaca",
              fontSize: sc.s(12, 10),
              fontWeight: 800,
              padding: `${sc.s(3, 2)}px ${sc.s(9, 6)}px`,
              borderRadius: 999,
            }}
          >
            ⚠ 출발 후 변경 {urgent.length}건 — 차량에 연락하세요
          </span>
        )}
      </div>

      {pickups.length === 0 ? (
        <p style={{ margin: 0, padding: `${sc.s(10, 6)}px 0`, fontSize: sc.s(14, 11), color: "#475569" }}>
          오늘 픽업 예정 없음
        </p>
      ) : (
        <div style={{ minHeight: 0, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), alignContent: "flex-start" }}>
          {pickups.map((p, i) => (
            <span
              key={i}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: sc.s(6, 4),
                background: p.afterDeparture ? "#7f1d1d" : p.justChanged ? "#1e3a5f" : "#1e293b",
                borderLeft: `4px solid ${p.afterDeparture ? "#ef4444" : p.justChanged ? "#38bdf8" : "#0ea5e9"}`,
                borderRadius: sc.s(8, 5),
                padding: `${sc.s(6, 4)}px ${sc.s(10, 6)}px`,
              }}
            >
              <b style={{ fontSize: sc.s(18, 13), color: "#fff" }}>{p.name}</b>
              {p.routeNo && <span style={{ fontSize: sc.s(11, 9), color: "#94a3b8" }}>{p.routeNo}호</span>}
              {p.time && <span style={{ fontSize: sc.s(13, 10), fontWeight: 800, color: "#7dd3fc" }}>{p.time}</span>}
              {p.afterDeparture && <span style={{ fontSize: sc.s(11, 9), fontWeight: 800, color: "#fecaca" }}>출발 후</span>}
              {!p.afterDeparture && p.justChanged && (
                <span style={{ fontSize: sc.s(11, 9), fontWeight: 800, color: "#7dd3fc" }}>NEW</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// 모든 노선을 한 지도에 올립니다. 운행 중인 노선은 경로선을 진하게, 나머지는 흐리게 그려서
// 지금 움직이는 차가 어디를 지나는지 한눈에 보이도록 했습니다.
function AllRoutesMap({ routes, school, testMarkers = [] }: { routes: RouteRow[]; school: { lat: number; lng: number } | null; testMarkers?: TestMarker[] }) {
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

        // 차량은 setBounds로 화면을 맞춘 뒤, 축소 정도(level)에 맞는 크기의 점으로 그립니다.
        const vehicles: { lat: number; lng: number; routeNo: string; color: string }[] = [];

        routes.forEach((r, i) => {
          const color = routeColorAt(i, routes.length);
          const active = r.status === "운행중";

          // 예상(계획) 경로선 - 실도로 캐시가 있으면 그것, 없으면 정류장을 이은 직선. 요청: "예상
          // 노선과, 지나온 노선 실선으로" - 예상 경로도 실선으로(단, 지나온 자취와 구분되게 조금
          // 연하게). 전체 노선이 보이도록 이 경로 점들도 화면 맞춤(bounds)에 넣습니다.
          const line = r.path?.length ? r.path : r.stops.map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
          if (line.length > 1) {
            const polyline = new kakao.maps.Polyline({
              path: line.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
              strokeWeight: 3,
              strokeColor: color,
              strokeOpacity: 0.45,
              strokeStyle: "solid",
            });
            polyline.setMap(map);
            overlaysRef.current.push(polyline);
            for (const p of line) { bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)); hasPoint = true; }
          }

          // 오늘 실제 지나온 자취 - 노선 색 진한 실선.
          const trail = r.trail ?? [];
          if (trail.length > 1) {
            const tline = new kakao.maps.Polyline({
              path: trail.map((p) => new kakao.maps.LatLng(p.lat, p.lng)),
              strokeWeight: active ? 7 : 6,
              strokeColor: color,
              strokeOpacity: 1,
              strokeStyle: "solid",
            });
            tline.setMap(map);
            overlaysRef.current.push(tline);
            for (const p of trail) bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
            hasPoint = true;
          }

          // 차량 위치는 모아두고, 화면을 맞춘 뒤 작은 점으로 그립니다(전체 지도에서는 점).
          if (r.ping && r.pingFresh) {
            vehicles.push({ lat: r.ping.lat, lng: r.ping.lng, routeNo: r.routeNo, color });
            bounds.extend(new kakao.maps.LatLng(r.ping.lat, r.ping.lng));
            hasPoint = true;
          }
        });

        // 테스트 기기(강경원 24시간 테스트) 위치 - 초록 점으로 별도 표시(요청: "내 위치 업무
        // 대시보드에 실시간으로"). 정규 노선과 구분되도록 색과 라벨을 다르게 둡니다.
        for (const t of testMarkers) {
          const overlay = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(t.lat, t.lng),
            content: `<div style="background:${t.fresh ? "#16a34a" : "#64748b"};color:#fff;font-size:12px;font-weight:800;padding:3px 9px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.5);white-space:nowrap">📍 ${t.label}</div>`,
            yAnchor: 1,
            zIndex: 20,
          });
          overlay.setMap(map);
          overlaysRef.current.push(overlay);
          bounds.extend(new kakao.maps.LatLng(t.lat, t.lng));
          hasPoint = true;
        }

        if (hasPoint) map.setBounds(bounds, 40, 40, 40, 40);

        // 화면을 맞춘 뒤의 축소 정도(level)로 점 크기를 정합니다. 요청: "작아지는만큼 크기
        // 작아지게" - 넓게 보일수록(level 큼) 점을 작게. 대략 level 3(가까움)=26px ~ level 9(넓음)=14px.
        const level = typeof map.getLevel === "function" ? map.getLevel() : 5;
        const dotSize = Math.max(14, Math.min(28, 34 - level * 2));
        for (const v of vehicles) {
          const overlay = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(v.lat, v.lng),
            content: dotMarkerHtml(v.routeNo, v.color, dotSize),
            xAnchor: 0.5,
            yAnchor: 0.5,
            zIndex: 10,
          });
          overlay.setMap(map);
          overlaysRef.current.push(overlay);
        }
      } catch (err) {
        if (!cancelled) setMapError(err instanceof Error ? err.message : "지도를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routes, school, testMarkers]);

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

// 오른쪽 화면 - 노선 하나만 가까이 보여줍니다(요청: "각 노선별로 순환해가면서 어디인지 (...)
// 오른쪽 화면에서 (...) 위에서 내려다보는 차화면으로"). 위에서 본 밴, 예상 경로, 지나온 자취,
// 정류장을 그리고 그 노선에 딱 맞게 확대합니다. route가 바뀌면(순환) 다시 맞춥니다.
// 부드럽게 따라가는 재생 지연(ms).
//
// 담당자: "차량 이동이 띄엄띄엄 움직이는 것 같아, 자주 멈춰 보이고."
//
// 원인은 GPS가 아니라 **그리는 방식**이었습니다. 화면이 10초마다 마지막 위치로 차를
// 순간이동시키니, 서 있다가 툭 뛰고 다시 서 있는 것처럼 보입니다. 실제로는 그 사이에도
// 계속 달리고 있었습니다.
//
// 그래서 내비게이션처럼 **조금 뒤처져서 재생**합니다. 지금 이 순간이 아니라 20초 전을
// 그리면, 그 뒤에 이미 도착해 있는 점들 사이를 시간에 비례해 채우며 지날 수 있습니다.
// "20초 늦은 부드러운 동선"이 "지금이지만 툭툭 끊기는 점"보다 운행 파악에 낫습니다.
const PLAYBACK_LAG_MS = 20000;
// 이보다 오래 비면 그 사이는 이어 그리지 않습니다(터널·음영지역). 없는 길을 지어내지 않습니다.
const PLAYBACK_MAX_GAP_MS = 180000;

type TimedPoint = { lat: number; lng: number; t: number };

// 재생 시각에 해당하는 위치를 두 점 사이에서 비례로 구합니다.
function interpolateAt(points: TimedPoint[], atMs: number): { lat: number; lng: number; heading: number } | null {
  if (points.length === 0) return null;
  if (points.length === 1 || atMs <= points[0].t) {
    return { lat: points[0].lat, lng: points[0].lng, heading: 0 };
  }
  const last = points[points.length - 1];
  if (atMs >= last.t) {
    const prev = points[points.length - 2];
    return { lat: last.lat, lng: last.lng, heading: prev ? bearingDeg(prev, last) : 0 };
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (atMs > b.t) continue;
    const span = b.t - a.t;
    // 사이가 너무 벌어졌으면(신호 끊김) 이어 그리지 않고 앞 점에 머뭅니다.
    if (span <= 0 || span > PLAYBACK_MAX_GAP_MS) return { lat: a.lat, lng: a.lng, heading: bearingDeg(a, b) };
    const r = (atMs - a.t) / span;
    return { lat: a.lat + (b.lat - a.lat) * r, lng: a.lng + (b.lng - a.lng) * r, heading: bearingDeg(a, b) };
  }
  return { lat: last.lat, lng: last.lng, heading: 0 };
}

function RouteFocusMap({ route, school, color, sc }: { route: RouteRow | null; school: { lat: number; lng: number } | null; color: string; sc: BoardScale }) {
  const divRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlaysRef = useRef<any[]>([]);
  // 매 프레임 움직이는 것들은 다시 만들지 않고 위치만 바꿉니다(다시 만들면 깜빡입니다).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vanRef = useRef<any>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  // 시각이 붙은 자취. 부드러운 재생의 재료입니다.
  const timedTrail: TimedPoint[] = useMemo(() => {
    const out: TimedPoint[] = [];
    for (const p of route?.trail ?? []) {
      if (!p.at) continue;
      const t = new Date(p.at).getTime();
      if (Number.isFinite(t)) out.push({ lat: p.lat, lng: p.lng, t });
    }
    return out;
  }, [route?.trail]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const kakao = await loadKakaoMaps();
        if (cancelled || !divRef.current) return;
        if (!mapRef.current) {
          mapRef.current = new kakao.maps.Map(divRef.current, {
            center: new kakao.maps.LatLng(school?.lat ?? 37.5108, school?.lng ?? 127.0322),
            level: 5,
          });
        }
        const map = mapRef.current;
        for (const o of overlaysRef.current) o.setMap(null);
        overlaysRef.current = [];
        if (!route) return;

        if (school) {
          const m = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(school.lat, school.lng),
            content: `<div style="background:#2563eb;color:#fff;font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap">GIA</div>`,
            yAnchor: 0.5,
          });
          m.setMap(map); overlaysRef.current.push(m);
        }

        // 예상 경로(연한 실선).
        const planned = route.path?.length ? route.path : route.stops.map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
        if (planned.length > 1) {
          const l = new kakao.maps.Polyline({ path: planned.map((p) => new kakao.maps.LatLng(p.lat, p.lng)), strokeWeight: 4, strokeColor: color, strokeOpacity: 0.5, strokeStyle: "solid" });
          l.setMap(map); overlaysRef.current.push(l);
        }
        // 정류장 점.
        const stopPts = route.stops.filter((s) => s.lat != null && s.lng != null) as { lat: number; lng: number }[];
        for (const s of stopPts) {
          const dot = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(s.lat, s.lng),
            content: `<div style="width:9px;height:9px;border-radius:999px;background:#fff;border:2px solid ${color}"></div>`,
            yAnchor: 0.5,
          });
          dot.setMap(map); overlaysRef.current.push(dot);
        }
        // 지나온 자취(진한 실선).
        const trail = route.trail ?? [];
        if (trail.length > 1) {
          const l = new kakao.maps.Polyline({ path: trail.map((p) => new kakao.maps.LatLng(p.lat, p.lng)), strokeWeight: 7, strokeColor: color, strokeOpacity: 1, strokeStyle: "solid" });
          l.setMap(map); overlaysRef.current.push(l);
        }
        // 위에서 본 밴(진행 방향).
        //
        // 이 자리는 아래 재생 루프가 매 프레임 위치를 바꿉니다. 여기서는 만들어 두기만 하고,
        // 다시 그릴 때도 지우지 않습니다(지웠다 만들면 깜빡입니다).
        if (route.ping && route.pingFresh) {
          const heading = trail.length >= 2 ? bearingDeg(trail[trail.length - 2], trail[trail.length - 1]) : 0;
          if (vanRef.current) vanRef.current.setMap(null);
          const van = new kakao.maps.CustomOverlay({
            position: new kakao.maps.LatLng(route.ping.lat, route.ping.lng),
            content: vanMarkerHtml(route.routeNo, color, heading),
            xAnchor: 0.5, yAnchor: 0.5, zIndex: 10,
          });
          van.setMap(map);
          vanRef.current = van;
        } else if (vanRef.current) {
          vanRef.current.setMap(null);
          vanRef.current = null;
        }

        // 화면 맞춤.
        //
        // 담당자: "오른쪽 화면은 차량 트래킹이라서, 차량이 항상 가운데에 있어야 해."
        //
        // 그래서 **운행 중이면 차를 화면 정중앙에 고정**합니다. 예전에는 자취와 주변
        // 정류장을 모두 담는 setBounds를 썼는데, 그러면 화면 중심이 그 덩어리의 한가운데가
        // 되어 차는 가장자리로 밀립니다. 차가 움직일수록 자취가 뒤로 길어지므로 차는 점점
        // 더 구석으로 갑니다 - 정확히 반대로 동작하고 있었습니다.
        //
        // 자취와 정류장은 그대로 그려지므로 지나온 길과 다음 정류장은 여전히 보입니다.
        // 다만 화면의 기준점이 "덩어리"가 아니라 "차"가 됩니다.
        if (route.ping && route.pingFresh) {
          // level 3 = 골목 이름까지 보이는 정도. 고정해 두어야 차가 멈췄다 움직일 때
          // 배율이 출렁이지 않습니다.
          //
          // 중심 맞추기는 아래 재생 루프가 매 프레임 합니다. 여기서 setCenter를 하면
          // 10초마다 화면이 한 번 툭 튀어 부드럽게 흐르던 것이 도로 끊깁니다.
          if (typeof map.setLevel === "function") map.setLevel(3);
        } else {
          // 아직 출발 전이면 맞출 차가 없으니 노선 전체를 보여줍니다.
          //
          // GIA는 화면 맞추기에 넣지 않습니다. 하원 차는 학교에서 점점 멀어지므로 GIA까지
          // 한 화면에 넣으려 하면 시간이 갈수록 계속 축소되고, 그러면 도로 이름이 사라져
          // "지금 어디쯤인지"를 알 수 없게 됩니다.
          const fitPts: { lat: number; lng: number }[] = [];
          for (const p of planned) fitPts.push(p);
          for (const s of stopPts) fitPts.push(s);
          if (fitPts.length > 0) {
            const b = new kakao.maps.LatLngBounds();
            for (const p of fitPts) b.extend(new kakao.maps.LatLng(p.lat, p.lng));
            map.setBounds(b, 30, 30, 30, 30);
            if (typeof map.getLevel === "function") {
              const lv = map.getLevel();
              // level 2 = 건물·골목 이름까지, 3 = 골목, 4를 넘으면 큰길만 남습니다.
              if (lv < 2) map.setLevel(2);
              else if (lv > 5) map.setLevel(5);
            }
          }
        }
      } catch {
        if (!cancelled) setMapError("지도를 불러오지 못했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [route, school, color]);

  // ── 부드러운 재생 ──────────────────────────────────────────────────────────
  //
  // 담당자: "차량 이동이 띄엄띄엄 움직이는 것 같아, 자주 멈춰 보이고. 차량 운행 동선을
  //          보는 것처럼 보여줄 수 없어?"
  //
  // GPS는 30m마다 오므로 점 사이가 몇 초씩 벌어집니다. 그 점들을 그대로 찍으면 차가
  // 뛰었다 서기를 반복합니다. 여기서는 매 프레임(초당 60번) **20초 전 시점의 위치를
  // 두 점 사이에서 비례로 계산해** 밴과 지도 중심을 함께 옮깁니다.
  //
  // 위치를 지어내는 것이 아니라, 이미 지나간 두 지점 사이를 시간에 맞춰 채우는 것입니다.
  // 그래서 20초 늦지만 실제로 지난 길 위를 벗어나지 않습니다.
  const trackingActive = !!route?.pingFresh && timedTrail.length >= 2;
  useEffect(() => {
    if (!trackingActive) return;
    let raf = 0;
    const tick = () => {
      const map = mapRef.current;
      const van = vanRef.current;
      if (map && van) {
        const pos = interpolateAt(timedTrail, Date.now() - PLAYBACK_LAG_MS);
        if (pos) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const kakao = (window as any).kakao;
          if (kakao?.maps) {
            const ll = new kakao.maps.LatLng(pos.lat, pos.lng);
            van.setPosition(ll);
            map.setCenter(ll);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackingActive, timedTrail]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 14, overflow: "hidden", background: "#1e293b" }}>
      <div ref={divRef} style={{ width: "100%", height: "100%" }} />
      {/* 20초 늦게 보여준다는 사실을 숨기지 않습니다. 도착 시각을 이 화면으로 재는 분이
          있을 수 있어서, 몇 초 차이가 나는지 알고 봐야 합니다. */}
      {trackingActive && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            right: 8,
            background: "rgba(15,23,42,.72)",
            color: "#94a3b8",
            borderRadius: 999,
            padding: "3px 9px",
            fontSize: 10,
            fontWeight: 700,
          }}
          title="GPS 점 사이를 이어 부드럽게 보여주기 위해 20초 뒤처져 재생합니다. 실제 위치는 조금 더 앞서 있습니다."
        >
          ▶ 부드럽게 재생 중 (20초 지연)
        </div>
      )}
      {/* 지금 보고 있는 노선 표시 */}
      {route && (
        <div style={{ position: "absolute", top: 8, left: 8, display: "flex", alignItems: "center", gap: 6, background: "rgba(15,23,42,.82)", borderRadius: 999, padding: `${sc.s(4, 3)}px ${sc.s(10, 7)}px` }}>
          <span style={{ width: sc.s(11, 9), height: sc.s(11, 9), borderRadius: 3, background: color }} />
          <span style={{ fontSize: sc.s(15, 12), fontWeight: 900, color: "#fff" }}>{route.routeNo}호</span>
          {route.name && <span style={{ fontSize: sc.s(11, 9), color: "#cbd5e1", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{route.name}</span>}
          <span style={{ fontSize: sc.s(11, 9), color: route.pingFresh ? "#34d399" : "#64748b" }}>{route.pingFresh ? "●GPS" : "○"}</span>
        </div>
      )}
      {!route && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: sc.s(14, 12), textAlign: "center", padding: 16 }}>
          운행 중인 노선이 없습니다
        </div>
      )}
      {mapError && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: 13 }}>{mapError}</div>
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
