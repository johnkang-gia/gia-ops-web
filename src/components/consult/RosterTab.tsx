"use client";

import { useMemo, useState } from "react";
import StudentSelect from "@/components/common/StudentSelect";
import { CLOSED_STATUSES, minutesToTime, siblingsOf, timeToMinutes, type ConsultAppt } from "@/lib/consult/model";
import type { ConsultState } from "@/lib/consult/server";
import { gradeSortKey } from "@/lib/department";
import type { Student } from "@/lib/students";
import type { ClassOption } from "./ConsultEventClient";
import { ApptNames, StatusChip, send } from "./shared";

/**
 * **명단 — 운영앱 명부에서 고릅니다.** 이름을 손으로 적는 칸이 없습니다(김재이가 셋입니다).
 *
 * 형제를 넣을 때 «한 번에 함께 상담»과 «따로 상담»을 고릅니다. 기본값은 행사 설정(묻기·함께·따로)
 * 이고, 넣은 뒤에도 나누거나 합칠 수 있습니다.
 */
export default function RosterTab({
  state,
  studentById,
  allStudents,
  classes,
  onChanged,
  onError,
}: {
  state: ConsultState;
  studentById: Map<string, Student>;
  allStudents: Student[];
  classes: ClassOption[];
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const ev = state.event;
  const inList = useMemo(
    () => new Set(state.appts.filter((a) => a.status !== "취소").flatMap((a) => a.student_ids)),
    [state.appts],
  );

  // ── 한 명씩 ──
  const [pick, setPick] = useState<string | null>(null);
  const [sibPicked, setSibPicked] = useState<string[]>([]);
  const [together, setTogether] = useState<boolean | null>(ev.sibling_default === "together" ? true : ev.sibling_default === "separate" ? false : null);
  const [time, setTime] = useState("");
  const [room, setRoom] = useState("");
  const [course, setCourse] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const siblings = useMemo(() => (pick ? siblingsOf(pick, allStudents).filter((s) => !inList.has(s.id)) : []), [pick, allStudents, inList]);

  function choose(id: string | null) {
    setPick(id);
    const sibs = id ? siblingsOf(id, allStudents).filter((s) => !inList.has(s.id)) : [];
    // 행사 설정이 «따로»가 아니면 형제를 미리 골라 둡니다 - 대부분 함께 오십니다.
    setSibPicked(ev.sibling_default === "separate" ? [] : sibs.map((s) => s.id));
  }

  async function addOne() {
    if (!pick) return onError("학생을 골라 주세요.");
    const ids = [pick, ...sibPicked];
    if (ids.length > 1 && together === null) return onError("형제를 함께 상담할지 따로 상담할지 골라 주세요.");
    setSaving(true);
    const r = await send(`/api/consult/events/${ev.id}/appointments`, "POST", {
      mode: "single",
      student_ids: ids,
      together: ids.length > 1 ? together : true,
      scheduled_time: time || null,
      room_id: room || null,
      course_room_ids: course,
      note,
    });
    setSaving(false);
    if (!r.ok) return onError(r.error ?? "넣지 못했습니다.");
    onError(null);
    setPick(null);
    setSibPicked([]);
    setNote("");
    // 다음 사람 시각을 기본 상담 시간만큼 밀어 둡니다 - 차례로 입력할 때 손이 덜 갑니다.
    const t = timeToMinutes(time);
    if (t !== null) {
      const next = t + ev.default_minutes * (ids.length > 1 && together === false ? ids.length : 1);
      setTime(minutesToTime(next));
    }
    await onChanged();
  }

  // ── 반 단위 ──
  const [bulkClasses, setBulkClasses] = useState<string[]>([]);
  const [bulkSibling, setBulkSibling] = useState<"together" | "separate">(ev.sibling_default === "together" ? "together" : "separate");
  const [bulkStart, setBulkStart] = useState("");
  const [bulkInterval, setBulkInterval] = useState(ev.default_minutes);
  const [bulkRoom, setBulkRoom] = useState<string>("homeroom");
  const [bulkCourse, setBulkCourse] = useState<string[]>([]);
  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => gradeSortKey(a.grade) - gradeSortKey(b.grade) || (a.class_name ?? "").localeCompare(b.class_name ?? "", "ko")),
    [classes],
  );
  const countIn = (cid: string) => allStudents.filter((s) => s.class_id === cid && !inList.has(s.id)).length;

  async function addBulk() {
    if (bulkClasses.length === 0) return onError("반을 하나 이상 골라 주세요.");
    setSaving(true);
    const r = await send(`/api/consult/events/${ev.id}/appointments`, "POST", {
      mode: "classes",
      class_ids: bulkClasses,
      sibling: bulkSibling,
      start_time: bulkStart || null,
      interval: bulkInterval,
      room: bulkRoom === "none" ? null : bulkRoom,
      course_room_ids: bulkCourse,
    });
    setSaving(false);
    if (!r.ok) return onError(r.error ?? "넣지 못했습니다.");
    onError(null);
    setBulkClasses([]);
    alert(`${r.data?.students ?? 0}명(예약 ${r.data?.appointments ?? 0}건)을 넣었습니다.`);
    await onChanged();
  }

  // ── 목록 고치기 ──
  async function patch(a: ConsultAppt, body: Record<string, unknown>) {
    const r = await send(`/api/consult/appointments/${a.id}`, "PATCH", body);
    if (!r.ok) onError(r.error ?? "고치지 못했습니다.");
    await onChanged();
  }
  async function remove(a: ConsultAppt) {
    if (!confirm("이 예약을 명단에서 지울까요?")) return;
    const r = await send(`/api/consult/appointments/${a.id}`, "DELETE");
    if (!r.ok) onError(r.error ?? "지우지 못했습니다.");
    await onChanged();
  }
  /** 함께 넣은 형제를 따로 나눕니다 - 둘째부터 새 예약으로. */
  async function split(a: ConsultAppt) {
    const [first, ...rest] = a.student_ids;
    const r1 = await send(`/api/consult/appointments/${a.id}`, "PATCH", { student_ids: [first] });
    if (!r1.ok) return onError(r1.error ?? "나누지 못했습니다.");
    const r2 = await send(`/api/consult/events/${ev.id}/appointments`, "POST", {
      mode: "single",
      student_ids: rest,
      together: false,
      scheduled_time: a.scheduled_time,
      room_id: a.room_id,
      course_room_ids: a.course_room_ids,
    });
    if (!r2.ok) onError(r2.error ?? "나눈 형제를 넣지 못했습니다.");
    await onChanged();
  }
  /** 따로 들어간 형제 예약을 이 예약으로 합칩니다(상대 예약은 지웁니다). */
  async function merge(a: ConsultAppt, other: ConsultAppt) {
    const r1 = await send(`/api/consult/appointments/${other.id}`, "DELETE");
    if (!r1.ok) return onError(r1.error ?? "합치지 못했습니다.");
    const r2 = await send(`/api/consult/appointments/${a.id}`, "PATCH", { student_ids: [...a.student_ids, ...other.student_ids] });
    if (!r2.ok) onError(r2.error ?? "합치지 못했습니다.");
    await onChanged();
  }

  const sorted = [...state.appts].sort(
    (x, y) => (timeToMinutes(x.scheduled_time) ?? 9999) - (timeToMinutes(y.scheduled_time) ?? 9999),
  );
  const roomName = new Map(state.rooms.map((r) => [r.id, r.name]));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">한 명씩 넣기</h3>
          <StudentSelect
            students={allStudents.filter((s) => !inList.has(s.id))}
            value={pick}
            onChange={choose}
            placeholder="학생 이름·반·생일로 찾기…"
          />
          {siblings.length > 0 && (
            <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-900">형제가 있습니다</p>
              <div className="flex flex-wrap gap-2">
                {siblings.map((s) => (
                  <label key={s.id} className="flex items-center gap-1.5 rounded bg-white px-2 py-1 ring-1 ring-amber-200">
                    <input
                      type="checkbox"
                      checked={sibPicked.includes(s.id)}
                      onChange={(e) => setSibPicked((p) => (e.target.checked ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                    />
                    {s.name} <span className="text-xs text-slate-500">{s.grade} {s.class_name}</span>
                  </label>
                ))}
              </div>
              {sibPicked.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={together === true} onChange={() => setTogether(true)} />
                    한 번에 함께 상담
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={together === false} onChange={() => setTogether(false)} />
                    따로 상담(시각 이어서)
                  </label>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-500">
              예약 시각
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              상담실
              <select value={room} onChange={(e) => setRoom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">미정(도착 후 정함)</option>
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CoursePicker rooms={state.rooms} value={course} onChange={setCourse} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="안내 메모(현황판에 안 나갑니다)" className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
          <button onClick={() => void addOne()} disabled={saving || !pick} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            명단에 넣기
          </button>
        </section>

        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-bold text-slate-800">반 단위로 한꺼번에</h3>
          <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {sortedClasses.map((c) => {
              const n = countIn(c.id);
              const on = bulkClasses.includes(c.id);
              return (
                <button
                  key={c.id}
                  disabled={n === 0}
                  onClick={() => setBulkClasses((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                  className={`rounded-full px-2.5 py-1 text-xs ring-1 disabled:opacity-30 ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200"}`}
                >
                  {c.grade} {c.class_name} · {n}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={bulkSibling === "together"} onChange={() => setBulkSibling("together")} />
              형제는 함께
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={bulkSibling === "separate"} onChange={() => setBulkSibling("separate")} />
              형제도 따로
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs text-slate-500">
              첫 시각
              <input type="time" value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="text-xs text-slate-500">
              간격(분)
              <input
                type="number"
                min={1}
                value={bulkInterval}
                onChange={(e) => setBulkInterval(Number(e.target.value) || ev.default_minutes)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs text-slate-500">
              상담실
              <select value={bulkRoom} onChange={(e) => setBulkRoom(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="homeroom">담임 선생님 방</option>
                <option value="none">미정</option>
                {state.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CoursePicker rooms={state.rooms} value={bulkCourse} onChange={setBulkCourse} />
          <p className="text-xs text-slate-500">이미 명단에 있는 아이는 건너뜁니다. 시각을 비우면 시각 없이 넣습니다.</p>
          <button onClick={() => void addBulk()} disabled={saving || bulkClasses.length === 0} className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
            고른 반 넣기
          </button>
        </section>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">시각</th>
              <th className="px-3 py-2">학생</th>
              <th className="px-3 py-2">상담실 · 순회 코스</th>
              <th className="px-3 py-2">메모</th>
              <th className="px-3 py-2">상태</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  아직 명단이 없습니다.
                </td>
              </tr>
            )}
            {sorted.map((a) => {
              const sibAppt = state.appts.find(
                (o) =>
                  o.id !== a.id &&
                  !CLOSED_STATUSES.includes(o.status) &&
                  o.student_ids.some((sid) => a.student_ids.some((mine) => siblingsOf(mine, allStudents).some((x) => x.id === sid))),
              );
              return (
                <tr key={a.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      defaultValue={a.scheduled_time ?? ""}
                      onBlur={(e) => e.target.value !== (a.scheduled_time ?? "") && void patch(a, { scheduled_time: e.target.value || null })}
                      className="rounded border border-slate-300 px-1.5 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <ApptNames appt={a} studentById={studentById} />
                    <div className="mt-1 flex gap-1">
                      {a.student_ids.length > 1 && (
                        <button onClick={() => void split(a)} className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600 hover:bg-slate-200">
                          형제 따로 나누기
                        </button>
                      )}
                      {sibAppt && (
                        <button onClick={() => void merge(a, sibAppt)} className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 hover:bg-amber-200">
                          형제와 합치기
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="mb-1 text-slate-700">{a.room_id ? roomName.get(a.room_id) : <span className="text-slate-400">미정</span>}</div>
                    <CoursePicker rooms={state.rooms} value={a.course_room_ids} onChange={(v) => void patch(a, { course_room_ids: v })} compact />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      defaultValue={a.note ?? ""}
                      onBlur={(e) => e.target.value !== (a.note ?? "") && void patch(a, { note: e.target.value })}
                      className="w-full rounded border border-slate-300 px-1.5 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={a.status} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => void remove(a)} className="text-xs text-rose-500 hover:text-rose-700">
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/**
 * 순회 코스 — 여러 선생님을 차례로 만나야 할 때(담임 + 과목 선생님). 비워 두면 지금 방 하나로 끝납니다.
 * 고른 순서는 의미가 없습니다: 끝날 때마다 **가장 빨리 볼 수 있는 방**으로 자동 배정합니다.
 */
function CoursePicker({
  rooms,
  value,
  onChange,
  compact = false,
}: {
  rooms: ConsultState["rooms"];
  value: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
}) {
  if (rooms.length < 2) return null;
  return (
    <div className="space-y-1">
      {!compact && <p className="text-xs text-slate-500">순회 코스(여러 선생님을 만날 때만)</p>}
      <div className="flex flex-wrap gap-1">
        {rooms.map((r) => {
          const on = value.includes(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onChange(on ? value.filter((x) => x !== r.id) : [...value, r.id])}
              className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${on ? "bg-sky-600 text-white ring-sky-600" : "bg-white text-slate-600 ring-slate-200"}`}
            >
              {r.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
