"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardPayload } from "@/lib/consult/server";
import { kstMinuteOfDay } from "@/lib/consult/model";

const PER_PAGE = 8;
const CALL_SHOW_MS = 120_000;

/**
 * **상담 현황판.** 로비 태블릿·전자칠판에 하루 종일 켜 둡니다.
 *
 *   · 3초마다 «바뀌었나»만 묻습니다(번호 문지기). 안 바뀌었으면 서버는 한 줄만 돌려줍니다.
 *   · 면담 선생님이 «호출»을 누르면 맨 위에 크게 띄우고 소리를 냅니다. 브라우저는 사람이 한 번
 *     누르기 전에는 소리를 막으므로, 처음에 「소리 켜기」를 한 번 눌러 둡니다.
 *   · 화면이 꺼지지 않게 잠금을 걸어 둡니다(지원하는 기기에서).
 *   · 상담실이 많으면 8개씩 넘겨 보여줍니다.
 */
export default function ConsultBoardClient({ token }: { token: string }) {
  const [board, setBoard] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [page, setPage] = useState(0);
  const [sound, setSound] = useState(false);
  const rev = useRef<number | null>(null);
  const seenCalls = useRef<Set<string>>(new Set());
  const audio = useRef<AudioContext | null>(null);

  const chime = useCallback(() => {
    const ctx = audio.current;
    if (!ctx) return;
    // 두 음의 «딩동». 파일을 받지 않고 브라우저가 직접 만듭니다(인터넷이 느린 교실에서도 바로 납니다).
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.start(t0);
      o.stop(t0 + 0.65);
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const qs = rev.current === null ? "" : `?since=${rev.current}`;
      const res = await fetch(`/api/consult/board/${token}${qs}`, { cache: "no-store" });
      const j = (await res.json()) as { board?: BoardPayload; unchanged?: boolean; revision?: number; error?: string };
      if (!res.ok) {
        setError(j.error ?? "현황을 불러오지 못했습니다.");
        return;
      }
      setError(null);
      if (typeof j.revision === "number") rev.current = j.revision;
      if (j.board) setBoard(j.board);
    } catch {
      setError("연결이 끊겼습니다. 다시 연결하는 중…");
    }
  }, [token]);

  useEffect(() => {
    void poll();
    const p = setInterval(() => void poll(), 3000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(p);
      clearInterval(c);
    };
  }, [poll]);

  // 화면 꺼짐 막기. 탭이 다시 보일 때마다 다시 겁니다(브라우저가 풀어 버립니다).
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } };
    const take = () => {
      nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    take();
    const onVis = () => document.visibilityState === "visible" && take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, []);

  const calls = (board?.calls ?? []).filter((c) => now - Date.parse(c.at) < CALL_SHOW_MS);
  useEffect(() => {
    let fresh = false;
    for (const c of calls) {
      const key = `${c.id}@${c.at}`;
      if (!seenCalls.current.has(key)) {
        seenCalls.current.add(key);
        fresh = true;
      }
    }
    if (fresh && sound) chime();
  }, [calls, sound, chime]);

  const rooms = board?.rooms ?? [];
  const pages = Math.max(1, Math.ceil(rooms.length / PER_PAGE));
  useEffect(() => {
    if (pages <= 1) return;
    const id = setInterval(() => setPage((p) => (p + 1) % pages), 10_000);
    return () => clearInterval(id);
  }, [pages]);
  const shown = rooms.slice((page % pages) * PER_PAGE, (page % pages) * PER_PAGE + PER_PAGE);

  const m = kstMinuteOfDay(now);
  const clock = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen bg-slate-900 p-4 text-white sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">{board?.eventName ?? "상담 현황판"}</h1>
          <p className="text-sm text-slate-400">Parent–Teacher Conferences</p>
        </div>
        {board && (
          <div className="flex gap-2 text-sm">
            <Pill label="대기 Waiting" value={board.counts.waiting} tone="bg-amber-500" />
            <Pill label="상담중 In session" value={board.counts.inSession} tone="bg-emerald-600" />
            <Pill label="완료 Done" value={`${board.counts.done}/${board.counts.total}`} tone="bg-slate-600" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          {!sound && (
            <button
              onClick={() => {
                audio.current = new AudioContext();
                setSound(true);
                chime();
              }}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-semibold"
            >
              🔊 소리 켜기
            </button>
          )}
          <button
            onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm"
          >
            ⛶
          </button>
          <span className="font-mono text-3xl font-bold tabular-nums">{clock}</span>
        </div>
      </header>

      {error && <p className="mb-3 rounded-lg bg-rose-600/80 px-4 py-2 text-lg">{error}</p>}

      {calls.length > 0 && (
        <section className="mb-4 space-y-2">
          {calls.slice(0, 3).map((c) => (
            <div key={`${c.id}${c.at}`} className="animate-pulse rounded-2xl bg-sky-500 px-6 py-4 text-center shadow-lg">
              <p className="text-3xl font-extrabold sm:text-4xl">
                📣 {c.label} 학부모님 → <span className="underline">{c.room}</span>
              </p>
              <p className="mt-1 text-lg text-sky-50">Please come to {c.room}</p>
            </div>
          ))}
        </section>
      )}

      {!board && !error && <p className="text-center text-xl text-slate-400">불러오는 중…</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {shown.map((r) => (
          <div key={r.id} className="flex flex-col rounded-2xl bg-slate-800 p-4 ring-1 ring-slate-700">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">{r.name}</span>
              {r.gradeLabel && <span className="text-sm text-slate-400">{r.gradeLabel}</span>}
            </div>
            {r.teacher && <div className="text-sm text-slate-400">{r.teacher}</div>}
            <div className="mt-3 rounded-xl bg-emerald-700/40 px-3 py-2">
              <div className="text-xs text-emerald-300">상담중 · In session</div>
              <div className="text-xl font-bold">{r.now.length ? r.now.map((x) => x.label).join(", ") : <span className="text-slate-500">—</span>}</div>
            </div>
            <div className="mt-2 flex-1 space-y-1">
              <div className="text-xs text-slate-400">다음 · Next</div>
              {r.next.length === 0 && <div className="text-slate-500">—</div>}
              {r.next.map((n, i) => (
                <div key={i} className={`flex items-center justify-between rounded-lg px-2 py-1 ${n.called ? "bg-sky-600" : "bg-slate-700/60"}`}>
                  <span className="text-lg font-semibold">
                    {n.label}
                    {n.grade && <span className="ml-1 text-xs font-normal text-slate-300">{n.grade}</span>}
                  </span>
                  <span className="text-sm text-slate-200">{n.called ? "📣 호출" : n.wait !== null ? (n.wait <= 0 ? "곧" : `약 ${n.wait}분`) : ""}</span>
                </div>
              ))}
              {r.waitingMore > 0 && <div className="text-sm text-slate-400">+{r.waitingMore}명 더</div>}
            </div>
          </div>
        ))}
      </section>

      {board && board.lobby.length > 0 && (
        <section className="mt-4 rounded-2xl bg-slate-800 p-4">
          <div className="mb-2 text-sm text-amber-300">상담실 안내를 기다리는 분 · Waiting for room</div>
          <div className="flex flex-wrap gap-2">
            {board.lobby.map((l, i) => (
              <span key={i} className="rounded-lg bg-amber-500/20 px-3 py-1 text-lg">
                {l.label}
                {l.grade && <span className="ml-1 text-xs text-slate-300">{l.grade}</span>}
              </span>
            ))}
          </div>
        </section>
      )}

      {pages > 1 && (
        <div className="mt-3 text-center text-sm text-slate-500">
          {(page % pages) + 1} / {pages}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <span className={`rounded-full px-3 py-1 font-semibold ${tone}`}>
      {label} {value}
    </span>
  );
}
