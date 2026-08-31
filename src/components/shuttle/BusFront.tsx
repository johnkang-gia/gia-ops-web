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
//   · **오른쪽 위 와이파이** = GPS가 살아 있는가(지금 어디인지 알 수 있는가)
// 아이는 타는데 GPS가 빨간 차가 "오늘 신경 쓸 차"입니다.

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
      viewBox="0 0 64 56"
      className="h-full w-full"
      style={{ opacity: active ? 1 : 0.42 }}
      role="img"
      aria-label={`${routeNo}호 · 오늘 ${riders}명 · ${gpsLabel}`}
    >
      {/* 차체. active일 때만 테두리(stroke)를 그립니다 - 담당자 요청의 핵심 구분입니다. */}
      <rect
        x="6"
        y="6"
        width="52"
        height="40"
        rx="7"
        fill={body}
        stroke={active ? "#0F172A" : "none"}
        strokeWidth={active ? 1.6 : 0}
      />
      {/* 앞유리 */}
      <rect x="11" y="11" width="42" height="16" rx="3" fill={glass} opacity={active ? 0.92 : 1} />
      {/* 유리 가운데 기둥 - 이게 있어야 승합차처럼 보입니다 */}
      <rect x="31.2" y="11" width="1.6" height="16" fill={body} opacity="0.55" />
      {/* 앞범퍼 */}
      <rect x="10" y="37" width="44" height="5" rx="2.5" fill="#0F172A" opacity={active ? 0.18 : 0.1} />
      {/* 전조등 둘 */}
      <circle cx="15" cy="32.5" r="3" fill="#FDE68A" stroke="#0F172A" strokeOpacity={active ? 0.25 : 0} strokeWidth="0.8" />
      <circle cx="49" cy="32.5" r="3" fill="#FDE68A" stroke="#0F172A" strokeOpacity={active ? 0.25 : 0} strokeWidth="0.8" />
      {/* 바퀴 */}
      <rect x="11" y="45" width="10" height="6" rx="2" fill="#334155" opacity={active ? 1 : 0.5} />
      <rect x="43" y="45" width="10" height="6" rx="2" fill="#334155" opacity={active ? 1 : 0.5} />

      {/* 호차 - 차체 아래쪽 번호판 자리 */}
      <text
        x="32"
        y="34.5"
        textAnchor="middle"
        fontSize="10"
        fontWeight="800"
        fill={active ? "#0F172A" : "#94A3B8"}
      >
        {routeNo}
      </text>

      {/* GPS 와이파이. 오른쪽 위 모서리에 작게(담당자 지정 위치).
          호(arc) 세 개 + 점 하나 - 신호 세기 표시 그대로입니다. */}
      <g transform="translate(48.5,3.5)" opacity={gps === "live" ? 1 : 0.9}>
        <path d="M0 7 A9 9 0 0 1 12 7" fill="none" stroke={gpsColor} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M2.6 9.2 A5.6 5.6 0 0 1 9.4 9.2" fill="none" stroke={gpsColor} strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="6" cy="11.6" r="1.5" fill={gpsColor}>
          {/* 살아 있는 차만 깜박입니다. 다 깜박이면 아무것도 눈에 안 띕니다. */}
          {gps === "live" && (
            <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
          )}
        </circle>
      </g>
    </svg>
  );
}
