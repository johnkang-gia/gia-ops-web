"use client";

import { SEOUL_GU_SHAPES, SEOUL_GU_VIEWBOX } from "@/lib/seoulGuPaths";

// 서울 25개 구를 색칠된 도형으로 보여주는 간단한 지도입니다(southkorea/seoul-maps의 2013 통계청
// 간이 경계를 그대로 씀 - 어느 구에 셔틀이 안 가는지도 윤곽선으로는 보이도록 25개 구를 전부
// 그리되, 실제로 노선이 가는 구만 색이 들어갑니다(대수가 많을수록 짙은 남색). 노선이 없는
// 구는 흰 바탕에 옅은 테두리만 있어 "색이 있는 곳 = 셔틀이 가는 곳"이 한눈에 구분됩니다.
// 검색어에 안 걸리면 흐리게 표시하고, 클릭해서 선택한 구는 대수와 무관하게 주황색으로 바뀝니다.
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
    if (n === 0) return "#ffffff"; // 노선이 없는 구는 색을 비웁니다.
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
              stroke={isSelected ? "#0f172a" : "#cbd5e1"}
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
