"use client";

import { useEffect, useState } from "react";

// 점심시간 표시.
//
// 요청: "점심시간표시도 해줘 점심시간의 경우 카운터 형식으로 시간표 화면에 뜨도록 해주고,
// 숫자로 보기보단 시각적으로 점심시간은 표시해줬으면 좋겠어"
//
// 그래서 큰 고리(도넛)가 시간이 갈수록 줄어듭니다. 멀리서도 "얼마나 남았나"를 눈으로
// 가늠할 수 있어야 해서, 숫자는 고리 안에 작게만 둡니다. 숫자를 크게 하면 결국 숫자를
// 읽게 되고, 그러면 굳이 화면에 띄울 이유가 없습니다.
//
// 끝나갈수록 색이 바뀝니다. 넉넉할 때는 초록, 10분 남으면 노랑, 3분 남으면 빨강.
// 정리할 때가 됐다는 것을 색만 보고도 알 수 있습니다.

function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function LunchCountdown({
  startTime,
  endTime,
  label,
  size,
}: {
  startTime: string;
  endTime: string;
  label: string;
  /** 고리 지름(px). 화면 크기에 맞춰 바깥에서 정합니다. */
  size: number;
}) {
  // 1초마다 다시 그립니다. 남은 시간이 멈춰 있으면 화면이 죽은 것처럼 보입니다.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const start = hhmmToMinutes(startTime);
  const end = hhmmToMinutes(endTime);
  const total = Math.max(1, end - start);
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const left = Math.max(0, Math.min(total, end - nowMin));
  const ratio = left / total;

  const leftMin = Math.floor(left);
  const leftSec = Math.floor((left - leftMin) * 60);

  const color = left <= 3 ? "#ef4444" : left <= 10 ? "#f59e0b" : "#22c55e";

  // 고리
  const stroke = Math.max(8, Math.round(size * 0.09));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: Math.round(size * 0.06),
        height: "100%",
      }}
    >
      <div style={{ fontSize: Math.round(size * 0.16), fontWeight: 800, color: "#fbbf24", letterSpacing: 2 }}>
        🍚 {label}
      </div>

      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
            style={{ transition: "stroke-dashoffset 1s linear, stroke 0.6s" }}
          />
        </svg>
        {/* 숫자는 고리 안에 작게. 눈으로 먼저 가늠하고, 정확히 알고 싶을 때만 읽습니다. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: Math.round(size * 0.22),
              fontWeight: 800,
              color,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {leftMin}:{String(leftSec).padStart(2, "0")}
          </span>
          <span style={{ fontSize: Math.round(size * 0.08), color: "#64748b", marginTop: 4 }}>남음</span>
        </div>
      </div>

      <div style={{ fontSize: Math.round(size * 0.09), color: "#64748b" }}>
        {startTime} ~ {endTime}
      </div>
    </div>
  );
}
