/**
 * **학부모 상담 — 판정은 여기 한 곳.**
 *
 * 상태가 어디로 가는지, 다음 상담실을 어디로 정하는지, 몇 분 기다리는지, 현황판에 이름을 어떻게
 * 보일지를 이 파일만 정합니다. 안내데스크 화면·면담자 화면·현황판·학부모 링크가 같은 답을 해야
 * 하기 때문입니다(CLAUDE.md §2-11 「한 곳에서만 정한다」와 같은 이유). 화면마다 «몇 분 남았나»를
 * 따로 계산하면 로비 현황판은 5분, 학부모 휴대폰은 12분을 말하게 되고, 학부모는 둘 다 안 믿습니다.
 *
 * 이 파일은 데이터베이스를 모릅니다(순수 함수). 읽고 쓰는 일은 `server.ts` 가 합니다.
 *
 * 구글시트판에서 그대로 가져온 것: 상태 흐름, 취소·전화상담 «다시 누르면 되돌아감», 지연 분,
 * 여러 상담실 순회. 바꾼 것: 다음 방을 «준비·상담 중인 사람 수»가 아니라 **예상 대기 시간**으로
 * 고르고, 시간이 비슷하면 담임 선생님 방을 먼저 고릅니다.
 */

export const CONSULT_STATUSES = ["미도착", "대기", "상담준비", "상담중", "완료", "취소", "전화상담"] as const;
export type ConsultStatus = (typeof CONSULT_STATUSES)[number];

/** 끝난 상태. 대기열·예상 시간 계산에서 빠집니다. */
export const CLOSED_STATUSES: readonly ConsultStatus[] = ["완료", "취소", "전화상담"];

export function isConsultStatus(v: unknown): v is ConsultStatus {
  return typeof v === "string" && (CONSULT_STATUSES as readonly string[]).includes(v);
}

export type SiblingMode = "together" | "separate" | "ask";

export type ConsultEvent = {
  id: string;
  name: string;
  event_date: string | null;
  end_date: string | null;
  status: "준비" | "진행" | "종료";
  mask_names: boolean;
  sibling_default: SiblingMode;
  default_minutes: number;
  board_token: string;
  board_enabled: boolean;
  board_expires_at: string | null;
  board_short_code: string | null;
  personal_links_enabled: boolean;
  is_demo: boolean;
  created_at: string;
};

export type ConsultRoom = {
  id: string;
  event_id: string;
  name: string;
  teacher_email: string | null;
  teacher_name: string | null;
  grade_label: string | null;
  sort_order: number;
};

export type ConsultAppt = {
  id: string;
  event_id: string;
  scheduled_time: string | null;
  room_id: string | null;
  status: ConsultStatus;
  prev_status: ConsultStatus | null;
  delay_min: number;
  arrived_at: string | null;
  called_at: string | null;
  course_room_ids: string[];
  done_room_ids: string[];
  note: string | null;
  personal_token: string;
  updated_by: string | null;
  updated_at: string;
  /** 이 예약에 붙은 학생 번호(형제를 함께 상담하면 둘 이상). */
  student_ids: string[];
};

export type ConsultLog = {
  appointment_id: string;
  from_status: string | null;
  to_status: string;
  room_id: string | null;
  action: string | null;
  by_email: string | null;
  at: string;
};

// ── 시각 ────────────────────────────────────────────────────────────────────

/** 'HH:MM' → 그날 0시부터 몇 분. 못 읽으면 null. */
export function timeToMinutes(t: string | null | undefined): number | null {
  const m = String(t ?? "").trim().match(/^(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 분 → 'HH:MM'. 24시를 넘기면 그 안으로 접습니다. */
export function minutesToTime(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/**
 * 그 순간이 한국 시각으로 하루 중 몇 분째인가. 기계의 시간대를 쓰지 않습니다 - 서버(UTC)와
 * 브라우저(한국)가 같은 답을 해야 합니다(CLAUDE.md §4).
 */
export function kstMinuteOfDay(ms: number): number {
  return Math.floor((ms / 60000 + 9 * 60) % 1440);
}

/** 손으로 적은 시각을 'HH:MM' 으로 고칩니다(「2시 20분」 「14:2」 → 14:20). 못 읽으면 null. */
export function normalizeTime(t: string | null | undefined): string | null {
  const m = timeToMinutes(t);
  return m === null ? null : minutesToTime(m);
}

/** 예약 시각 + 늦는다고 알려온 분. 정렬과 «예정보다 늦음» 판단에 씁니다. */
export function expectedMinutes(a: Pick<ConsultAppt, "scheduled_time" | "delay_min">): number | null {
  const base = timeToMinutes(a.scheduled_time);
  return base === null ? null : base + (a.delay_min || 0);
}

// ── 이름 ────────────────────────────────────────────────────────────────────

/**
 * 현황판에 보일 이름. 로비 화면은 지나가는 누구나 봅니다 - 행사 설정이 «가림»이면 가운데를 가립니다.
 *
 *   김하 → 김*   김도하 → 김*하   남궁민수 → 남**수   Daniel Kim → D****l K*m
 */
export function maskPersonName(name: string, mask: boolean): string {
  const n = String(name ?? "").trim();
  if (!mask || !n) return n;
  const hidePart = (w: string): string => {
    const chars = Array.from(w);
    if (chars.length <= 1) return w;
    if (chars.length === 2) return chars[0] + "*";
    return chars[0] + "*".repeat(chars.length - 2) + chars[chars.length - 1];
  };
  // 영문은 낱말마다, 한글 이름은 통째로 가립니다.
  return /\s/.test(n) ? n.split(/\s+/).map(hidePart).join(" ") : hidePart(n);
}

// ── 상태 바꾸기 ─────────────────────────────────────────────────────────────

/**
 * 취소·전화상담은 **같은 단추를 다시 누르면 원래대로** 돌아갑니다(시트판과 같습니다). 원래
 * 상태를 모르면 방이 정해져 있으면 상담준비, 도착했으면 대기, 아니면 미도착으로 둡니다.
 */
export function toggleTarget(
  a: Pick<ConsultAppt, "status" | "prev_status" | "room_id" | "arrived_at">,
  target: "취소" | "전화상담",
): { status: ConsultStatus; prev_status: ConsultStatus | null } {
  if (a.status === target) {
    const back: ConsultStatus = a.prev_status && !CLOSED_STATUSES.includes(a.prev_status)
      ? a.prev_status
      : a.room_id ? "상담준비" : a.arrived_at ? "대기" : "미도착";
    return { status: back, prev_status: null };
  }
  return { status: target, prev_status: a.status };
}

/**
 * 상담을 마쳤을 때 다음 자리. 코스에 남은 방이 없으면 완료, 있으면 다음 방(상담준비)입니다.
 * `pick` 은 남은 방 중에서 고르는 함수 - 보통 `pickNextRoom` 입니다.
 */
export function finishPlan(
  a: Pick<ConsultAppt, "room_id" | "course_room_ids" | "done_room_ids">,
  pick: (remaining: string[]) => string | null,
): { status: ConsultStatus; room_id: string | null; done_room_ids: string[] } {
  const done = [...a.done_room_ids];
  if (a.room_id && !done.includes(a.room_id)) done.push(a.room_id);
  const remaining = a.course_room_ids.filter((r) => !done.includes(r));
  if (remaining.length === 0) return { status: "완료", room_id: a.room_id, done_room_ids: done };
  const next = pick(remaining) ?? remaining[0];
  return { status: "상담준비", room_id: next, done_room_ids: done };
}

// ── 걸리는 시간 ─────────────────────────────────────────────────────────────

/**
 * 상담실마다 한 번 상담에 걸린 시간(분)을 기록에서 셉니다. 「상담중」이 된 때부터 그 예약이
 * 상담중을 벗어난 때까지.
 */
export function measuredDurations(logs: readonly ConsultLog[]): Map<string, number[]> {
  const byAppt = new Map<string, ConsultLog[]>();
  for (const l of logs) (byAppt.get(l.appointment_id) ?? byAppt.set(l.appointment_id, []).get(l.appointment_id)!).push(l);
  const out = new Map<string, number[]>();
  for (const list of byAppt.values()) {
    list.sort((x, y) => x.at.localeCompare(y.at));
    let start: { at: number; room: string | null } | null = null;
    for (const l of list) {
      if (l.to_status === "상담중") {
        start = { at: Date.parse(l.at), room: l.room_id };
      } else if (start && l.from_status === "상담중") {
        const minutes = (Date.parse(l.at) - start.at) / 60000;
        // 1분 안에 끝난 것은 잘못 누른 것, 3시간이 넘는 것은 끝내기를 잊은 것입니다.
        if (start.room && minutes >= 1 && minutes <= 180) {
          (out.get(start.room) ?? out.set(start.room, []).get(start.room)!).push(minutes);
        }
        start = null;
      }
    }
  }
  return out;
}

/**
 * 상담실 하나의 평균 상담 시간. 기록이 적을 때는 행사의 기본값에 끌어당깁니다 - 처음 한 건이
 * 3분 만에 끝났다고 나머지 모두를 3분으로 안내하면 안 됩니다.
 */
export function averageMinutes(samples: readonly number[] | undefined, fallback: number): number {
  const s = samples ?? [];
  const recent = s.slice(-12);
  const weight = 2;
  const avg = (fallback * weight + recent.reduce((t, v) => t + v, 0)) / (weight + recent.length);
  return Math.max(3, Math.round(avg));
}

/** 예약마다 지금 상담중이 된 때(기록의 마지막 「상담중」). */
export function startedAtMap(logs: readonly ConsultLog[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (l.to_status !== "상담중") continue;
    const t = Date.parse(l.at);
    if (!out.has(l.appointment_id) || (out.get(l.appointment_id) ?? 0) < t) out.set(l.appointment_id, t);
  }
  return out;
}

// ── 대기열 ──────────────────────────────────────────────────────────────────

function arrivalKey(a: ConsultAppt): number {
  return a.arrived_at ? Date.parse(a.arrived_at) : Number.MAX_SAFE_INTEGER;
}
function expectedKey(a: ConsultAppt): number {
  return expectedMinutes(a) ?? 24 * 60;
}

/**
 * 상담실 하나의 줄. 상담중 → 상담준비(호출받은 사람 먼저) → 대기(그 방으로 정해진 사람) 순서이고,
 * 같은 단계에서는 예약 시각(+지연), 그다음 도착 순입니다. 미도착은 줄에 없습니다.
 */
export function roomQueue(appts: readonly ConsultAppt[], roomId: string): ConsultAppt[] {
  const rank: Partial<Record<ConsultStatus, number>> = { 상담중: 0, 상담준비: 1, 대기: 2 };
  return appts
    .filter((a) => a.room_id === roomId && rank[a.status] !== undefined)
    .sort((x, y) => {
      const r = (rank[x.status] ?? 9) - (rank[y.status] ?? 9);
      if (r !== 0) return r;
      if (x.status === "상담준비") {
        // 호출받은 사람이 먼저입니다.
        const cx = x.called_at ? Date.parse(x.called_at) : Number.MAX_SAFE_INTEGER;
        const cy = y.called_at ? Date.parse(y.called_at) : Number.MAX_SAFE_INTEGER;
        if (cx !== cy) return cx - cy;
      }
      return expectedKey(x) - expectedKey(y) || arrivalKey(x) - arrivalKey(y);
    });
}

export type RoomTiming = {
  /** 이 방의 평균 상담 시간(분). */
  avg: number;
  /** 지금 줄이 다 끝나기까지(분). */
  busyFor: number;
};

/**
 * 방마다 «지금 줄이 다 빠지기까지 몇 분»과, 예약마다 «내 차례까지 몇 분»을 셉니다.
 * 현황판·학부모 링크·다음 방 고르기가 전부 이 값을 씁니다.
 */
export function estimate(
  appts: readonly ConsultAppt[],
  rooms: readonly Pick<ConsultRoom, "id">[],
  logs: readonly ConsultLog[],
  defaultMinutes: number,
  now: number,
): { rooms: Map<string, RoomTiming>; waits: Map<string, number> } {
  const samples = measuredDurations(logs);
  const started = startedAtMap(logs);
  const roomOut = new Map<string, RoomTiming>();
  const waits = new Map<string, number>();
  for (const r of rooms) {
    const avg = averageMinutes(samples.get(r.id), defaultMinutes);
    let t = 0;
    for (const a of roomQueue(appts, r.id)) {
      if (a.status === "상담중") {
        const s = started.get(a.id);
        const elapsed = s ? (now - s) / 60000 : 0;
        waits.set(a.id, 0);
        t += Math.max(1, avg - elapsed);
      } else {
        waits.set(a.id, Math.round(t));
        t += avg;
      }
    }
    roomOut.set(r.id, { avg, busyFor: Math.round(t) });
  }
  return { rooms: roomOut, waits };
}

/**
 * 남은 방 중 다음 방. **가장 빨리 볼 수 있는 방**이 먼저이고, 차이가 평균 상담 시간의 1/3
 * 안이면 담임 선생님 방을 고릅니다 - 학부모는 담임을 먼저 만나고 싶어 하고, 몇 분 차이로
 * 그 순서를 뒤집을 이유가 없습니다.
 */
export function pickNextRoom(
  remaining: readonly string[],
  timings: Map<string, RoomTiming>,
  preferRoomIds: ReadonlySet<string>,
): string | null {
  if (remaining.length === 0) return null;
  const busy = (id: string) => timings.get(id)?.busyFor ?? 0;
  const sorted = [...remaining].sort((a, b) => busy(a) - busy(b));
  const best = sorted[0];
  const slack = (timings.get(best)?.avg ?? 15) / 3;
  const preferred = sorted.find((id) => preferRoomIds.has(id) && busy(id) - busy(best) <= slack);
  return preferred ?? best;
}

/** 같은 방 줄에서 내 앞에 몇 명. 미도착이거나 끝났으면 null. */
export function aheadCount(appts: readonly ConsultAppt[], a: ConsultAppt): number | null {
  if (!a.room_id || CLOSED_STATUSES.includes(a.status) || a.status === "미도착") return null;
  const q = roomQueue(appts, a.room_id);
  const i = q.findIndex((x) => x.id === a.id);
  return i < 0 ? null : i;
}

// ── 통계 ────────────────────────────────────────────────────────────────────

export type ConsultStats = {
  total: number;
  byStatus: Record<ConsultStatus, number>;
  /** 도착 → 첫 상담 시작까지 평균(분). 표본이 없으면 null. */
  avgWait: number | null;
  /** 상담실별 건수와 평균 상담 시간. */
  rooms: { id: string; done: number; avg: number | null }[];
  /** 예약 시각보다 10분 넘게 늦게 도착한 건수. */
  late: number;
};

export function computeStats(
  appts: readonly ConsultAppt[],
  rooms: readonly Pick<ConsultRoom, "id">[],
  logs: readonly ConsultLog[],
): ConsultStats {
  const byStatus = Object.fromEntries(CONSULT_STATUSES.map((s) => [s, 0])) as Record<ConsultStatus, number>;
  for (const a of appts) byStatus[a.status] += 1;

  const firstStart = new Map<string, number>();
  for (const l of logs) {
    if (l.to_status !== "상담중") continue;
    const t = Date.parse(l.at);
    if (!firstStart.has(l.appointment_id) || t < (firstStart.get(l.appointment_id) ?? t)) firstStart.set(l.appointment_id, t);
  }
  const waits: number[] = [];
  let late = 0;
  for (const a of appts) {
    if (a.arrived_at) {
      const s = firstStart.get(a.id);
      if (s) waits.push((s - Date.parse(a.arrived_at)) / 60000);
      const exp = timeToMinutes(a.scheduled_time);
      if (exp !== null) {
        if (kstMinuteOfDay(Date.parse(a.arrived_at)) - exp > 10) late += 1;
      }
    }
  }
  const samples = measuredDurations(logs);
  return {
    total: appts.length,
    byStatus,
    avgWait: waits.length ? Math.round(waits.reduce((t, v) => t + Math.max(0, v), 0) / waits.length) : null,
    rooms: rooms.map((r) => {
      const s = samples.get(r.id) ?? [];
      return { id: r.id, done: s.length, avg: s.length ? Math.round(s.reduce((t, v) => t + v, 0) / s.length) : null };
    }),
    late,
  };
}

// ── 형제 ────────────────────────────────────────────────────────────────────

/** 같은 형제 묶음(sibling_group_id)에 속한 다른 아이들. */
export function siblingsOf<T extends { id: string; sibling_group_id: string | null }>(
  studentId: string,
  students: readonly T[],
): T[] {
  const me = students.find((s) => s.id === studentId);
  if (!me?.sibling_group_id) return [];
  return students.filter((s) => s.id !== studentId && s.sibling_group_id === me.sibling_group_id);
}

/**
 * 반 단위로 한꺼번에 넣을 때 형제를 어떻게 묶나. «함께»면 같은 형제 묶음을 한 예약으로,
 * «따로»(또는 «묻기» - 한꺼번에 넣을 때는 물을 수 없습니다)면 아이마다 예약 하나입니다.
 */
export function groupForBulk<T extends { id: string; sibling_group_id: string | null }>(
  picked: readonly T[],
  mode: SiblingMode,
): string[][] {
  if (mode !== "together") return picked.map((s) => [s.id]);
  const groups = new Map<string, string[]>();
  const out: string[][] = [];
  for (const s of picked) {
    if (!s.sibling_group_id) {
      out.push([s.id]);
      continue;
    }
    const g = groups.get(s.sibling_group_id);
    if (g) g.push(s.id);
    else {
      const fresh = [s.id];
      groups.set(s.sibling_group_id, fresh);
      out.push(fresh);
    }
  }
  return out;
}

/** 예약 시각을 차례로 매깁니다(시작 시각부터 간격마다). 시작이 없으면 모두 null. */
export function sequentialTimes(count: number, start: string | null, intervalMin: number): (string | null)[] {
  const base = timeToMinutes(start);
  if (base === null) return Array.from({ length: count }, () => null);
  return Array.from({ length: count }, (_, i) => minutesToTime(base + i * Math.max(1, intervalMin)));
}

// ── 상태 색 ─────────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<ConsultStatus, { chip: string; label: string }> = {
  미도착: { chip: "bg-slate-100 text-slate-600 ring-slate-200", label: "미도착" },
  대기: { chip: "bg-amber-100 text-amber-800 ring-amber-200", label: "대기" },
  상담준비: { chip: "bg-sky-100 text-sky-800 ring-sky-200", label: "상담준비" },
  상담중: { chip: "bg-emerald-600 text-white ring-emerald-700", label: "상담중" },
  완료: { chip: "bg-slate-200 text-slate-500 ring-slate-300", label: "완료" },
  취소: { chip: "bg-rose-100 text-rose-700 ring-rose-200", label: "취소" },
  전화상담: { chip: "bg-violet-100 text-violet-800 ring-violet-200", label: "전화상담" },
};
