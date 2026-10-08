import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudents, loadStudentsWithPhones, type Student, type StudentWithPhones } from "@/lib/students";
import {
  CLOSED_STATUSES,
  aheadCount,
  estimate,
  finishPlan,
  isConsultStatus,
  maskPersonName,
  pickNextRoom,
  toggleTarget,
  type ConsultAppt,
  type ConsultEvent,
  type ConsultLog,
  type ConsultRoom,
  type ConsultStatus,
} from "./model";

/**
 * **학부모 상담 — 읽고 쓰는 자리.** 판정은 `model.ts` 가 하고, 여기는 표를 읽고 고치고 기록합니다.
 *
 * 화면(안내데스크·면담자)은 표를 직접 고치지 않고 `applyConsultAction` 만 부릅니다. 상태가 바뀔
 * 때마다 기록(consult_status_log)이 남아야 하는데, 화면이 직접 고치면 언젠가 한 곳이 기록을
 * 빠뜨리고, 그러면 «누가 바꿨나»와 «평균 상담 시간»이 조용히 틀립니다.
 */

export const EVENT_COLUMNS =
  "id, name, event_date, end_date, status, mask_names, sibling_default, default_minutes, board_token, board_enabled, board_expires_at, board_short_code, personal_links_enabled, is_demo, created_at";
export const ROOM_COLUMNS = "id, event_id, name, teacher_email, teacher_name, grade_label, sort_order";
export const APPT_COLUMNS =
  "id, event_id, scheduled_time, room_id, status, prev_status, delay_min, arrived_at, called_at, course_room_ids, done_room_ids, note, personal_token, updated_by, updated_at";
const LOG_COLUMNS = "appointment_id, from_status, to_status, room_id, action, by_email, at";

type ApptRow = Omit<ConsultAppt, "student_ids"> & { consult_appointment_students: { student_id: string }[] | null };

function toAppt(r: ApptRow): ConsultAppt {
  const { consult_appointment_students: links, ...rest } = r;
  return {
    ...rest,
    status: isConsultStatus(rest.status) ? rest.status : "미도착",
    prev_status: isConsultStatus(rest.prev_status) ? rest.prev_status : null,
    course_room_ids: rest.course_room_ids ?? [],
    done_room_ids: rest.done_room_ids ?? [],
    student_ids: (links ?? []).map((l) => l.student_id),
  };
}

export type ConsultNote = {
  id: string;
  appointment_id: string;
  student_id: string | null;
  room_id: string | null;
  author_email: string;
  author_name: string | null;
  body: string;
  task_id: string | null;
  created_at: string;
};

export type ConsultState = {
  event: ConsultEvent;
  rooms: ConsultRoom[];
  appts: ConsultAppt[];
  logs: ConsultLog[];
  /** 이 행사 예약에 붙은 학생들(번호로 찾습니다). */
  students: (Student | StudentWithPhones)[];
  /** 예약마다 담임 선생님 상담실(다음 방 고를 때 먼저 봅니다). */
  homeroomRooms: Record<string, string[]>;
  /** 상담 메모. 표의 자물쇠가 «쓴 사람 + 관리자»만 돌려줍니다. */
  notes: ConsultNote[];
};

export async function loadConsultState(
  supabase: SupabaseClient,
  eventId: string,
  opts: { phones?: boolean } = {},
): Promise<{ state: ConsultState | null; error: string | null }> {
  const [evRes, roomRes, apptRes, logRes] = await Promise.all([
    supabase.from("consult_events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle(),
    supabase.from("consult_rooms").select(ROOM_COLUMNS).eq("event_id", eventId).order("sort_order").order("name"),
    supabase.from("consult_appointments").select(`${APPT_COLUMNS}, consult_appointment_students(student_id)`).eq("event_id", eventId),
    supabase.from("consult_status_log").select(LOG_COLUMNS).eq("event_id", eventId).order("at"),
  ]);
  const err = evRes.error ?? roomRes.error ?? apptRes.error ?? logRes.error;
  if (err) return { state: null, error: err.message };
  if (!evRes.data) return { state: null, error: "상담 행사를 찾지 못했습니다." };

  const event = evRes.data as unknown as ConsultEvent;
  const rooms = (roomRes.data ?? []) as unknown as ConsultRoom[];
  const appts = ((apptRes.data ?? []) as unknown as ApptRow[]).map(toAppt);
  const ids = [...new Set(appts.flatMap((a) => a.student_ids))];

  // 퇴소한 아이가 예약에 남아 있을 수 있어 "all" 로 읽습니다 - 지난 행사 기록이 이름 없이 뜨면 안 됩니다.
  const stuRes = opts.phones
    ? await loadStudentsWithPhones(supabase, { ids, demo: event.is_demo, status: "all" })
    : await loadStudents(supabase, { ids, demo: event.is_demo, status: "all" });
  if (stuRes.error) return { state: null, error: stuRes.error };

  // 담임 방: 학생의 반 → 담임(부담임) 이메일 → 그 선생님이 앉은 상담실.
  const classIds = [...new Set(stuRes.rows.map((s) => s.class_id).filter((v): v is string => !!v))];
  const clsRes = classIds.length
    ? await supabase.from("wr_classes").select("id, teacher_email, sub_teacher_email").eq("is_demo", event.is_demo).in("id", classIds)
    : { data: [] as { id: string; teacher_email: string | null; sub_teacher_email: string | null }[], error: null };
  if (clsRes.error) return { state: null, error: clsRes.error.message };
  const teachersOfClass = new Map(
    ((clsRes.data ?? []) as { id: string; teacher_email: string | null; sub_teacher_email: string | null }[]).map((c) => [
      c.id,
      [c.teacher_email, c.sub_teacher_email].filter((v): v is string => !!v).map((v) => v.toLowerCase()),
    ]),
  );
  const studentById = new Map(stuRes.rows.map((s) => [s.id, s]));
  const homeroomRooms: Record<string, string[]> = {};
  for (const a of appts) {
    const emails = new Set(a.student_ids.flatMap((sid) => teachersOfClass.get(studentById.get(sid)?.class_id ?? "") ?? []));
    homeroomRooms[a.id] = rooms.filter((r) => r.teacher_email && emails.has(r.teacher_email.toLowerCase())).map((r) => r.id);
  }

  const apptIds = appts.map((a) => a.id);
  const noteRes = apptIds.length
    ? await supabase
        .from("consult_notes")
        .select("id, appointment_id, student_id, room_id, author_email, author_name, body, task_id, created_at")
        .in("appointment_id", apptIds)
        .order("created_at")
    : { data: [] as ConsultNote[], error: null };
  if (noteRes.error) return { state: null, error: noteRes.error.message };

  return {
    state: {
      event,
      rooms,
      appts,
      logs: (logRes.data ?? []) as unknown as ConsultLog[],
      students: stuRes.rows,
      homeroomRooms,
      notes: (noteRes.data ?? []) as unknown as ConsultNote[],
    },
    error: null,
  };
}

// ── 상태 바꾸기 ─────────────────────────────────────────────────────────────

export type ConsultAction =
  | { kind: "arrive" }
  | { kind: "set_status"; status: ConsultStatus }
  | { kind: "assign"; room_id: string | null; status?: ConsultStatus }
  | { kind: "call" }
  | { kind: "start"; room_id?: string | null }
  | { kind: "finish" }
  | { kind: "cancel" }
  | { kind: "phone" }
  | { kind: "delay"; minutes: number }
  | { kind: "undo" };

const SNAPSHOT_KEYS = ["status", "prev_status", "room_id", "done_room_ids", "called_at", "arrived_at", "delay_min"] as const;
type Snapshot = Pick<ConsultAppt, (typeof SNAPSHOT_KEYS)[number]>;

function snapshotOf(a: ConsultAppt): Snapshot {
  return {
    status: a.status,
    prev_status: a.prev_status,
    room_id: a.room_id,
    done_room_ids: a.done_room_ids,
    called_at: a.called_at,
    arrived_at: a.arrived_at,
    delay_min: a.delay_min,
  };
}

/**
 * 버튼 하나를 처리합니다. **누가 먼저 바꿨으면 거절합니다** - 안내데스크와 면담 선생님이 같은
 * 예약을 동시에 누르는 일이 실제로 생기고, 나중 것이 앞의 것을 조용히 덮으면 «상담중»이던 분이
 * «대기»로 돌아가 있는 일이 납니다. 거절하면 화면이 다시 읽고 사람이 한 번 더 봅니다.
 */
export async function applyConsultAction(
  supabase: SupabaseClient,
  apptId: string,
  action: ConsultAction,
  byEmail: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data: row, error: readErr } = await supabase
    .from("consult_appointments")
    .select(`${APPT_COLUMNS}, consult_appointment_students(student_id)`)
    .eq("id", apptId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message, status: 500 };
  if (!row) return { ok: false, error: "예약을 찾지 못했습니다.", status: 404 };
  const a = toAppt(row as unknown as ApptRow);
  const now = new Date().toISOString();

  let patch: Partial<Snapshot> & { course_room_ids?: string[] } = {};
  let logRoom: string | null = a.room_id;

  switch (action.kind) {
    case "arrive":
      if (CLOSED_STATUSES.includes(a.status)) return { ok: false, error: `이미 「${a.status}」인 예약입니다.`, status: 409 };
      patch = { status: a.status === "미도착" ? "대기" : a.status, arrived_at: a.arrived_at ?? now };
      break;
    case "set_status":
      if (!isConsultStatus(action.status)) return { ok: false, error: "모르는 상태입니다.", status: 400 };
      if (action.status === "상담중" && !a.room_id) return { ok: false, error: "상담실을 먼저 정해 주세요.", status: 400 };
      patch = { status: action.status, prev_status: null };
      if ((action.status === "대기" || action.status === "상담준비" || action.status === "상담중") && !a.arrived_at) patch.arrived_at = now;
      if (action.status !== "상담준비") patch.called_at = null;
      break;
    case "assign":
      patch = { room_id: action.room_id };
      logRoom = action.room_id;
      if (action.status) {
        if (!isConsultStatus(action.status)) return { ok: false, error: "모르는 상태입니다.", status: 400 };
        patch.status = action.status;
        if (action.status !== "미도착" && !a.arrived_at) patch.arrived_at = now;
      }
      break;
    case "call":
      if (!a.room_id) return { ok: false, error: "상담실이 정해지지 않은 예약은 호출할 수 없습니다.", status: 400 };
      if (a.status === "상담중") return { ok: false, error: "이미 상담중입니다.", status: 409 };
      if (CLOSED_STATUSES.includes(a.status)) return { ok: false, error: `이미 「${a.status}」인 예약입니다.`, status: 409 };
      patch = { status: "상담준비", called_at: now, arrived_at: a.arrived_at ?? now };
      break;
    case "start": {
      const room = action.room_id ?? a.room_id;
      if (!room) return { ok: false, error: "상담실을 먼저 정해 주세요.", status: 400 };
      patch = { status: "상담중", room_id: room, called_at: null, arrived_at: a.arrived_at ?? now };
      logRoom = room;
      break;
    }
    case "finish": {
      if (a.status !== "상담중") return { ok: false, error: "상담중인 예약만 마칠 수 있습니다.", status: 409 };
      const { state, error } = await loadConsultState(supabase, a.event_id);
      if (!state) return { ok: false, error: error ?? "행사를 읽지 못했습니다.", status: 500 };
      // 다음 방을 고를 때 지금 이 예약은 줄에서 뺍니다(곧 끝나는 사람이 남의 줄을 길게 보이게 하면 안 됩니다).
      const others = state.appts.filter((x) => x.id !== a.id);
      const { rooms: timings } = estimate(others, state.rooms, state.logs, state.event.default_minutes, Date.now());
      const prefer = new Set(state.homeroomRooms[a.id] ?? []);
      const plan = finishPlan(a, (remaining) => pickNextRoom(remaining, timings, prefer));
      patch = { status: plan.status, room_id: plan.room_id, done_room_ids: plan.done_room_ids, called_at: null };
      logRoom = plan.room_id;
      break;
    }
    case "cancel":
    case "phone": {
      const t = toggleTarget(a, action.kind === "cancel" ? "취소" : "전화상담");
      patch = { status: t.status, prev_status: t.prev_status, called_at: null };
      break;
    }
    case "delay": {
      const m = Math.max(0, Math.min(600, Math.round(Number(action.minutes) || 0)));
      patch = { delay_min: m };
      break;
    }
    case "undo": {
      const { data: last, error } = await supabase
        .from("consult_status_log")
        .select("before")
        .eq("appointment_id", a.id)
        .not("before", "is", null)
        .order("at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { ok: false, error: error.message, status: 500 };
      const before = (last as { before: Partial<Snapshot> } | null)?.before;
      if (!before) return { ok: false, error: "되돌릴 기록이 없습니다.", status: 409 };
      patch = {};
      for (const k of SNAPSHOT_KEYS) if (k in before) (patch as Record<string, unknown>)[k] = (before as Record<string, unknown>)[k];
      logRoom = (patch.room_id as string | null | undefined) ?? a.room_id;
      break;
    }
  }

  const { data: updated, error: upErr } = await supabase
    .from("consult_appointments")
    .update({ ...patch, updated_by: byEmail })
    .eq("id", a.id)
    .eq("updated_at", a.updated_at)
    .select("id");
  if (upErr) return { ok: false, error: upErr.message, status: 500 };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "다른 분이 방금 이 예약을 바꿨습니다. 화면을 새로 읽었으니 다시 확인해 주세요.", status: 409 };
  }

  const nextStatus = (patch.status as ConsultStatus | undefined) ?? a.status;
  const { error: logErr } = await supabase.from("consult_status_log").insert({
    appointment_id: a.id,
    event_id: a.event_id,
    from_status: a.status,
    to_status: nextStatus,
    room_id: logRoom,
    before: snapshotOf(a),
    action: action.kind,
    by_email: byEmail,
  });
  // 예약은 이미 바뀌었습니다. 기록만 못 남긴 것이므로 되돌리지 않되, 조용히 넘기지도 않습니다.
  if (logErr) return { ok: false, error: `바꾸기는 됐지만 기록을 남기지 못했습니다: ${logErr.message}`, status: 500 };
  return { ok: true };
}

// ── 로그인 없는 화면에 보낼 것 ──────────────────────────────────────────────

/** 예약 하나를 현황판에 적을 이름. 형제를 함께 상담하면 「김*하·김*준」. */
export function apptLabel(a: ConsultAppt, studentById: Map<string, Pick<Student, "name">>, mask: boolean): string {
  const names = a.student_ids.map((id) => studentById.get(id)?.name).filter((v): v is string => !!v);
  return names.length ? names.map((n) => maskPersonName(n, mask)).join("·") : "(이름 없음)";
}

export type BoardPayload = {
  eventName: string;
  eventDate: string | null;
  rooms: {
    id: string;
    name: string;
    teacher: string | null;
    gradeLabel: string | null;
    now: { label: string; grade: string | null }[];
    next: { label: string; grade: string | null; called: boolean; wait: number | null }[];
    waitingMore: number;
    busyFor: number;
  }[];
  /** 도착했지만 방이 아직 안 정해진 분. */
  lobby: { label: string; grade: string | null; time: string | null }[];
  /** 최근 2분 안의 호출 - 현황판이 크게 띄우고 소리를 냅니다. */
  calls: { id: string; label: string; room: string; at: string }[];
  counts: { notArrived: number; waiting: number; inSession: number; done: number; total: number };
};

/**
 * 현황판에 보낼 자료. **학생 번호·전화번호·메모는 담지 않습니다.** 로그인 없이 여는 화면은
 * 서버가 고른 칸만 받아야 합니다 - 구글시트판은 화면에 안 쓰는 전화번호까지 실어 보내서,
 * 주소만 알면 개발자 도구로 전부 받아 갈 수 있었습니다.
 */
export function buildBoardPayload(state: ConsultState, now: number): BoardPayload {
  const { event, rooms, appts, logs } = state;
  const studentById = new Map(state.students.map((s) => [s.id, s]));
  const gradeOf = (a: ConsultAppt) => studentById.get(a.student_ids[0] ?? "")?.grade ?? null;
  const label = (a: ConsultAppt) => apptLabel(a, studentById, event.mask_names);
  const { rooms: timing, waits } = estimate(appts, rooms, logs, event.default_minutes, now);
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));

  return {
    eventName: event.name,
    eventDate: event.event_date,
    rooms: rooms.map((r) => {
      const inRoom = appts.filter((a) => a.room_id === r.id);
      const now_ = inRoom.filter((a) => a.status === "상담중");
      const queue = inRoom
        .filter((a) => a.status === "상담준비" || a.status === "대기")
        .sort((x, y) => (waits.get(x.id) ?? 0) - (waits.get(y.id) ?? 0));
      return {
        id: r.id,
        name: r.name,
        teacher: r.teacher_name,
        gradeLabel: r.grade_label,
        now: now_.map((a) => ({ label: label(a), grade: gradeOf(a) })),
        next: queue.slice(0, 3).map((a) => ({
          label: label(a),
          grade: gradeOf(a),
          called: a.status === "상담준비" && !!a.called_at,
          wait: waits.get(a.id) ?? null,
        })),
        waitingMore: Math.max(0, queue.length - 3),
        busyFor: timing.get(r.id)?.busyFor ?? 0,
      };
    }),
    lobby: appts
      .filter((a) => !a.room_id && a.status === "대기")
      .map((a) => ({ label: label(a), grade: gradeOf(a), time: a.scheduled_time })),
    calls: appts
      .filter((a) => a.status === "상담준비" && a.called_at && now - Date.parse(a.called_at) < 120_000 && a.room_id)
      .sort((x, y) => (y.called_at ?? "").localeCompare(x.called_at ?? ""))
      .map((a) => ({ id: a.id, label: label(a), room: roomName.get(a.room_id ?? "") ?? "", at: a.called_at as string })),
    counts: {
      notArrived: appts.filter((a) => a.status === "미도착").length,
      waiting: appts.filter((a) => a.status === "대기" || a.status === "상담준비").length,
      inSession: appts.filter((a) => a.status === "상담중").length,
      done: appts.filter((a) => a.status === "완료" || a.status === "전화상담").length,
      total: appts.filter((a) => a.status !== "취소").length,
    },
  };
}

export type PersonalPayload = {
  eventName: string;
  eventDate: string | null;
  label: string;
  status: ConsultStatus;
  room: string | null;
  teacher: string | null;
  ahead: number | null;
  wait: number | null;
  scheduledTime: string | null;
  delayMin: number;
  called: boolean;
  /** 순회 코스: 끝낸 방 / 남은 방 이름. */
  doneRooms: string[];
  remainingRooms: string[];
};

/** 학부모 휴대폰에 보낼 자료. 이 예약 하나만, 이름은 행사 설정과 관계없이 가립니다(링크가 퍼질 수 있습니다). */
export function buildPersonalPayload(state: ConsultState, apptId: string, now: number): PersonalPayload | null {
  const a = state.appts.find((x) => x.id === apptId);
  if (!a) return null;
  const studentById = new Map(state.students.map((s) => [s.id, s]));
  const room = state.rooms.find((r) => r.id === a.room_id) ?? null;
  const { waits } = estimate(state.appts, state.rooms, state.logs, state.event.default_minutes, now);
  const nameOf = (id: string) => state.rooms.find((r) => r.id === id)?.name ?? "";
  return {
    eventName: state.event.name,
    eventDate: state.event.event_date,
    label: apptLabel(a, studentById, true),
    status: a.status,
    room: room?.name ?? null,
    teacher: room?.teacher_name ?? null,
    ahead: aheadCount(state.appts, a),
    wait: waits.get(a.id) ?? null,
    scheduledTime: a.scheduled_time,
    delayMin: a.delay_min,
    called: a.status === "상담준비" && !!a.called_at,
    doneRooms: a.done_room_ids.map(nameOf).filter(Boolean),
    remainingRooms: a.course_room_ids.filter((r) => !a.done_room_ids.includes(r) && r !== a.room_id).map(nameOf).filter(Boolean),
  };
}

/** 현황판 링크가 지금 열려 있어도 되는가. */
export function boardOpen(e: Pick<ConsultEvent, "board_enabled" | "board_expires_at" | "status">, now: number): boolean {
  if (!e.board_enabled || e.status === "종료") return false;
  if (e.board_expires_at && Date.parse(e.board_expires_at) < now) return false;
  return true;
}
