"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsultAction, RoomPayload } from "@/lib/consult/server";

const ACTION_WORD: Record<string, string> = {
  call: "호출",
  start: "상담 시작",
  finish: "상담 종료",
  delay: "지연",
};

/**
 * **상담실 태블릿 화면.** 상담실 책상 위 태블릿에 켜 두거나, 문에 붙인 QR을 찍은 아무 휴대폰에서
 * 엽니다. 로그인이 없습니다 - 그날 어느 선생님이 그 방에 들어올지 미리 알 수 없기 때문입니다.
 *
 * 하는 일은 셋뿐입니다: 다음 분 **호출**, 들어오시면 **시작**, 끝나면 **종료**. 상담 중에 화면을
 * 보는 일은 거의 없으므로 단추를 크게 두고, 잘못 눌렀을 때를 위해 「되돌리기」를 늘 아래에 둡니다.
 * 확인 창을 띄우지 않는 이유도 같습니다 - 학부모 앞에서 확인 창을 두 번 누르는 것보다 잘못 누른
 * 한 번을 되돌리는 편이 빠릅니다.
 */
export default function ConsultRoomTabletClient({ token }: { token: string }) {
  const [room, setRoom] = useState<RoomPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const rev = useRef<number | null>(null);

  const poll = useCallback(async () => {
    try {
      const qs = rev.current === null ? "" : `?since=${rev.current}`;
      const res = await fetch(`/api/consult/room/${token}${qs}`, { cache: "no-store" });
      const j = (await res.json()) as { room?: RoomPayload; revision?: number; error?: string };
      if (!res.ok) {
        setError(j.error ?? "상담실 현황을 불러오지 못했습니다.");
        return;
      }
      if (typeof j.revision === "number") rev.current = j.revision;
      if (j.room) setRoom(j.room);
    } catch {
      setError("연결이 끊겼습니다. 다시 연결하는 중… · Reconnecting…");
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

  // 책상 위 태블릿이 상담 중에 꺼지면 다음 단추를 누르려고 잠금부터 풀어야 합니다.
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

  async function act(apptId: string, updatedAt: string | null, action: ConsultAction) {
    setBusy(apptId + action.kind);
    try {
      const res = await fetch(`/api/consult/room/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appt_id: apptId, updated_at: updatedAt, action }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      // 조용히 넘기지 않습니다. 눌렀는데 아무 일이 없으면 사람은 한 번 더 누르고, 그 사이 다른 가정이
      // 시작되거나 끝납니다.
      setError(res.ok ? null : (j.error ?? "처리하지 못했습니다."));
    } catch {
      setError("연결이 끊겨 처리하지 못했습니다. 다시 눌러 주세요.");
    }
    rev.current = null; // 번호와 관계없이 바로 새로 읽습니다.
    await poll();
    setBusy(null);
  }

  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-lg text-slate-600">{error ?? "상담실 정보를 불러오는 중… · Loading…"}</p>
      </div>
    );
  }

  const current = room.now[0] ?? null;
  const next = room.queue[0] ?? null;

  return (
    <div className="mx-auto min-h-screen max-w-3xl bg-slate-50 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-3xl font-extrabold text-slate-900">{room.room.name}</h1>
        {room.room.teacher && <span className="text-lg text-slate-600">{room.room.teacher}</span>}
        {room.room.gradeLabel && <span className="rounded bg-slate-200 px-2 py-0.5 text-sm text-slate-700">{room.room.gradeLabel}</span>}
        <span className="ml-auto text-sm text-slate-500">
          {room.eventName} · 마침 {room.done} · 평균 {room.avgMinutes}분
        </span>
      </header>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-base text-rose-700">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400">
            ✕
          </button>
        </div>
      )}

      {/* 지금 상담 중 */}
      <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-500">지금 상담 중 · In session</p>
        {current ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <p className="text-4xl font-extrabold text-slate-900">{current.label}</p>
              {current.grade && <span className="text-xl text-slate-500">{current.grade}</span>}
              {current.startedAt && (
                <span className="ml-auto text-3xl font-bold tabular-nums text-emerald-700">{elapsed(current.startedAt, now)}</span>
              )}
            </div>
            {current.remaining.length > 0 && (
              <p className="mt-1 text-base text-slate-600">끝나면 다음 방: {current.remaining.join(", ")} · Next room after this</p>
            )}
            <button
              disabled={busy !== null}
              onClick={() => void act(current.id, current.updatedAt, { kind: "finish" })}
              className="mt-4 w-full rounded-2xl bg-rose-600 py-6 text-3xl font-extrabold text-white active:bg-rose-700 disabled:opacity-50"
            >
              {busy === current.id + "finish" ? "…" : "■ 상담 종료 · Finish"}
            </button>
            {room.now.length > 1 && (
              <p className="mt-2 text-sm text-amber-700">
                이 방에 상담중인 예약이 {room.now.length}건입니다. 행정실에 알려 주세요 - 하나는 이미 끝났을 수 있습니다.
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-2xl font-semibold text-slate-400">비어 있음 · Room is free</p>
        )}
      </section>

      {/* 다음 */}
      <section className="mt-4 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-semibold text-slate-500">
          다음 순서 · Up next {room.queue.length > 0 && <span className="text-slate-400">({room.queue.length})</span>}
        </p>
        {room.queue.length === 0 && <p className="mt-2 text-lg text-slate-400">기다리는 분이 없습니다 · No one waiting</p>}
        <ul className="mt-2 space-y-2">
          {room.queue.map((q) => (
            <li key={q.id} className={`rounded-2xl p-3 ${q.id === next?.id ? "bg-sky-50 ring-2 ring-sky-300" : "bg-slate-50"}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-2xl font-bold text-slate-900">{q.label}</p>
                {q.grade && <span className="text-base text-slate-500">{q.grade}</span>}
                <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${q.called ? "bg-sky-600 text-white" : "bg-amber-100 text-amber-800"}`}>
                  {q.called ? "호출됨 · Called" : q.status === "상담준비" ? "준비 · Ready" : "대기 · Waiting"}
                </span>
                <span className="ml-auto text-sm text-slate-500">
                  {q.time ? `예약 ${q.time}` : ""}
                  {q.wait !== null ? ` · 약 ${Math.max(0, q.wait)}분` : ""}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  disabled={busy !== null}
                  onClick={() => void act(q.id, q.updatedAt, { kind: "call" })}
                  className="rounded-xl bg-sky-600 py-4 text-xl font-bold text-white active:bg-sky-700 disabled:opacity-50"
                >
                  {busy === q.id + "call" ? "…" : q.called ? "📣 다시 호출" : "📣 호출 · Call"}
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => void act(q.id, q.updatedAt, { kind: "start" })}
                  className="rounded-xl bg-emerald-600 py-4 text-xl font-bold text-white active:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === q.id + "start" ? "…" : "▶ 상담 시작 · Start"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {room.last && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-slate-200/70 px-4 py-3 text-base text-slate-700">
          <span className="flex-1">
            방금: {room.last.label} {ACTION_WORD[room.last.action] ?? room.last.action}
          </span>
          <button
            disabled={busy !== null}
            onClick={() => void act(room.last!.id, room.last!.updatedAt, { kind: "undo" })}
            className="rounded-xl bg-white px-4 py-2 text-base font-bold text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
          >
            ↶ 되돌리기 · Undo
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-slate-400">
        이 화면은 3초마다 새로 고쳐집니다. 도착 확인·방 바꾸기는 안내데스크가 합니다. · Updates every 3 seconds.
      </p>
    </div>
  );
}

function elapsed(startIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
