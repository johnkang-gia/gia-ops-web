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
 * 왼쪽은 누르는 칸(지금 상담 → 다음 상담자), 오른쪽은 보는 칸(이 방 대기 순서 → 전체 대기 목록).
 * 하는 일은 셋뿐입니다: 다음 분 **호출**, 들어오시면 **상담 시작**, 끝나면 **상담 종료**. 상담 중에 화면을
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
  // 다음 상담자: 이 방에서 기다리는 분이 먼저, 없으면 아직 안 오신 예약 중 가장 이른 분.
  const nextWaiting = room.queue[0] ?? null;
  const nextUpcoming = nextWaiting ? null : (room.upcoming[0] ?? null);
  const restQueue = room.queue.slice(nextWaiting ? 1 : 0);
  const restUpcoming = room.upcoming.slice(nextUpcoming ? 1 : 0);
  const busyNow = busy !== null;

  return (
    <div className="mx-auto min-h-screen max-w-5xl bg-slate-50 p-4 sm:p-6">
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

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-4">
          {/* 지금 상담 중 */}
          <section className={`rounded-3xl p-5 shadow-sm ring-1 ${current ? "bg-emerald-50 ring-emerald-200" : "bg-white ring-slate-200"}`}>
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
                  disabled={busyNow}
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

          {/* 다음 상담자 — 들어오시면 「상담 시작」. 지금 상담이 있으면 먼저 종료해야 누를 수 있습니다:
              둘을 함께 «상담중»으로 두면 대기 시간 계산과 현황판이 동시에 틀어집니다. */}
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-2 ring-sky-300">
            <p className="text-sm font-semibold text-sky-700">다음 상담자 · Next</p>
            {nextWaiting || nextUpcoming ? (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-3">
                  <p className="text-4xl font-extrabold text-slate-900">{(nextWaiting ?? nextUpcoming)!.label}</p>
                  {(nextWaiting ?? nextUpcoming)!.grade && <span className="text-xl text-slate-500">{(nextWaiting ?? nextUpcoming)!.grade}</span>}
                  <span className="ml-auto">
                    {nextWaiting ? (
                      <Chip called={nextWaiting.called} status={nextWaiting.status} />
                    ) : (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-sm font-semibold text-slate-600">아직 안 오심 · Not arrived</span>
                    )}
                  </span>
                </div>
                <p className="mt-1 text-base text-slate-600">
                  {(nextWaiting ?? nextUpcoming)!.time ? `예약 ${(nextWaiting ?? nextUpcoming)!.time}` : "예약 시각 없음"}
                  {nextWaiting?.wait != null ? ` · 약 ${Math.max(0, nextWaiting.wait)}분 뒤` : ""}
                </p>
                <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
                  <button
                    disabled={busyNow || !!current}
                    onClick={() => {
                      const n = (nextWaiting ?? nextUpcoming)!;
                      void act(n.id, nextWaiting?.updatedAt ?? null, { kind: "call" });
                    }}
                    className="rounded-2xl bg-sky-600 py-5 text-xl font-bold text-white active:bg-sky-700 disabled:opacity-40"
                  >
                    📣 호출 · Call
                  </button>
                  <button
                    disabled={busyNow || !!current}
                    onClick={() => {
                      const n = (nextWaiting ?? nextUpcoming)!;
                      void act(n.id, nextWaiting?.updatedAt ?? null, { kind: "start" });
                    }}
                    className="rounded-2xl bg-emerald-600 py-5 text-3xl font-extrabold text-white active:bg-emerald-700 disabled:opacity-40"
                  >
                    ▶ 상담 시작 · Start
                  </button>
                </div>
                {current && <p className="mt-2 text-sm text-slate-500">지금 상담을 먼저 종료하면 시작할 수 있습니다.</p>}
              </>
            ) : (
              <p className="mt-2 text-xl text-slate-400">이 방에 남은 순서가 없습니다 · No one left</p>
            )}
          </section>

          {room.last && (
            <div className="flex items-center gap-3 rounded-2xl bg-slate-200/70 px-4 py-3 text-base text-slate-700">
              <span className="flex-1">
                방금: {room.last.label} {ACTION_WORD[room.last.action] ?? room.last.action}
              </span>
              <button
                disabled={busyNow}
                onClick={() => void act(room.last!.id, room.last!.updatedAt, { kind: "undo" })}
                className="rounded-xl bg-white px-4 py-2 text-base font-bold text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
              >
                ↶ 되돌리기 · Undo
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* 이 방 순서 — 다음 분 뒤로 이어지는 줄. 순서를 바꿔야 하면(늦게 오신 분 등) 여기서 바로 시작합니다. */}
          <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-500">
              이 방 대기 순서 · Queue ({restQueue.length + restUpcoming.length})
            </p>
            {restQueue.length + restUpcoming.length === 0 && <p className="mt-2 text-base text-slate-400">없음</p>}
            <ol className="mt-2 space-y-1.5">
              {restQueue.map((q, i) => (
                <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span className="w-6 text-right text-sm font-bold text-slate-400">{i + 2}</span>
                  <span className="text-lg font-bold text-slate-900">{q.label}</span>
                  {q.grade && <span className="text-sm text-slate-500">{q.grade}</span>}
                  <Chip called={q.called} status={q.status} />
                  <span className="ml-auto text-xs text-slate-500">{q.time ?? ""}</span>
                  <button
                    disabled={busyNow || !!current}
                    onClick={() => void act(q.id, q.updatedAt, { kind: "start" })}
                    className="rounded-lg bg-emerald-50 px-2 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 disabled:opacity-40"
                  >
                    ▶ 시작
                  </button>
                </li>
              ))}
              {restUpcoming.map((u, i) => (
                <li key={u.id} className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-slate-500">
                  <span className="w-6 text-right text-sm font-bold text-slate-300">{restQueue.length + i + 2}</span>
                  <span className="text-lg font-semibold">{u.label}</span>
                  {u.grade && <span className="text-sm">{u.grade}</span>}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">아직 안 오심</span>
                  <span className="ml-auto text-xs">
                    {u.time ?? ""}
                    {u.delayMin ? ` (+${u.delayMin}분)` : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* 전체 대기 목록 — 다른 방이 얼마나 밀렸는지, 로비에 몇 분이 계신지. 다른 방 이름은 현황판처럼 가립니다. */}
          <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-500">전체 대기 목록 · All rooms ({room.all.length})</p>
            <div className="mt-2 max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-slate-400">
                  <tr>
                    <th className="py-1 pr-2 font-medium">상태</th>
                    <th className="py-1 pr-2 font-medium">이름</th>
                    <th className="py-1 pr-2 font-medium">상담실</th>
                    <th className="py-1 font-medium">예약</th>
                  </tr>
                </thead>
                <tbody>
                  {room.all.map((a) => (
                    <tr key={a.id} className={`border-t border-slate-100 ${a.mine ? "bg-sky-50 font-semibold" : ""}`}>
                      <td className="py-1.5 pr-2">
                        <span className={`rounded-full px-1.5 py-0.5 text-xs ${ALL_TONE[a.status] ?? "bg-slate-100 text-slate-600"}`}>{a.status}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-slate-800">
                        {a.label}
                        {a.grade && <span className="ml-1 text-xs font-normal text-slate-400">{a.grade}</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{a.room ?? "미정"}</td>
                      <td className="py-1.5 tabular-nums text-slate-500">{a.time ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        이 화면은 3초마다 새로 고쳐집니다. 시작·종료를 누르면 로비 현황판과 학부모 «내 순서» 화면에 바로 반영됩니다. 도착 확인·방 바꾸기는 안내데스크가 합니다.
      </p>
    </div>
  );
}

const ALL_TONE: Record<string, string> = {
  상담중: "bg-emerald-100 text-emerald-800",
  상담준비: "bg-sky-100 text-sky-800",
  대기: "bg-amber-100 text-amber-800",
  미도착: "bg-slate-100 text-slate-500",
};

function Chip({ called, status }: { called: boolean; status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${called ? "bg-sky-600 text-white" : "bg-amber-100 text-amber-800"}`}>
      {called ? "호출됨 · Called" : status === "상담준비" ? "준비 · Ready" : "대기 · Waiting"}
    </span>
  );
}

function elapsed(startIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
