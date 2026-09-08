"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 업무보드의 하원 알람.
 *
 * 5분 전에 **팝업만** 띄웁니다. 사무실 대형 모니터에만 알람이 있었는데, 그 화면은 아무도
 * 안 보고 있을 때가 있고 그때 놓치면 아이가 문 앞에서 기다립니다. 사람이 실제로 앉아서
 * 보는 화면은 업무보드입니다.
 *
 * **소리는 넣지 않습니다.** 사무실에서 갑자기 나는 소리는 놀라게 하고, 놀라게 하는 알림은
 * 결국 꺼집니다. 꺼진 알림은 없는 것과 같습니다.
 *
 * 팝업에 넣는 것은 셋뿐입니다 - **이름 · 시각 · 지금 있는 자리**. 이름만 알면 못 움직입니다.
 * 자리는 반 시간표에서 「지금 교시에 그 반이 어느 교실에서 무슨 수업 중인가」로 찾습니다.
 *
 * 한 아이당 한 번만 뜹니다. 계속 뜨는 알림은 사람이 화면을 덮어버리거나 아예 안 봅니다.
 *
 * 팝업은 화면을 덮지 않고 **위쪽에 노란 쪽지**로 뜹니다. 하원 시각은 몰려 있어서, 20초 안에
 * 다른 아이가 또 걸리는 일이 흔합니다. 그때 팝업을 새로 띄우면 앞의 아이가 지워지고 화면이
 * 깜빡입니다. 그래서 **같은 쪽지에 줄만 늘어납니다** - 아이마다 자기 20초를 따로 세고, 다 센
 * 줄부터 하나씩 빠집니다.
 */

const LEAD_MIN = 5; // 몇 분 전에 알릴 것인가
const KEEP_MIN = 10; // 지난 뒤에도 띠에 얼마나 남길 것인가
const POPUP_SEC = 20;
const POLL_MS = 30_000;

type Alarm = { key: string; name: string; time: string; className: string | null; where: string; via: string | null };

export default function PickupAlarmBar() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 지금 쪽지에 올라가 있는 아이들. 아이마다 사라질 시각(until)을 따로 답니다.
  const [stack, setStack] = useState<(Alarm & { left: number; until: number })[]>([]);
  const shown = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const res = await fetch("/api/work/pickup-alarms", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 조용히 넘기면 「알람이 없는 날」과 「알람이 고장난 날」이 똑같이 보입니다.
      setError((body as { error?: string }).error ?? res.statusText);
      return;
    }
    setError(null);
    setAlarms((body.alarms as Alarm[]) ?? []);
    setNowMin(typeof body.nowMinutes === "number" ? body.nowMinutes : null);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // 서버가 준 시각을 1분씩 앞으로 굴립니다. 다음 조회까지 기다리면 알람이 최대 30초 늦습니다.
  useEffect(() => {
    const t = setInterval(() => setNowMin((n) => (n === null ? n : n + 1)), 60_000);
    return () => clearInterval(t);
  }, []);

  const due =
    nowMin === null
      ? []
      : alarms
          .map((a) => {
            const m = a.time.match(/^(\d{1,2}):(\d{2})/);
            if (!m) return null;
            const at = Number(m[1]) * 60 + Number(m[2]);
            const left = at - nowMin;
            if (left > LEAD_MIN || left < -KEEP_MIN) return null;
            return { ...a, left };
          })
          .filter((x): x is Alarm & { left: number } => !!x);

  useEffect(() => {
    // 아직 시각이 안 지난 건만 쪽지로. 화면을 켜자마자 지난 알림이 쏟아지면 안 됩니다.
    const fresh = due.filter((a) => a.left >= 0 && !shown.current.has(a.key));
    if (fresh.length === 0) return;
    for (const f of fresh) shown.current.add(f.key);
    const until = Date.now() + POPUP_SEC * 1000;
    setStack((prev) => [...prev, ...fresh.map((f) => ({ ...f, until }))]);
  }, [due]);

  // 다 센 줄부터 하나씩 뺍니다. 한 번에 통째로 지우면 방금 올라온 아이까지 같이 사라집니다.
  useEffect(() => {
    if (stack.length === 0) return;
    const t = setInterval(() => setStack((prev) => prev.filter((x) => x.until > Date.now())), 500);
    return () => clearInterval(t);
  }, [stack.length]);

  if (error) {
    return (
      <div className="mb-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
        하원 알람을 읽지 못했습니다: {error}
      </div>
    );
  }
  if (due.length === 0 && stack.length === 0) return null;

  return (
    <>
      {stack.length > 0 && <AlarmToast items={stack} onClose={() => setStack([])} />}
      {due.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-extrabold text-sky-700">🔔 곧 하원</span>
          {due.map((a) => (
            <span
              key={a.key}
              className={
                "rounded-lg px-2 py-0.5 text-[11px] font-bold " +
                (a.left < 0 ? "bg-rose-100 text-rose-800" : "bg-sky-100 text-sky-800")
              }
              title={`${a.name} · ${a.time} · ${a.where}${a.via ? ` · ${a.via}` : ""}`}
            >
              {a.time} {a.name}
              <span className="ml-1 font-medium text-slate-500">{a.where}</span>
              <span className="ml-1">{a.left < 0 ? `${-a.left}분 지남` : `${a.left}분 뒤`}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function AlarmToast({
  items,
  onClose,
}: {
  items: (Alarm & { left: number; until: number })[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    // 화면 위쪽 가운데. 화면을 덮지 않으므로 뒤에서 하던 일을 계속할 수 있습니다.
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex justify-center px-3">
      <div
        onClick={onClose}
        className="pointer-events-auto w-full max-w-md cursor-pointer rounded-2xl border-2 border-amber-400 bg-amber-50 px-4 py-3 shadow-xl"
        title="누르면 닫힙니다"
      >
        <div className="mb-1 flex items-center gap-2 text-[12px] font-extrabold text-amber-800">
          🔔 곧 하원 {items.length > 1 && <span className="rounded bg-amber-200 px-1.5">{items.length}명</span>}
          <span className="ml-auto text-[10px] font-medium text-amber-600">누르면 닫힘</span>
        </div>
        <ul className="flex flex-col gap-1">
          {items.map((a) => (
            <li key={a.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <b className="text-[15px] font-black tabular-nums text-amber-900">{a.time}</b>
              <b className="text-[17px] font-black text-slate-900">{a.name}</b>
              <span className="text-[12px] font-semibold text-slate-500">{a.className ?? "반 미확인"}</span>
              {/* 어디로 가야 하는가. 이름만 알면 못 움직입니다. */}
              <span className="text-[13px] font-bold text-amber-800">📍 {a.where}</span>
              {a.via && <span className="text-[11px] font-semibold text-violet-700">{a.via}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body
  );
}
