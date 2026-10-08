"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CLOSED_STATUSES,
  CONSULT_STATUSES,
  aheadCount,
  estimate,
  expectedMinutes,
  kstMinuteOfDay,
  type ConsultAppt,
  type ConsultStatus,
} from "@/lib/consult/model";
import type { ConsultAction, ConsultState } from "@/lib/consult/server";
import type { Student, StudentWithPhones } from "@/lib/students";
import { ApptNames, StatusChip } from "./shared";
import { waitLabel } from "./useConsultEvent";

type Live = {
  busy: string | null;
  now: number;
  act: (apptId: string, action: ConsultAction) => Promise<boolean>;
};

/**
 * **안내데스크.** 도착 처리 → 상담실 정하기 → 호출 → (면담 선생님이) 시작·종료.
 *
 * 줄 순서는 «지금 손이 가야 하는 것» 먼저입니다: 상담중 → 상담준비 → 대기 → 미도착, 같은
 * 단계에서는 예약 시각(+지연)입니다. 끝난 예약(완료·취소·전화상담)은 맨 아래로 내립니다.
 */
export default function DeskTab({ state, studentById, live }: { state: ConsultState; studentById: Map<string, Student>; live: Live }) {
  const [filter, setFilter] = useState<ConsultStatus | "전체" | "진행중">("진행중");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const { rooms: timings, waits } = useMemo(
    () => estimate(state.appts, state.rooms, state.logs, state.event.default_minutes, live.now),
    [state.appts, state.rooms, state.logs, state.event.default_minutes, live.now],
  );
  const roomName = useMemo(() => new Map(state.rooms.map((r) => [r.id, r.name])), [state.rooms]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(CONSULT_STATUSES.map((s) => [s, 0])) as Record<ConsultStatus, number>;
    for (const a of state.appts) c[a.status] += 1;
    return c;
  }, [state.appts]);

  const rank: Record<ConsultStatus, number> = { 상담중: 0, 상담준비: 1, 대기: 2, 미도착: 3, 전화상담: 4, 완료: 5, 취소: 6 };
  const rows = state.appts
    .filter((a) => (filter === "전체" ? true : filter === "진행중" ? !CLOSED_STATUSES.includes(a.status) : a.status === filter))
    .filter((a) => {
      const k = q.trim();
      if (!k) return true;
      return a.student_ids.some((id) => {
        const s = studentById.get(id);
        return !!s && (s.name.includes(k) || (s.name_en ?? "").toLowerCase().includes(k.toLowerCase()) || (s.class_name ?? "").includes(k));
      });
    })
    .sort((x, y) => rank[x.status] - rank[y.status] || (expectedMinutes(x) ?? 9999) - (expectedMinutes(y) ?? 9999));

  const nowMin = kstMinuteOfDay(live.now);

  const run = (a: ConsultAppt, action: ConsultAction) => void live.act(a.id, action);

  function phonesOf(a: ConsultAppt): string[] {
    const out = new Set<string>();
    for (const id of a.student_ids) {
      const s = studentById.get(id) as Partial<StudentWithPhones> | undefined;
      for (const p of [s?.mother_phone, s?.father_phone, s?.parent_phone]) if (p) out.add(p);
    }
    return [...out];
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 px-0.5">
          {(["진행중", "전체", ...CONSULT_STATUSES] as const).map((s) => {
            const n = s === "전체" ? state.appts.length : s === "진행중" ? state.appts.filter((a) => !CLOSED_STATUSES.includes(a.status)).length : counts[s];
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${filter === s ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
              >
                {s} {n}
              </button>
            );
          })}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·반 찾기"
            className="ml-auto w-40 rounded-lg border border-slate-300 px-2.5 py-1 text-sm"
          />
        </div>

        {state.rooms.length === 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">상담실이 아직 없습니다. 「상담실」 탭에서 먼저 만들어 주세요.</p>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">시각</th>
                <th className="px-3 py-2">학생</th>
                <th className="px-3 py-2">상담실</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">순서</th>
                <th className="px-3 py-2 text-right">할 일</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    해당하는 예약이 없습니다.
                  </td>
                </tr>
              )}
              {rows.map((a) => {
                const exp = expectedMinutes(a);
                const late = a.status === "미도착" && exp !== null && nowMin - exp > 5;
                const busy = live.busy === a.id;
                const ahead = aheadCount(state.appts, a);
                const closed = CLOSED_STATUSES.includes(a.status);
                return (
                  <tr key={a.id} className={`border-t border-slate-100 align-top ${closed ? "bg-slate-50/60 text-slate-400" : ""} ${a.status === "상담중" ? "bg-emerald-50/60" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-mono">{a.scheduled_time ?? "-"}</span>
                      {a.delay_min > 0 && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] text-amber-800">+{a.delay_min}분</span>}
                      {late && <div className="text-[11px] font-semibold text-rose-600">예정보다 늦음</div>}
                    </td>
                    <td className="px-3 py-2">
                      <ApptNames appt={a} studentById={studentById} />
                      {a.note && <div className="mt-0.5 text-xs text-slate-500">📝 {a.note}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={a.room_id ?? ""}
                        disabled={busy || closed}
                        onChange={(e) => run(a, { kind: "assign", room_id: e.target.value || null })}
                        className="w-full max-w-[160px] rounded border border-slate-300 px-1.5 py-1 text-sm"
                      >
                        <option value="">미정</option>
                        {state.rooms.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      {a.course_room_ids.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.course_room_ids.map((rid) => (
                            <span
                              key={rid}
                              className={`rounded px-1.5 text-[11px] ${a.done_room_ids.includes(rid) ? "bg-slate-200 text-slate-400 line-through" : rid === a.room_id ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-600"}`}
                            >
                              {roomName.get(rid) ?? "?"}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusChip status={a.status} />
                      {a.status === "상담준비" && a.called_at && <div className="mt-0.5 text-[11px] text-sky-700">📣 호출함</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
                      {ahead !== null && ahead > 0 && <div>앞에 {ahead}명</div>}
                      {!closed && a.status !== "상담중" && a.room_id && <div>{waitLabel(waits.get(a.id))}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {a.status === "미도착" && <Btn onClick={() => run(a, { kind: "arrive" })} busy={busy} tone="amber">도착</Btn>}
                        {(a.status === "대기" || a.status === "상담준비") && a.room_id && (
                          <Btn onClick={() => run(a, { kind: "call" })} busy={busy} tone="sky">{a.called_at ? "다시 호출" : "호출"}</Btn>
                        )}
                        {(a.status === "대기" || a.status === "상담준비") && a.room_id && (
                          <Btn onClick={() => run(a, { kind: "start" })} busy={busy} tone="emerald">시작</Btn>
                        )}
                        {a.status === "상담중" && <Btn onClick={() => run(a, { kind: "finish" })} busy={busy} tone="slate">종료</Btn>}
                        <button
                          onClick={() => setOpen(open === a.id ? null : a.id)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          ⋯
                        </button>
                      </div>
                      {open === a.id && (
                        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-slate-500">늦음</span>
                            {[0, 5, 10, 15, 20].map((m) => (
                              <button
                                key={m}
                                onClick={() => run(a, { kind: "delay", minutes: m })}
                                className={`rounded px-2 py-0.5 ring-1 ${a.delay_min === m ? "bg-amber-500 text-white ring-amber-500" : "bg-white ring-slate-200"}`}
                              >
                                {m === 0 ? "없음" : `+${m}`}
                              </button>
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Btn onClick={() => run(a, { kind: "phone" })} busy={busy} tone="violet">{a.status === "전화상담" ? "전화상담 해제" : "전화상담으로"}</Btn>
                            <Btn onClick={() => run(a, { kind: "cancel" })} busy={busy} tone="rose">{a.status === "취소" ? "취소 해제" : "취소"}</Btn>
                            <Btn onClick={() => run(a, { kind: "undo" })} busy={busy} tone="slate">↩ 방금 것 되돌리기</Btn>
                            <select
                              value=""
                              onChange={(e) => e.target.value && run(a, { kind: "set_status", status: e.target.value as ConsultStatus })}
                              className="rounded border border-slate-300 bg-white px-1 py-0.5"
                            >
                              <option value="">상태 직접 고르기…</option>
                              {CONSULT_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          </div>
                          {phonesOf(a).length > 0 && (
                            <div className="text-slate-600">
                              ☎ {phonesOf(a).map((p) => (
                                <a key={p} href={`tel:${p}`} className="mr-2 underline">
                                  {p}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="space-y-2">
        <h3 className="text-xs font-bold text-slate-500">상담실</h3>
        {state.rooms.map((r) => {
          const inRoom = state.appts.filter((a) => a.room_id === r.id);
          const now = inRoom.find((a) => a.status === "상담중");
          const queue = inRoom.filter((a) => a.status === "상담준비" || a.status === "대기").length;
          const t = timings.get(r.id);
          return (
            <Link
              key={r.id}
              href={`/consult?event=${state.event.id}&room=${r.id}`}
              className="block rounded-xl border border-slate-200 bg-white p-3 text-sm hover:border-indigo-300"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-slate-900">{r.name}</span>
                <span className="text-xs text-slate-500">{r.teacher_name ?? ""}</span>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                {now ? (
                  <span className="text-emerald-700">
                    상담중 · <ApptNames appt={now} studentById={studentById} showGrade={false} />
                  </span>
                ) : (
                  <span className="text-slate-400">비어 있음</span>
                )}
              </div>
              <div className="mt-1 flex gap-3 text-xs text-slate-500">
                <span>대기 {queue}</span>
                <span>평균 {t?.avg ?? state.event.default_minutes}분</span>
                {t && t.busyFor > 0 && <span>다 끝나기까지 약 {t.busyFor}분</span>}
              </div>
            </Link>
          );
        })}
      </aside>
    </div>
  );
}

function Btn({
  children,
  onClick,
  busy,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  tone: "amber" | "sky" | "emerald" | "slate" | "violet" | "rose";
}) {
  const cls: Record<typeof tone, string> = {
    amber: "bg-amber-500 hover:bg-amber-600 text-white",
    sky: "bg-sky-600 hover:bg-sky-700 text-white",
    emerald: "bg-emerald-600 hover:bg-emerald-700 text-white",
    slate: "bg-slate-700 hover:bg-slate-800 text-white",
    violet: "bg-violet-600 hover:bg-violet-700 text-white",
    rose: "bg-rose-600 hover:bg-rose-700 text-white",
  };
  return (
    <button onClick={onClick} disabled={busy} className={`rounded px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${cls[tone]}`}>
      {children}
    </button>
  );
}
