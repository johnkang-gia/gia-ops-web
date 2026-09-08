"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * 업무보드의 하원 알람.
 *
 * 5분 전에 **짧은 소리 한 번 + 팝업**으로 알립니다. 사무실 대형 모니터에만 알람이 있었는데,
 * 그 화면은 아무도 안 보고 있을 때가 있고 그때 놓치면 아이가 문 앞에서 기다립니다. 사람이
 * 실제로 앉아서 보는 화면은 업무보드입니다.
 *
 * 팝업에 넣는 것은 셋뿐입니다 - **이름 · 시각 · 지금 있는 자리**. 이름만 알면 못 움직입니다.
 * 자리는 반 시간표에서 「지금 교시에 그 반이 어느 교실에서 무슨 수업 중인가」로 찾습니다.
 *
 * 한 아이당 한 번만 뜹니다. 계속 뜨는 알림은 사람이 화면을 덮어버리거나 아예 안 봅니다.
 */

const LEAD_MIN = 5; // 몇 분 전에 알릴 것인가
const KEEP_MIN = 10; // 지난 뒤에도 띠에 얼마나 남길 것인가
const POPUP_SEC = 20;
const POLL_MS = 30_000;

type Alarm = { key: string; name: string; time: string; className: string | null; where: string; via: string | null };

/** 짧은 두 음. 길거나 반복되는 소리는 사람이 «끄고 싶어집니다». */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.02);
    };
    play(880, 0, 0.15);
    play(1320, 0.16, 0.18);
    setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    // 소리를 못 내도 팝업은 뜹니다. 여기서 막으면 알림 자체가 사라집니다.
  }
}

export default function PickupAlarmBar() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 브라우저는 사람이 한 번 화면을 건드리기 전에는 소리를 못 냅니다(자동재생 차단).
  // 소리가 안 나는 것이 조용한 실패가 되지 않게, 켜기 전에는 버튼이 남아 그 사실이 보입니다.
  const [soundOn, setSoundOn] = useState(false);
  const [popup, setPopup] = useState<(Alarm & { left: number }) | null>(null);
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
    // 아직 시각이 안 지난 건만 팝업으로. 화면을 켜자마자 지난 알림이 쏟아지면 안 됩니다.
    const fresh = due.find((a) => a.left >= 0 && !shown.current.has(a.key));
    if (!fresh) return;
    shown.current.add(fresh.key);
    setPopup(fresh);
    if (soundOn) chime();
    const t = setTimeout(() => setPopup(null), POPUP_SEC * 1000);
    return () => clearTimeout(t);
  }, [due, soundOn]);

  if (error) {
    return (
      <div className="mb-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700">
        하원 알람을 읽지 못했습니다: {error}
      </div>
    );
  }
  if (due.length === 0 && !popup) return null;

  return (
    <>
      {popup && <Popup a={popup} onClose={() => setPopup(null)} />}
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
          {!soundOn && (
            <button
              onClick={() => {
                setSoundOn(true);
                chime(); // 눌린 그 순간 한 번 울려 「켜졌다」를 귀로 확인시킵니다.
              }}
              className="rounded-lg border border-sky-300 px-1.5 py-0.5 text-[10px] font-bold text-sky-700"
              title="브라우저는 한 번 눌러주기 전에는 소리를 못 냅니다"
            >
              🔇 소리 켜기
            </button>
          )}
        </div>
      )}
    </>
  );
}

function Popup({ a, onClose }: { a: Alarm & { left: number }; onClose: () => void }) {
  const [left, setLeft] = useState(POPUP_SEC);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[120] flex cursor-pointer items-center justify-center bg-slate-950/80 p-6"
    >
      <div className="max-w-lg rounded-3xl border-4 border-sky-400 bg-sky-900 px-10 py-8 text-center shadow-2xl">
        <div className="text-lg font-extrabold tracking-wide text-sky-300">
          🔔 {a.left > 0 ? `${a.left}분 뒤 하원` : "지금 하원"} · {a.time}
        </div>
        {/* 이름 - 이 화면에서 가장 큰 글자. */}
        <div className="my-3 text-6xl font-black leading-none text-white">{a.name}</div>
        <div className="text-xl font-bold text-sky-200">{a.className ?? "반 미확인"}</div>
        {/* 어디로 가야 하는가. 이름만 알면 못 움직입니다. */}
        <div className="mt-3 text-2xl font-black text-amber-300">📍 {a.where}</div>
        {a.via && <div className="mt-1 text-sm font-bold text-violet-300">{a.via}</div>}
        <div className="mt-5 text-xs text-sky-300">{left}초 뒤 닫힘 · 아무 곳이나 누르면 바로 닫힙니다</div>
      </div>
    </div>,
    document.body
  );
}
