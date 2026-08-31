// 셔틀버스를 앞에서 본 그림.
//
// 담당자: "셔틀 개요에서 노선별 현황 각 호수 나오는 곳을 셔틀버스 앞모습 그림으로 바꿔주고,
//         연결이 되어있고 아이가 타는 버스라면 테두리선 있고 아니면 옅어지고 테두리선 없게
//         구분해주고, GPS 연결이 되었으면 그림 오른쪽 위에 작게 초록색 와이파이 표시,
//         미연결이면 빨간색으로."
//
// 왜 그림인가: 색칠한 네모 스무 개는 눈으로 훑을 때 다 같아 보입니다. 버스 모양이면 "차"라는
// 것이 한눈에 읽히고, 진한 차와 흐린 차의 차이가 글자를 읽기 전에 먼저 들어옵니다.
//
// 두 가지를 한 그림에 담습니다 - 섞으면 안 됩니다.
//   · **진하기와 테두리** = 오늘 이 차에 탈 아이가 있는가(운행하는 차인가)
//   · **지붕 위 색 막대** = GPS가 살아 있는가(지금 어디인지 알 수 있는가)
// 아이는 타는데 지붕이 빨간 차가 "오늘 신경 쓸 차"입니다.
//
// 처음에는 오른쪽 위에 작은 와이파이 아이콘을 그렸는데, 담당자가 "잘 안 보인다"고
// 했습니다 - 맞습니다. 칸 하나가 84px인데 아이콘은 그 중 12px이라, 스무 개를 늘어놓으면
// 색이 있는지조차 안 보였습니다. 지붕 막대는 **그림 폭 전체**를 쓰기 때문에 작게 줄여도
// 색이 먼저 눈에 들어옵니다. 실제 차의 표시등 자리이기도 해서 그림이 어색해지지 않습니다.

export type BusFrontProps = {
  routeNo: string;
  /** 지역 색. 지금 화면이 쓰는 노선 색을 그대로 씁니다. */
  color: string;
  /** 오늘 이 차에 타는 아이 수. 0이면 흐리게, 테두리 없이. */
  riders: number;
  gps: "live" | "idle" | "none";
};

export default function BusFront({ routeNo, color, riders, gps }: BusFrontProps) {
  const active = riders > 0;
  // 안 타는 차는 있다는 것만 알면 됩니다. 지워버리면 "그 차가 없어졌나" 싶어지므로 남기되,
  // 눈이 머물지 않도록 색을 뺍니다.
  const body = active ? color : "#E2E8F0";
  const glass = active ? "#FFFFFF" : "#F1F5F9";
  const gpsColor = gps === "live" ? "#16a34a" : gps === "idle" ? "#f59e0b" : "#dc2626";
  const gpsLabel = gps === "live" ? "GPS 연결됨" : gps === "idle" ? "GPS 신호 끊김" : "GPS 미연결";

  return (
    <svg
      viewBox="0 0 64 60"
      className="h-full w-full"
      style={{ opacity: active ? 1 : 0.42 }}
      role="img"
      aria-label={`${routeNo}호 · 오늘 ${riders}명 · ${gpsLabel}`}
    >
      {/* 지붕 경광등 = GPS 상태. 그림 폭 전체를 쓰기 때문에 칸이 작아도 색이 먼저 읽힙니다. */}
      <rect x="9" y="2" width="46" height="6" rx="3" fill={gpsColor}>
        {/* 살아 있는 차만 숨 쉬듯 깜박입니다. 다 깜박이면 아무것도 눈에 안 띕니다. */}
        {gps === "live" && <animate attributeName="opacity" values="1;0.45;1" dur="1.8s" repeatCount="indefinite" />}
      </rect>

      {/* 차체. active일 때만 테두리(stroke)를 그립니다 - 담당자 요청의 핵심 구분입니다. */}
      <rect
        x="6"
        y="10"
        width="52"
        height="40"
        rx="7"
        fill={body}
        stroke={active ? "#0F172A" : "none"}
        strokeWidth={active ? 1.6 : 0}
      />
      {/* 앞유리 */}
      <rect x="11" y="15" width="42" height="16" rx="3" fill={glass} opacity={active ? 0.92 : 1} />
      {/* 유리 가운데 기둥 - 이게 있어야 승합차처럼 보입니다 */}
      <rect x="31.2" y="15" width="1.6" height="16" fill={body} opacity="0.55" />
      {/* 앞범퍼 */}
      <rect x="10" y="41" width="44" height="5" rx="2.5" fill="#0F172A" opacity={active ? 0.18 : 0.1} />
      {/* 전조등 둘 */}
      <circle cx="15" cy="36.5" r="3" fill="#FDE68A" stroke="#0F172A" strokeOpacity={active ? 0.25 : 0} strokeWidth="0.8" />
      <circle cx="49" cy="36.5" r="3" fill="#FDE68A" stroke="#0F172A" strokeOpacity={active ? 0.25 : 0} strokeWidth="0.8" />
      {/* 바퀴 */}
      <rect x="11" y="49" width="10" height="6" rx="2" fill="#334155" opacity={active ? 1 : 0.5} />
      <rect x="43" y="49" width="10" height="6" rx="2" fill="#334155" opacity={active ? 1 : 0.5} />

      {/* 호차 - 차체 아래쪽 번호판 자리 */}
      <text
        x="32"
        y="38.5"
        textAnchor="middle"
        fontSize="10"
        fontWeight="800"
        fill={active ? "#0F172A" : "#94A3B8"}
      >
        {routeNo}
      </text>
    </svg>
  );
}
