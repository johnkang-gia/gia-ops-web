"use client";

import { useMemo } from "react";
import { CONSULT_STATUSES, computeStats } from "@/lib/consult/model";
import type { ConsultState } from "@/lib/consult/server";
import type { Student } from "@/lib/students";
import type { StaffOption } from "./ConsultEventClient";
import { ApptNames, StatusChip } from "./shared";

const ACTION_LABEL: Record<string, string> = {
  arrive: "도착",
  set_status: "상태 바꿈",
  assign: "상담실 정함",
  call: "호출",
  start: "상담 시작",
  finish: "상담 종료",
  cancel: "취소/해제",
  phone: "전화상담/해제",
  delay: "늦음 표시",
  undo: "되돌리기",
};

/** 시각 → 한국 시각 「HH:MM」. 기계 시간대에 기대지 않습니다(+9시간). */
function hhmm(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(11, 16);
}

/**
 * 기록·통계 — 행사가 끝나면 «얼마나 기다렸나·어느 방이 오래 걸렸나·몇 가정이 안 왔나»를 봅니다.
 * 다음 상담 때 방을 몇 개 열고 간격을 몇 분으로 잡을지의 근거입니다.
 *
 * 상담 메모는 쓴 선생님과 관리자만 보입니다(표의 자물쇠). 이 화면이 거르는 것이 아니라 DB 가
 * 아예 안 돌려줍니다.
 */
export default function StatsTab({
  state,
  studentById,
  staff,
  isAdmin,
}: {
  state: ConsultState;
  studentById: Map<string, Student>;
  staff: StaffOption[];
  isAdmin: boolean;
}) {
  const stats = useMemo(() => computeStats(state.appts, state.rooms, state.logs), [state.appts, state.rooms, state.logs]);
  const nameOfStaff = useMemo(() => new Map(staff.map((s) => [s.email.toLowerCase(), s.name ?? s.email])), [staff]);
  const roomName = new Map(state.rooms.map((r) => [r.id, r.name]));
  const apptById = new Map(state.appts.map((a) => [a.id, a]));
  const recent = [...state.logs].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 60);
  const noShow = state.event.status === "종료" ? stats.byStatus["미도착"] : null;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-4">
        <Card label="전체 예약" value={`${stats.total}`} />
        <Card label="평균 대기(도착→시작)" value={stats.avgWait === null ? "-" : `${stats.avgWait}분`} />
        <Card label="10분 넘게 늦게 도착" value={`${stats.late}`} />
        <Card label={noShow === null ? "아직 안 온 가정" : "불참(종료 시 미도착)"} value={`${stats.byStatus["미도착"]}`} />
      </section>

      <section className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
        {CONSULT_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-sm">
            <StatusChip status={s} /> {stats.byStatus[s]}
          </span>
        ))}
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">상담실</th>
              <th className="px-3 py-2">선생님</th>
              <th className="px-3 py-2">마친 상담</th>
              <th className="px-3 py-2">평균 상담 시간</th>
            </tr>
          </thead>
          <tbody>
            {stats.rooms.map((r) => {
              const room = state.rooms.find((x) => x.id === r.id);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{room?.name}</td>
                  <td className="px-3 py-2 text-slate-600">{room?.teacher_name ?? "-"}</td>
                  <td className="px-3 py-2">{r.done}</td>
                  <td className="px-3 py-2">{r.avg === null ? "-" : `${r.avg}분`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {state.notes.length > 0 && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">상담 메모 {isAdmin ? "(관리자: 전체)" : "(내가 쓴 것)"}</h3>
          {state.notes.map((n) => {
            const a = apptById.get(n.appointment_id);
            return (
              <div key={n.id} className="rounded-lg bg-slate-50 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {a && <ApptNames appt={n.student_id ? { student_ids: [n.student_id] } : a} studentById={studentById} showGrade={false} />}
                  <span>{n.room_id ? roomName.get(n.room_id) : ""}</span>
                  <span>{n.author_name ?? n.author_email}</span>
                  <span>{hhmm(n.created_at)}</span>
                  {n.task_id && <span className="rounded bg-indigo-100 px-1.5 text-indigo-700">업무보드에 후속 할 일</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{n.body}</p>
              </div>
            );
          })}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-bold text-slate-800">누가 무엇을 (최근 60건)</h3>
        <ul className="space-y-1 text-sm">
          {recent.length === 0 && <li className="text-slate-400">아직 기록이 없습니다.</li>}
          {recent.map((l, i) => {
            const a = apptById.get(l.appointment_id);
            return (
              <li key={`${l.appointment_id}-${l.at}-${i}`} className="flex flex-wrap items-center gap-2">
                <span className="w-12 font-mono text-xs text-slate-500">{hhmm(l.at)}</span>
                {a && <ApptNames appt={a} studentById={studentById} showGrade={false} />}
                <span className="text-slate-500">{ACTION_LABEL[l.action ?? ""] ?? l.action}</span>
                <span className="text-xs text-slate-400">
                  {l.from_status} → {l.to_status}
                  {l.room_id ? ` · ${roomName.get(l.room_id) ?? ""}` : ""}
                </span>
                <span className="ml-auto text-xs text-slate-400">{nameOfStaff.get((l.by_email ?? "").toLowerCase()) ?? l.by_email}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}
