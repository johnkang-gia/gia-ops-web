"use client";

import { SEOUL_GU_SHAPES, SEOUL_GU_VIEWBOX } from "@/lib/seoulGuPaths";

// 서울 25개 구를 색칠된 도형으로 보여주는 간단한 지도입니다(southkorea/seoul-maps의 2013 통계청
// 간이 경계를 그대로 씀 - 실제 셔틀 운행 지역이 강남/서초 등 남쪽에 몰려 있어도, 어느 구가
// "0대"인지도 한눈에 보이도록 25개 구를 전부 그립니다). 색은 그 구로 가는 셔틀 대수에 따라
// 옅은 회색(0대)~짙은 남색(많음)으로 칠하고, 검색어에 안 걸리면 흐리게 표시합니다.
export default function SeoulGuMap({
  counts,
  selected,
  onSelect,
  matches,
}: {
  counts: Record<string, number>;
  selected: string | null;
  onSelect: (gu: string) => void;
  matches: (gu: string) => boolean;
}) {
  const maxCount = Math.max(1, ...Object.values(counts));

  function fillFor(gu: string, isSelected: boolean) {
    if (isSelected) return "#f59e0b"; // amber-500 - 선택한 구는 대수와 무관하게 확실히 눈에 띄도록
    const n = counts[gu] ?? 0;
    if (n === 0) return "#e2e8f0"; // slate-200
    const t = n / maxCount; // 0~1
    // 옅은 하늘색(#bfdbfe) -> 짙은 남색(#1e3a8a) 보간
    const from = [191, 219, 254];
    const to = [30, 58, 138];
    const rgb = from.map((c, i) => Math.round(c + (to[i] - c) * t));
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  return (
    <svg viewBox={SEOUL_GU_VIEWBOX} className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
      {SEOUL_GU_SHAPES.map((shape) => {
        const isSelected = selected === shape.name;
        const match = matches(shape.name);
        const n = counts[shape.name] ?? 0;
        const dark = isSelected ? false : n / maxCount > 0.55;
        return (
          <g
            key={shape.name}
            onClick={() => onSelect(shape.name)}
            style={{ cursor: "pointer", opacity: match ? 1 : 0.3, transition: "opacity 0.15s" }}
          >
            <path
              d={shape.d}
              fill={fillFor(shape.name, isSelected)}
              stroke={isSelected ? "#0f172a" : "#ffffff"}
              strokeWidth={isSelected ? 3.5 : 1.5}
              style={{ transition: "fill 0.15s" }}
            />
            <text
              x={shape.labelX}
              y={shape.labelY}
              textAnchor="middle"
              style={{ pointerEvents: "none", userSelect: "none", paintOrder: "stroke", stroke: dark ? "none" : "#ffffff", strokeWidth: dark ? 0 : 3 }}
              fontSize={n > 0 || isSelected ? 15 : 13}
              fontWeight={n > 0 || isSelected ? 700 : 500}
              fill={dark ? "#ffffff" : "#1e293b"}
            >
              {shape.name.replace("구", "")}
              {n > 0 ? ` ${n}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
