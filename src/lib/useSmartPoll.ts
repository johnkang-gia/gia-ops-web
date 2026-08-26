"use client";

import { useEffect, useRef } from "react";

// 서버 호출량을 줄이기 위한 공용 폴링 훅(Vercel 무료 한도 초과 대응).
//
// 안내보드·도착체크·운영 대시보드는 대형 모니터에 하루 종일 띄워두는 화면이라, 3~15초마다
// 쉬지 않고 서버를 부르면 하루 수만 번이 됩니다. 실제로 그 화면들이 "빨라야 하는" 시간은
// 하원 시간대(평일 오후)뿐이고, 새벽이나 주말에는 몇 분에 한 번이면 충분합니다.
//
// 이 훅은 세 가지로 호출을 줄입니다.
//  ① 화면이 안 보이면(다른 탭·최소화) 아예 멈춥니다. 다시 보이면 즉시 한 번 부르고 재개합니다.
//  ② 하원 시간대(기본 평일 14~19시 KST)에는 activeMs, 그 밖에는 idleMs로 느리게 돕니다.
//  ③ 창을 다시 포커스하면 한 번 새로고침해, 느린 주기여도 화면이 낡아 보이지 않습니다.
export type SmartPollOptions = {
  /** 하원 시간대(평일 오후) 폴링 간격(ms) */
  activeMs: number;
  /** 그 외 시간 폴링 간격(ms). 기본은 activeMs의 10배(최소 2분). */
  idleMs?: number;
  /** 활성 시간대 시작/끝(KST 24시 기준). 기본 14~19시. */
  activeFromHour?: number;
  activeToHour?: number;
  /** 주말에도 활성 시간대를 적용할지(기본 false - 주말은 항상 느리게). */
  activeOnWeekend?: boolean;
  /** false면 폴링을 아예 하지 않습니다. */
  enabled?: boolean;
};

function kstHourAndDay(): { hour: number; minute: number; day: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hour: Number(p.find((x) => x.type === "hour")?.value ?? "0"),
    minute: Number(p.find((x) => x.type === "minute")?.value ?? "0"),
    day: map[p.find((x) => x.type === "weekday")?.value ?? "Mon"] ?? 1,
  };
}

// 훅을 쓰기 어려운 자리(useEffect 안에서 poll을 정의한 기존 코드)를 위한 계산 전용 헬퍼입니다.
// 하원 시간대(평일 14~19시 KST)면 activeMs, 그 밖에는 idleMs를 돌려줍니다.
export function pollDelay(activeMs: number, idleMs: number, fromHour = 14, toHour = 19): number {
  const { hour, minute, day } = kstHourAndDay();
  const weekday = day >= 1 && day <= 5;
  if (weekday && hour >= fromHour && hour < toHour) return activeMs;

  // 쉬는 동안 길게 자되, 다음 시작 시각을 넘겨서 자지는 않습니다.
  // (useSmartPoll과 같은 이유 - 15분씩 자면 15:50 하원 시작을 놓치고 16:05에 깨어납니다.)
  const nowMin = hour * 60 + minute;
  const startMin = fromHour * 60;
  const untilStartMin = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin;
  return Math.min(idleMs, untilStartMin * 60 * 1000 + 1000);
}

export function useSmartPoll(fn: () => void | Promise<void>, opts: SmartPollOptions) {
  const {
    activeMs,
    idleMs = Math.max(activeMs * 10, 120_000),
    activeFromHour = 14,
    activeToHour = 19,
    activeOnWeekend = false,
    enabled = true,
  } = opts;

  // 콜백은 매 렌더마다 새로 만들어지는 경우가 많아, ref에 담아두고 타이머는 다시 만들지 않습니다.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const currentDelay = () => {
      const { hour, minute, day } = kstHourAndDay();
      const weekday = day >= 1 && day <= 5;
      const inWindow = hour >= activeFromHour && hour < activeToHour;
      if (inWindow && (weekday || activeOnWeekend)) return activeMs;

      // 쉬는 시간에는 아주 띄엄띄엄 돌되, 근무 시작 시각을 넘겨서 자지는 않습니다.
      //
      // 밤에 30분씩 자면 호출은 거의 없어져서 좋은데, 그 상태로 두면 06:45에 잠든 화면이
      // 07:15에야 깨어나 근무 시작 15분 동안 낡은 화면을 띄우고 있게 됩니다. 그래서 다음
      // 근무 시작까지 남은 시간과 견줘 더 짧은 쪽으로 잡습니다 - 07:00 정각에 깨어납니다.
      // (자정을 넘겨야 하는 경우는 하루를 더해 계산합니다.)
      const nowMin = hour * 60 + minute;
      const startMin = activeFromHour * 60;
      const untilStartMin = nowMin < startMin ? startMin - nowMin : 24 * 60 - nowMin + startMin;
      return Math.min(idleMs, untilStartMin * 60 * 1000 + 1000);
    };

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        // 화면이 안 보이면 이번 차례는 건너뜁니다(호출 자체를 하지 않음).
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          try {
            await fnRef.current();
          } catch {
            /* 다음 차례에 다시 시도 */
          }
        }
        schedule();
      }, currentDelay());
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      // 돌아왔을 때 화면이 낡아 보이지 않도록 즉시 한 번.
      void fnRef.current();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, activeMs, idleMs, activeFromHour, activeToHour, activeOnWeekend]);
}
