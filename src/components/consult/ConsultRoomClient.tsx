"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLang, useT } from "@/components/common/LanguageProvider";
import { estimate, roomQueue, startedAtMap, type ConsultAppt, type ConsultEvent } from "@/lib/consult/model";
import type { ConsultState } from "@/lib/consult/server";
import type { Student } from "@/lib/students";
import { useConsultEvent, waitLabel } from "./useConsultEvent";
import { ApptNames, StatusChip, send } from "./shared";

/**
 * **면담 화면.** 선생님 한 분이 들어간 상담실에서 «다음 분 호출 → 시작 → 메모 → 종료»를 합니다.
 * 종료하면 순회 코스가 남은 분은 가장 빨리 볼 수 있는 다음 방으로 자동 배정되고, 그 방 선생님
 * 화면과 로비 현황판에 그 순간 뜹니다.
 *
 * 선생님 화면은 한·영 두 말로 씁니다(교사 화면 전체가 그렇습니다).
 */
export default function ConsultRoomClient({
  events,
  initial,
  initialRoom,
  myEmail,
  staff,
  loadError,
}: {
  events: ConsultEvent[];
  initial: ConsultState | null;
  initialRoom: string | null;
  myEmail: string;
  staff: boolean;
  loadError: string | null;
}) {
  const t = useT();
  const router = useRouter();
  if (!initial) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-bold text-slate-900">{t("학부모 상담", "Parent Conferences")}</h1>
        <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {loadError ?? t("지금 열린 상담 행사가 없습니다.", "There is no open conference event right now.")}
        </p>
      </div>
    );
  }
  return (
    <RoomInner
      events={events}
      initial={initial}
      initialRoom={initialRoom}
      myEmail={myEmail}
      staff={staff}
      onPickEvent={(id) => router.push(`/consult?event=${id}`)}
    />
  );
}

function RoomInner({
  events,
  initial,
  initialRoom,
  myEmail,
  staff,
  onPickEvent,
}: {
  events: ConsultEvent[];
  initial: ConsultState;
  initialRoom: string | null;
  myEmail: string;
  staff: boolean;
  onPickEvent: (id: string) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const live = useConsultEvent(initial.event.id, initial);
  const state = live.state ?? initial;
  // 어느 방이든 고를 수 있습니다. 그날 대신 들어간 방도 그 선생님이 누를 수 있어야 하기 때문입니다.
  // 자기 계정으로 정해진 방이 있으면 그 방을 먼저 엽니다.
  const mine = state.rooms.filter((r) => (r.teacher_email ?? "").toLowerCase() === myEmail.toLowerCase());
  const pickable = staff ? state.rooms : [...mine, ...state.rooms.filter((r) => !mine.includes(r))];
  const [roomId, setRoomId] = useState<string | null>(initialRoom && pickable.some((r) => r.id === initialRoom) ? initialRoom : pickable[0]?.id ?? null);
  const room = state.rooms.find((r) => r.id === roomId) ?? null;
  const studentById = useMemo(() => new Map<string, Student>(state.students.map((s) => [s.id, s])), [state.students]);
  const { waits } = useMemo(
    () => estimate(state.appts, state.rooms, state.logs, state.event.default_minutes, live.now),
    [state.appts, state.rooms, state.logs, state.event.default_minutes, live.now],
  );
  const started = useMemo(() => startedAtMap(state.logs), [state.logs]);
  const [flash, setFlash] = useState<string | null>(null);

  const queue = room ? roomQueue(state.appts, room.id) : [];
  const current = queue.filter((a) => a.status === "상담중");
  const waiting = queue.filter((a) => a.status !== "상담중");
  const upcoming = room
    ? state.appts
        .filter((a) => a.room_id === room.id && a.status === "미도착")
        .sort((x, y) => (x.scheduled_time ?? "99").localeCompare(y.scheduled_time ?? "99"))
    : [];
  const roomName = (id: string | null) => state.rooms.find((r) => r.id === id)?.name ?? "";

  async function finish(a: ConsultAppt) {
    const ok = await live.act(a.id, { kind: "finish" });
    if (ok) {
      const remaining = a.course_room_ids.filter((r) => !a.done_room_ids.includes(r) && r !== a.room_id);
      setFlash(
        remaining.length
          ? t("다음 상담실로 안내했습니다. 현황판에 표시됩니다.", "Sent to the next room. It is shown on the board.")
          : t("상담을 마쳤습니다.", "Conference completed."),
      );
      setTimeout(() => setFlash(null), 4000);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-slate-900">{t("면담 화면", "My Conference Room")}</h1>
        {events.length > 1 && (
          <select value={state.event.id} onChange={(e) => onPickEvent(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        )}
        {events.length <= 1 && <span className="text-sm text-slate-500">{state.event.name}</span>}
        {pickable.length > 1 && (
          <select value={roomId ?? ""} onChange={(e) => setRoomId(e.target.value)} className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-sm">
            {pickable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.teacher_name ? `· ${r.teacher_name}` : ""}
              </option>
            ))}
          </select>
        )}
      </header>

      {live.error && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span className="flex-1">{live.error}</span>
          <button onClick={() => live.setError(null)}>✕</button>
        </div>
      )}
      {flash && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{flash}</div>}

      {!room && (
        <p className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-800">
          {t(
            "이 행사에 아직 상담실이 없습니다. 행정실에 상담실을 만들어 달라고 알려 주세요.",
            "This event has no conference rooms yet. Please ask the office to add them.",
          )}
        </p>
      )}

      {room && (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-indigo-700">{room.name}</span>
            <span className="text-sm text-slate-500">{room.teacher_name}</span>
            {state.event.status !== "진행" && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {t(`행사 상태: ${state.event.status}`, `Event: ${state.event.status === "준비" ? "preparing" : "closed"}`)}
              </span>
            )}
          </div>

          {current.map((a) => (
            <CurrentCard
              key={a.id}
              appt={a}
              studentById={studentById}
              startedAt={started.get(a.id) ?? null}
              now={live.now}
              busy={live.busy === a.id}
              roomName={roomName}
              roomId={room.id}
              onFinish={() => void finish(a)}
              onUndo={() => void live.act(a.id, { kind: "undo" })}
              onNoteSaved={live.reload}
              onError={live.setError}
            />
          ))}

          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-700">
              {t("기다리는 분", "Waiting")} · {waiting.length}
            </h2>
            {waiting.length === 0 && (
              <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-400">{t("기다리는 분이 없습니다.", "No one is waiting.")}</p>
            )}
            {waiting.map((a, i) => (
              <div key={a.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${i === 0 ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}>
                <span className="w-6 text-center text-lg font-bold text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <ApptNames appt={a} studentById={studentById} />
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-500">
                    {a.scheduled_time && <span>{t("예약", "Booked")} {a.scheduled_time}</span>}
                    {a.delay_min > 0 && <span className="text-amber-700">+{a.delay_min}{t("분 늦음", " min late")}</span>}
                    <span>{waitLabel(waits.get(a.id), lang === "en")}</span>
                    {a.done_room_ids.length > 0 && <span>{t("다녀온 방", "Visited")}: {a.done_room_ids.map(roomName).join(", ")}</span>}
                  </div>
                </div>
                <StatusChip status={a.status} />
                {a.called_at && a.status === "상담준비" && <span className="text-xs text-sky-700">📣 {t("호출함", "Called")}</span>}
                <div className="flex gap-1.5">
                  <button
                    onClick={() => void live.act(a.id, { kind: "call" })}
                    disabled={live.busy === a.id}
                    className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
                  >
                    📣 {a.called_at ? t("다시 호출", "Call again") : t("호출", "Call")}
                  </button>
                  <button
                    onClick={() => void live.act(a.id, { kind: "start", room_id: room.id })}
                    disabled={live.busy === a.id}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    ▶ {t("시작", "Start")}
                  </button>
                </div>
              </div>
            ))}
          </section>

          {upcoming.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-bold text-slate-500">{t("아직 안 오신 분", "Not arrived yet")}</h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {upcoming.map((a) => (
                  <li key={a.id} className="rounded-lg bg-slate-50 px-2.5 py-1 text-slate-600">
                    {a.scheduled_time ?? "--:--"} <ApptNames appt={a} studentById={studentById} showGrade={false} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CurrentCard({
  appt,
  studentById,
  startedAt,
  now,
  busy,
  roomName,
  roomId,
  onFinish,
  onUndo,
  onNoteSaved,
  onError,
}: {
  appt: ConsultAppt;
  studentById: Map<string, Student>;
  startedAt: number | null;
  now: number;
  busy: boolean;
  roomName: (id: string | null) => string;
  roomId: string;
  onFinish: () => void;
  onUndo: () => void;
  onNoteSaved: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const t = useT();
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState("");
  const [who, setWho] = useState<string>(appt.student_ids.length === 1 ? appt.student_ids[0] : "");
  const [saving, setSaving] = useState(false);
  const minutes = startedAt ? Math.max(0, Math.floor((now - startedAt) / 60000)) : null;
  const remaining = appt.course_room_ids.filter((r) => !appt.done_room_ids.includes(r) && r !== appt.room_id);

  async function saveNote() {
    if (!body.trim()) return;
    setSaving(true);
    const r = await send(`/api/consult/appointments/${appt.id}/notes`, "POST", { body, follow_up: follow, student_id: who || null, room_id: roomId });
    setSaving(false);
    if (!r.ok) return onError(r.error ?? t("메모를 남기지 못했습니다.", "Could not save the note."));
    onError(null);
    setBody("");
    setFollow("");
    await onNoteSaved();
  }

  return (
    <section className="space-y-3 rounded-2xl border-2 border-emerald-400 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-emerald-600 px-3 py-1 text-sm font-bold text-white">{t("상담중", "In conference")}</span>
        <span className="text-lg">
          <ApptNames appt={appt} studentById={studentById} />
        </span>
        {minutes !== null && <span className="text-sm text-emerald-800">{minutes}{t("분째", " min")}</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={onUndo} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 disabled:opacity-40">
            ↩ {t("되돌리기", "Undo")}
          </button>
          <button onClick={onFinish} disabled={busy} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-40">
            {remaining.length ? t(`종료 → 다음 방(${remaining.length})`, `Finish → next room (${remaining.length})`) : t("상담 종료", "Finish")}
          </button>
        </div>
      </div>
      {remaining.length > 0 && (
        <p className="text-xs text-emerald-800">
          {t("남은 방", "Remaining")}: {remaining.map(roomName).join(", ")} · {t("종료하면 가장 빨리 볼 수 있는 방으로 자동 안내합니다.", "On finish, the family is sent to the room with the shortest wait.")}
        </p>
      )}
      <div className="space-y-2 rounded-xl bg-white p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {t("상담 메모 — 나와 관리자만 봅니다", "Conference note — visible only to you and admins")}
          {appt.student_ids.length > 1 && (
            <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded border border-slate-300 px-1 py-0.5">
              <option value="">{t("형제 함께", "Siblings together")}</option>
              {appt.student_ids.map((sid) => (
                <option key={sid} value={sid}>
                  {studentById.get(sid)?.name ?? sid}
                </option>
              ))}
            </select>
          )}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder={t("상담 내용·학부모 요청", "What was discussed / parent requests")}
          className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <input
            value={follow}
            onChange={(e) => setFollow(e.target.value)}
            placeholder={t("후속 할 일(적으면 업무보드에 올라갑니다)", "Follow-up (creates a task on the work board)")}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <button onClick={() => void saveNote()} disabled={saving || !body.trim()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
            {t("메모 저장", "Save note")}
          </button>
        </div>
      </div>
    </section>
  );
}
