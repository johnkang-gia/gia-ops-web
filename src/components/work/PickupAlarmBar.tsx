"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * **5분 전 알림** — 곧 데리러 오는 아이를 화면 맨 위에 띄웁니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 픽업 연락은 아침에 오고 아이는 오후에 나갑니다. 그 사이 몇 시간 동안 목록 어딘가에 조용히
 * 적혀 있을 뿐이라, 그 시각이 되면 아무 일도 일어나지 않습니다. 사람이 기억하고 있어야만
 * 아이가 제때 나가고, 잊으면 **아무 오류도 없이** 아이가 교실에 남습니다.
 *
 * 사무실 대형 모니터에는 이 알람이 있었는데, 그건 아무도 안 볼 때가 있습니다. 사람이 실제로
 * 앉아서 보는 화면은 업무보드입니다.
 *
 * ── 무엇을 띄우나 ────────────────────────────────────────────────────
 *
 * 30분 안쪽이면 조용히 한 줄, **5분 안쪽이면 빨갛게** 뜹니다. 지금 어느 교실에 있는지도
 * 함께 적습니다 - 데리러 가야 하는 사람에게는 그게 이름 다음으로 필요한 정보입니다.
 *
 * 판단은 서버(/api/work/pickup-alarms) 한 곳에서 합니다. 화면이 다시 계산하면 대형 모니터와
 * 업무보드가 다른 답을 내고, 그러면 어느 쪽이 맞는지 아무도 모릅니다.
 */

type Alarm = { key: string; name: string; time: string; className: string | null; where: string; via: string | null };

/** 얼마나 앞두고 띄울 것인가. 30분은 «준비할 수 있는 시간», 5분은 «지금 움직여야 하는 시간». */
const SOON_MIN = 30;
const NOW_MIN = 5;
const POLL_MS = 60_000;
/** 팝업이 스스로 서 있는 시간(초). 사람이 닫지 않아도 화면을 계속 덮고 있지 않습니다. */
const POPUP_SEC = 20;

export default function PickupAlarmBar() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // 같은 건으로 두 번 소리내지 않도록 이미 알린 것을 기억합니다.
  const notifiedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/work/pickup-alarms");
      const body = (await res.json().catch(() => ({}))) as { alarms?: Alarm[]; nowMinutes?: number; error?: string };
      // 조용히 비워두지 않습니다 - 알람이 없는 것인지 못 읽은 것인지 화면이 말해야 합니다.
      if (!res.ok) return setError(body.error ?? "하원 시각을 읽지 못했습니다.");
      setError(null);
      setAlarms(body.alarms ?? []);
      setNowMinutes(typeof body.nowMinutes === "number" ? body.nowMinutes : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "하원 시각을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };

  const soon = nowMinutes === null
    ? []
    : alarms
        .filter((a) => !dismissed.has(a.key))
        .map((a) => ({ ...a, left: toMin(a.time) - nowMinutes }))
        // 이미 지난 것은 15분까지만 남깁니다 - 방금 지난 건은 아직 처리 중일 수 있습니다.
        .filter((a) => a.left <= SOON_MIN && a.left >= -15)
        .sort((a, b) => a.left - b.left);

  // 브라우저 알림. 화면을 다른 탭에 두고 일할 때가 많아서, 5분 전에는 창 밖으로도 알립니다.
  // 권한이 없으면 조용히 넘어갑니다 - 화면 안 줄은 어차피 떠 있습니다.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    for (const a of soon) {
      if (a.left > NOW_MIN || notifiedRef.current.has(a.key)) continue;
      notifiedRef.current.add(a.key);
      if (Notification.permission === "granted") {
        new Notification(`${a.time} ${a.name} 하원`, { body: `${a.where}${a.via ? ` · ${a.via}` : ""}`, tag: a.key });
      }
    }
  }, [soon]);

  // ── 5분 전 팝업 ──────────────────────────────────────────────────────
  //
  // 띠는 「아직 안 끝났다」를 계속 보여주고, 팝업은 「지금 봐라」를 한 번만 말합니다. 둘을
  // 같은 것으로 만들면 - 계속 뜨는 팝업 - 사람이 화면을 덮어버리거나 아예 안 봅니다.
  //
  // 사무실 대형 모니터에는 이미 있었는데, 그 화면은 아무도 안 볼 때가 있습니다. 사람이 앉아서
  // 보는 화면은 여기입니다. 한 아이당 한 번만 뜹니다(popped).
  const [popup, setPopup] = useState<typeof soon>([]);
  const poppedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 아직 시각이 안 지난 건만 팝업으로 띄웁니다. 화면을 켜자마자 지난 알림이 쏟아지면
    // 사람은 그 자리에서 팝업을 끄는 법부터 배웁니다.
    const fresh = soon.filter((a) => a.left >= 0 && a.left <= NOW_MIN && !poppedRef.current.has(a.key));
    if (fresh.length === 0) return;
    for (const f of fresh) poppedRef.current.add(f.key);
    setPopup((prev) => [...prev, ...fresh]);
    const t = setTimeout(() => setPopup((prev) => prev.filter((p) => !fresh.some((f) => f.key === p.key))), POPUP_SEC * 1000);
    return () => clearTimeout(t);
  }, [soon]);

  const alarmPopup =
    popup.length === 0 || typeof document === "undefined"
      ? null
      : createPortal(
          <div className="fixed inset-x-0 top-3 z-[70] flex justify-center px-3">
            <div className="w-full max-w-lg rounded-2xl border-2 border-red-400 bg-white p-3 shadow-2xl">
              <div className="mb-1.5 flex items-baseline gap-2">
                <b className="text-sm font-extrabold text-red-600">🔔 곧 하원합니다</b>
                <button
                  type="button"
                  onClick={() => setPopup([])}
                  className="ml-auto rounded-lg bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600 hover:bg-slate-200"
                >
                  확인
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                {popup.map((a) => (
                  <div key={a.key} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <b className="text-xl font-black tabular-nums text-red-600">{a.time}</b>
                    {/* **이름은 줄이지 않습니다.** 가려지면 누구를 데려오는지 모릅니다. */}
                    <b className="whitespace-nowrap text-lg font-black text-slate-900">{a.name}</b>
                    <span className="text-xs font-bold text-slate-500">{a.className ?? "반 미확인"}</span>
                    {/* 어디로 가야 하는가. 이름만 알면 못 움직입니다. */}
                    <span className="text-xs font-bold text-amber-700">📍 {a.where}</span>
                    {a.via && <span className="text-xs text-slate-500">{a.via}</span>}
                    <span className="ml-auto text-[11px] font-bold text-red-500">{a.left <= 0 ? "지금" : `${a.left}분 뒤`}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        );

  if (error) {
    return (
      <div className="shrink-0 border-b border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] text-orange-800">⏰ {error}</div>
    );
  }
  // 팝업만 남고 띠가 빌 수 있습니다(방금 확인해서 내린 경우). 팝업은 그대로 띄웁니다.
  if (soon.length === 0) return alarmPopup;

  return (
    <>
      {alarmPopup}
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-black/5 bg-amber-50/70 px-2.5 py-1">
      <span className="shrink-0 text-[11px] font-extrabold text-amber-700">⏰ 곧 하원</span>
      {soon.map((a) => {
        const urgent = a.left <= NOW_MIN;
        return (
          <span
            key={a.key}
            className={
              "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] " +
              (urgent ? "bg-red-500 font-bold text-white" : "bg-white text-slate-600 ring-1 ring-black/10")
            }
            title={`${a.where}${a.via ? ` · ${a.via}` : ""}`}
          >
            <b className="tabular-nums">{a.time}</b>
            <span>{a.name}</span>
            {a.className && <span className={urgent ? "text-white/70" : "text-slate-400"}>{a.className}</span>}
            <span className={urgent ? "text-white/80" : "text-slate-400"}>
              {a.left <= 0 ? "지금" : `${a.left}분 뒤`}
            </span>
            <span className={"truncate " + (urgent ? "text-white/80" : "text-slate-400")}>📍 {a.where}</span>
            {/* 처리한 건은 사람이 내립니다. 저절로 사라지면 「내가 처리했던가」가 남습니다. */}
            <button
              type="button"
              onClick={() => setDismissed((p) => new Set(p).add(a.key))}
              title="확인했습니다"
              className={"ml-0.5 rounded px-0.5 " + (urgent ? "hover:bg-red-600" : "hover:bg-slate-100")}
            >
              ✕
            </button>
          </span>
        );
      })}
      {typeof window !== "undefined" && "Notification" in window && Notification.permission === "default" && (
        <button
          type="button"
          onClick={() => void Notification.requestPermission()}
          className="ml-auto shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200"
        >
          🔔 창 밖으로도 알림 받기
        </button>
      )}
    </div>
    </>
  );
}
