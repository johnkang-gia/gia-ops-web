/**
 * 출석부 계산.
 *
 * ── 기본은 출석입니다 ──────────────────────────────────────────────────────
 *
 * 표시가 없는 날은 **출석한 날**입니다. 137명 × 100일을 매일 다 눌러 확인할 수는 없으므로,
 * 출석부는 예외만 적습니다 - 종이 출석부가 원래 그렇게 생겼습니다.
 *
 * 그래서 출석률은 이렇게 냅니다.
 *
 *     출석률 = (수업일수 − 결석일수) ÷ 수업일수
 *
 * **지각과 조퇴는 출석률을 깎지 않습니다.** 학교에는 온 날이기 때문입니다. 따로 세기는
 * 하되 출석 일수에서 빼지 않습니다.
 *
 * ── 결석이 가장 중요합니다 ────────────────────────────────────────────────
 *
 * 중요한 순서는 **결석 > 조퇴 > 기타 > 지각** 입니다. 화면에서 무엇을 크게 띄우고 무엇을
 * 뒤로 미룰지가 전부 이 순서를 따릅니다. 지각을 결석과 같은 크기로 띄우면, 정작 봐야 할
 * 결석이 지각 열 건에 묻힙니다.
 *
 * ── 자동으로 채우는 것은 결석뿐입니다 ──────────────────────────────────────
 *
 * 토들·구글챗 연락에서 읽어 자동으로 채우는 것은 **결석만** 입니다. 지각과 조퇴는
 * 행정직원이 직접 누릅니다. "늦을 것 같아요" 는 실제로 늦었는지 그 날 봐야 알고, 조퇴는
 * 학교에 온 뒤에 생기는 일이라 아침 연락으로는 알 수 없습니다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** 출석부에 찍히는 상태. `attendance_records.status` 와 같습니다. */
export type RegisterStatus = "출석" | "지각" | "결석" | "조퇴" | "기타";

/** 결석 사유. 서류에서 실제로 묻는 것은 '무단' 횟수입니다. */
export type ReasonType = "질병" | "인정" | "기타" | "무단";

/**
 * 중요한 순서. 작을수록 먼저·크게 보여줍니다.
 *
 * 특이사항 칸과 목록 정렬이 모두 이 순서를 씁니다. 화면마다 다르게 정하면 같은 아이가
 * 화면에 따라 위에도 아래에도 나오고, 그러면 어느 화면을 믿어야 할지 알 수 없습니다.
 */
export const STATUS_RANK: Record<RegisterStatus, number> = {
  결석: 0,
  조퇴: 1,
  기타: 2,
  지각: 3,
  출석: 4,
};

export type RegisterRecord = {
  student_id: string;
  date: string;
  status: RegisterStatus;
  reason_type?: ReasonType | null;
  source?: string | null;
  confirmed_by_human?: boolean | null;
};

/**
 * 연락에서 읽은 종류 중 **자동으로 출석부에 넣어도 되는 것**.
 *
 * 결석만입니다.
 *
 * · 픽업 — 하원 방법이지 결석이 아닙니다. 넣으면 매일 픽업하는 아이가 개근에서
 *   최다결석으로 뒤집힙니다.
 * · 지각 — "늦을 것 같아요" 는 실제로 늦었는지 그 날 봐야 압니다. 미리 찍어두면
 *   제때 온 아이가 지각으로 남습니다.
 * · 조퇴 — 학교에 온 뒤 생기는 일이라 아침 연락으로는 알 수 없습니다.
 */
export function statusFromEntry(entryStatus: string): RegisterStatus | null {
  return entryStatus === "결석" ? "결석" : null;
}

/** 한 사람의 집계. */
export type StudentSummary = {
  studentId: string;
  /** 이 기간의 수업일수(방학·공휴일 뺀 것). 집계의 분모입니다. */
  schoolDays: number;
  /** 결석. 출석률을 깎는 **유일한** 값입니다. */
  absent: number;
  /** 지각·조퇴·기타. 학교에는 온 날이라 출석률을 깎지 않습니다. */
  late: number;
  earlyLeave: number;
  other: number;
  /** 출석으로 명시적으로 찍은 날. */
  markedPresent: number;
  /** 아무 표시도 없는 날. **출석으로 봅니다.** */
  unmarked: number;
  /** 학교에 온 날 = 수업일수 − 결석. */
  attended: number;
  /** 사유별 결석. */
  byReason: Record<ReasonType, number>;
  /** 연락에서 저절로 들어와 아직 사람이 확인하지 않은 줄. */
  unconfirmed: number;
  /** 출석률. 수업일이 하루도 없으면 null(0%로 그리면 출석률이 0인 줄 압니다). */
  rate: number | null;
};

const ZERO_REASONS: Record<ReasonType, number> = { 질병: 0, 인정: 0, 기타: 0, 무단: 0 };

/**
 * 한 학생의 집계.
 *
 * `schoolDayList` 는 **수업일만** 넘겨주세요. 쉬는 날이 섞이면 분모가 부풀어 출석률이
 * 실제보다 낮게 나옵니다.
 */
export function summarizeStudent(
  studentId: string,
  records: RegisterRecord[],
  schoolDayList: string[],
  /** 기록을 실제로 찍기 시작한 날. 이 앞은 집계에서 통째로 뺍니다. */
  coverageStart?: string | null,
): StudentSummary {
  const days = coverageStart ? schoolDayList.filter((d) => d >= coverageStart) : schoolDayList;
  const dayset = new Set(days);

  const mine = new Map<string, RegisterRecord>();
  for (const r of records) {
    if (r.student_id !== studentId) continue;
    // 쉬는 날에 잘못 들어온 줄은 세지 않습니다. 방학에 결석은 없습니다.
    if (!dayset.has(r.date)) continue;
    mine.set(r.date, r);
  }

  const out: StudentSummary = {
    studentId,
    schoolDays: days.length,
    absent: 0,
    late: 0,
    earlyLeave: 0,
    other: 0,
    markedPresent: 0,
    unmarked: 0,
    attended: 0,
    byReason: { ...ZERO_REASONS },
    unconfirmed: 0,
    rate: null,
  };

  for (const r of mine.values()) {
    if (r.status === "출석") out.markedPresent += 1;
    else if (r.status === "지각") out.late += 1;
    else if (r.status === "결석") out.absent += 1;
    else if (r.status === "조퇴") out.earlyLeave += 1;
    else out.other += 1;

    if (r.status === "결석" && r.reason_type) out.byReason[r.reason_type] += 1;
    if (r.confirmed_by_human === false) out.unconfirmed += 1;
  }

  out.unmarked = days.length - mine.size;
  // 표시 없는 날은 출석입니다. 결석만 빼면 그것이 학교에 온 날입니다.
  out.attended = days.length - out.absent;
  if (days.length > 0) out.rate = Math.round((out.attended / days.length) * 1000) / 10;
  return out;
}

/** 여러 학생을 한 번에. 화면에서 반·학년별로 묶을 때 씁니다. */
export function summarizeAll(
  studentIds: string[],
  records: RegisterRecord[],
  schoolDayList: string[],
  coverageStart?: string | null,
): Map<string, StudentSummary> {
  // 학생별로 미리 나눠둡니다. 학생마다 전체를 훑으면 137 × 13,700 번이 됩니다.
  const byStudent = new Map<string, RegisterRecord[]>();
  for (const r of records) {
    const list = byStudent.get(r.student_id);
    if (list) list.push(r);
    else byStudent.set(r.student_id, [r]);
  }
  const out = new Map<string, StudentSummary>();
  for (const id of studentIds) {
    out.set(id, summarizeStudent(id, byStudent.get(id) ?? [], schoolDayList, coverageStart));
  }
  return out;
}

/** 묶음(전체·학년·반)의 집계. 사람 수가 아니라 **날 수**를 더합니다. */
export type GroupSummary = {
  students: number;
  /** 한 사람 기준 수업일수. */
  schoolDays: number;
  /** 사람 × 날 = 이 묶음이 채워야 할 전체 칸 수. 출석률의 분모입니다. */
  slots: number;
  absent: number;
  late: number;
  earlyLeave: number;
  other: number;
  attended: number;
  unconfirmed: number;
  byReason: Record<ReasonType, number>;
  rate: number | null;
};

export function summarizeGroup(list: StudentSummary[]): GroupSummary {
  const g: GroupSummary = {
    students: list.length,
    schoolDays: list[0]?.schoolDays ?? 0,
    slots: 0,
    absent: 0,
    late: 0,
    earlyLeave: 0,
    other: 0,
    attended: 0,
    unconfirmed: 0,
    byReason: { ...ZERO_REASONS },
    rate: null,
  };
  for (const s of list) {
    g.slots += s.schoolDays;
    g.absent += s.absent;
    g.late += s.late;
    g.earlyLeave += s.earlyLeave;
    g.other += s.other;
    g.attended += s.attended;
    g.unconfirmed += s.unconfirmed;
    for (const k of Object.keys(g.byReason) as ReasonType[]) g.byReason[k] += s.byReason[k];
  }
  if (g.slots > 0) g.rate = Math.round((g.attended / g.slots) * 1000) / 10;
  return g;
}

/** 하루치 집계. 출석현황 화면의 날짜별 표·그래프가 이것을 씁니다. */
export type DaySummary = {
  day: string;
  students: number;
  absent: number;
  late: number;
  earlyLeave: number;
  other: number;
  /** 그 날 학교에 온 인원 = 인원 − 결석. */
  attended: number;
  rate: number | null;
};

/**
 * 하루하루의 출석률.
 *
 * 학기 합계만 있으면 "언제부터 나빠졌나" 를 알 수 없는데, 실제로 궁금한 것은 대개 그
 * 시점입니다. 독감이 도는 주는 그래프에서 골짜기로 보입니다.
 */
export function summarizeByDay(
  studentIds: string[],
  records: RegisterRecord[],
  schoolDayList: string[],
): DaySummary[] {
  const ids = new Set(studentIds);
  const byDay = new Map<string, RegisterRecord[]>();
  for (const r of records) {
    if (!ids.has(r.student_id)) continue;
    const list = byDay.get(r.date);
    if (list) list.push(r);
    else byDay.set(r.date, [r]);
  }
  return schoolDayList.map((day) => {
    const rows = byDay.get(day) ?? [];
    const d: DaySummary = {
      day,
      students: studentIds.length,
      absent: 0,
      late: 0,
      earlyLeave: 0,
      other: 0,
      attended: 0,
      rate: null,
    };
    for (const r of rows) {
      if (r.status === "결석") d.absent += 1;
      else if (r.status === "지각") d.late += 1;
      else if (r.status === "조퇴") d.earlyLeave += 1;
      else if (r.status === "기타") d.other += 1;
    }
    d.attended = d.students - d.absent;
    if (d.students > 0) d.rate = Math.round((d.attended / d.students) * 1000) / 10;
    return d;
  });
}

/**
 * 연락에서 읽은 **결석**을 그날 출석부에 채웁니다.
 *
 * **사람이 정한 줄은 절대 덮어쓰지 않습니다.** `attendance_records` 는 (학생, 날짜)가
 * 유일해서 upsert 로 밀면 담임이 찍어둔 값이 조용히 바뀝니다. 그래서 먼저 그날 있는 줄을
 * 읽고 **없는 것만** 넣습니다.
 *
 * 넣는 줄은 `confirmed_by_human = false` 로 둡니다. 자동으로 들어왔다는 뜻이고, 화면의
 * 특이사항 칸에 따로 떠서 사람이 한 번 보고 넘깁니다.
 */
export async function syncEntriesIntoRegister(
  supabase: SupabaseClient,
  dateKey: string,
): Promise<{ added: number; skipped: number; error: string | null }> {
  const [entryRes, recRes] = await Promise.all([
    supabase
      .from("attendance_entries")
      .select("id, student_id, status, note, date_from, date_to")
      .eq("state", "등록")
      // 결석만 가져옵니다. 지각·조퇴·픽업은 아예 읽지 않습니다.
      .eq("status", "결석")
      .lte("date_from", dateKey)
      .gte("date_to", dateKey),
    supabase.from("attendance_records").select("student_id").eq("date", dateKey),
  ]);

  // 조용히 넘기지 않습니다. 여기서 삼키면 출석부는 그냥 비어 보이고, 아무도 자동이 멈춘
  // 것을 모릅니다 - 출결내역이 전부 비어 있던 지난번 사고가 정확히 이 자리였습니다.
  if (entryRes.error) return { added: 0, skipped: 0, error: entryRes.error.message };
  if (recRes.error) return { added: 0, skipped: 0, error: recRes.error.message };

  const already = new Set((recRes.data ?? []).map((r) => r.student_id as string));

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const e of entryRes.data ?? []) {
    if (!e.student_id || already.has(e.student_id as string)) {
      skipped += 1;
      continue;
    }
    already.add(e.student_id as string); // 한 아이가 두 연락에 걸려도 한 줄만.
    rows.push({
      student_id: e.student_id,
      date: dateKey,
      status: "결석",
      // 사유는 연락 글에서 가릴 수 없습니다. 비워두고 사람이 고르게 합니다 - 여기서
      // '질병' 을 찍어두면 아무도 다시 안 봅니다.
      reason_type: null,
      source: "토들",
      confirmed_by_human: false,
      entry_id: e.id,
      note: (e.note as string | null) ?? null,
    });
  }

  if (rows.length === 0) return { added: 0, skipped, error: null };

  const { error } = await supabase.from("attendance_records").insert(rows);
  if (error) return { added: 0, skipped, error: error.message };
  return { added: rows.length, skipped, error: null };
}
