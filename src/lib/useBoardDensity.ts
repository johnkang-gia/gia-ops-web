"use client";

import { useEffect, useState } from "react";

// 사무실 모니터에 띄우는 화면(운영 대시보드·하원 운행)의 글자·여백 크기를 창 크기에 맞춰
// 자동으로 정합니다.
//
// 왜 필요한가요?
//   요청: "cctv프로그램이 너무 많이 차지해서 공간이 많이 없더라고 반은 될줄알았는데 보니까
//   반에서 좀더 줄어들더라고, 그래도 시간표랑함께 모든정보들이 뜰 수 있도록 조정해줘"
//
//   처음에는 "화면 절반"을 가정하고 글자 크기를 숫자로 박아뒀습니다. 그런데 CCTV 프로그램이
//   절반보다 더 차지하면서 남은 폭이 좁아졌고, 그러면 아래쪽 내용이 화면 밖으로 밀려납니다.
//   대시보드는 아무도 스크롤하지 않기 때문에, 밀려난 정보는 없는 것과 같습니다.
//
// 어떻게 하나요?
//   창 크기를 재서 기준 폭(1000px) 대비 배율을 구하고, 모든 글자·여백에 그 배율을 곱합니다.
//   폭이 좁아지면 글자가 같이 작아지므로 줄바꿈이 늘지 않고, 세로로 밀려나지도 않습니다.
//   화면이 아주 크면 반대로 키워서 멀리서도 읽히게 합니다.
//
//   세로도 함께 봅니다. 폭은 넉넉한데 높이가 낮은 창(가로로 길쭉한 배치)에서는 폭만 보고
//   키웠다가 아래가 잘리기 때문에, 가로·세로 배율 중 작은 쪽을 씁니다.

export type Density = "auto" | "large" | "normal" | "small";

const BASE_WIDTH = 1000; // 이 폭일 때 배율 1.0
const BASE_HEIGHT = 900;

export type BoardScale = {
  /** 배율. 글자 크기·여백에 곱해 씁니다. */
  k: number;
  /** px 값을 배율에 맞춰 반올림합니다. 최소 크기를 넘겨 너무 작아지는 것을 막습니다. */
  s: (px: number, min?: number) => number;
  /** 좁은 창(대략 화면 40% 이하) - 두 칸으로 나누던 곳을 한 줄로 합칩니다. */
  narrow: boolean;
  density: Density;
  setDensity: (d: Density) => void;
};

const MANUAL_FACTOR: Record<Exclude<Density, "auto">, number> = {
  large: 1.15,
  normal: 1,
  small: 0.85,
};

export function useBoardDensity(storageKey: string): BoardScale {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: BASE_WIDTH, h: BASE_HEIGHT });
  const [density, setDensityState] = useState<Density>("auto");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "auto" || saved === "large" || saved === "normal" || saved === "small") setDensityState(saved);
    } catch {
      // 저장소를 못 쓰는 환경 - 자동 배율로만 동작합니다.
    }
  }, [storageKey]);

  function setDensity(d: Density) {
    setDensityState(d);
    try {
      localStorage.setItem(storageKey, d);
    } catch {
      // 무시 - 이번 세션에서는 적용됩니다.
    }
  }

  useEffect(() => {
    function measure() {
      setSize({ w: window.innerWidth, h: window.innerHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // 가로·세로 배율 중 작은 쪽을 씁니다. 둘 중 하나라도 부족하면 내용이 잘리기 때문입니다.
  const byWidth = size.w / BASE_WIDTH;
  const byHeight = size.h / BASE_HEIGHT;
  const auto = Math.min(byWidth, byHeight);

  // 0.62 아래로는 줄이지 않습니다. 그보다 작아지면 사무실에서 서서 볼 수 없는 크기가 됩니다 -
  // 그 지점부터는 글자를 줄이는 대신 목록이 안에서 스크롤되도록 두는 편이 낫습니다.
  const k = density === "auto" ? clamp(auto, 0.62, 1.35) : clamp(auto, 0.62, 1.35) * MANUAL_FACTOR[density];

  const s = (px: number, min = 9) => Math.max(min, Math.round(px * k));

  return { k, s, narrow: size.w < 820, density, setDensity };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
