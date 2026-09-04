/**
 * 출석부 계산.
 *
 * 이 학교에는 출결이 **두 갈래**로 쌓이고 있었고, 서로를 몰랐습니다.
 *
 * | 어디 | 무엇 | 누가 |
 * |---|---|---|
 * | `attendance_records` | 날짜별 학생 한 명의 출결 한 줄 | 담임이 화면에서 찍음 |
 * | `attendance_entries` | 연락에서 읽어낸 결석·지각(기간) | 토들·구글챗에서 자동 |
 *
 * 학부모가 토들에 "내일 결석합니다" 를 쓰면 행정실은 그것을 등록하는데, **담임의 출석부는
 * 그대로 비어 있습니다.** 그래서 같은 결석을 두 번 적거나, 아무도 안 적어 출석부에 구멍이
 * 납니다. 여기서 그 둘을 잇습니다.
 *
 * 계산에서 지키는 것 세 가지.
 *
 * ① **자료 없음과 결석 0은 다릅니다.** 출석부를 쓰기 전 날짜에는 아무 줄도 없습니다. 그냥
 *    세면 "전원 출석" 이 되고, 그 숫자가 상급학교 서류에 그대로 나갑니다. 없는 출석을 있다고
 *    적는 것이라, 기록 시작일 앞은 따로 셉니다.
 * ② **수업일이 아닌 날은 아예 빼고 셉니다.** 방학에 결석은 없습니다.
 * ③ **픽업은 출결이 아닙니다.** 연락에서 읽은 종류 중 '픽업' 은 하원 방법이지 결석이
 *    아닙니다. 이것을 출석부에 넣으면 픽업으로 집에 간 아이가 전부 결석으로 남습니다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** 출석부에 찍히는 상태. `attendance_records.status` 와 같습니다. */
export type RegisterStatus = "출석" | "지각" | "결석" | "조퇴" | "기타";

/** 결석 사유. 서류에서 실제로 묻는 것은 '무단' 횟수입니다. */
export type ReasonType = "질병" | "인정" | "기타" | "무단";

export type RegisterRecord = {
  student_id: string;
  date: string;
  status: RegisterStatus;
  reason_type?: ReasonType | null;
  source?: string | null;
  confirmed_by_human?: boolean | null;
};

export type SchoolDay = {
  day: string;
  is_school_day: boolean;
  closed_reason?: string | null;
  label?: string | null;
};

/**
 * 연락에서 읽은 종류를 출석부 상태로 옮깁니다.
 *
 * '픽업' 이 null 인 것이 요점입니다. 픽업은 **하원 방법**이라 학교에는 온 아이입니다.
 * 이것을 결석으로 옮기면 매일 픽업하는 아이가 개근에서 최다결석으로 뒤집힙니다.
 */
export function statusFromEntry(entryStatus: string): RegisterStatus | null {
  if (entryStatus === "결석") return "결석";
  if (entryStatus === "지각") return "지각";
  if (entryStatus === "조퇴") return "조퇴";
  return null; // 픽업 등
}

/** 한 사람의 집계. */
export type StudentSummary = {
  studentId: string;
  /** 이 기간의 수업일수(방학·공휴일 뺀 것). 집계의 분모입니다. */
  schoolDays: number;
  /** 그중 기록이 있는 날. */
  recorded: number;
  /** 기록이 아직 없는 날. **결석이 아닙니다.** */
  missing: number;
  present: number;
  late: number;
  absent: number;
  earlyLeave: number;
  other: number;
  /** 사유별 결석. */
  byReason: Record<ReasonType, number>;
  /** 확인 안 된 자동 줄. 이 숫자가 크면 집계를 아직 믿으면 안 됩니다. */
  unconfirmed: number;
  /**
   * 출석률. **기록이 있는 날만** 분모로 씁니다.
   *
   * 수업일수를 분모로 쓰면, 아직 안 찍은 날이 전부 결석처럼 깎여 학기 초에 40% 같은 숫자가
   * 나옵니다. 그 숫자를 본 사람은 화면을 안 믿게 됩니다.
   */
  rate: number | null;
};

const ZERO_REASONS: Record<ReasonType, number> = { 질병: 0, 인정: 0, 기타: 0, 무단: 0 };

/**
 * 한 학생의 집계를 냅니다.
 *
 * `schoolDayList` 는 **수업일만** 넘겨주세요. 쉬는 날이 섞여 있으면 분모가 부풀고, 그 날
 * 기록이 없으니 '자료 없음' 이 계속 늘어납니다.
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
    if (!dayset.has(r.date)) continue; // 쉬는 날에 찍힌 줄은 세지 않습니다.
    mine.set(r.date, r);
  }

  const out: StudentSummary = {
    studentId,
    schoolDays: days.length,
    recorded: mine.size,
    missing: days.length - mine.size,
    present: 0,
    late: 0,
    absent: 0,
    earlyLeave: 0,
    other: 0,
    byReason: { ...ZERO_REASONS },
    unconfirmed: 0,
    rate: null,
  };

  for (const r of mine.values()) {
    if (r.status === "출석") out.present += 1;
    else if (r.status === "지각") out.late += 1;
    else if (r.status === "결석") out.absent += 1;
    else if (r.status === "조퇴") out.earlyLeave += 1;
    else out.other += 1;

    if (r.status === "결석" && r.reason_type) out.byReason[r.reason_type] += 1;
    if (r.confirmed_by_human === false) out.unconfirmed += 1;
  }

  // 지각·조퇴는 학교에 온 날입니다. 결석만 뺍니다.
  if (out.recorded > 0) out.rate = Math.round(((out.recorded - out.absent) / out.recorded) * 1000) / 10;
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
  schoolDays: number;
  present: number;
  late: number;
  absent: number;
  earlyLeave: number;
  other: number;
  missing: number;
  unconfirmed: number;
  byReason: Record<ReasonType, number>;
  rate: number | null;
};

export function summarizeGroup(list: StudentSummary[]): GroupSummary {
  const g: GroupSummary = {
    students: list.length,
    schoolDays: list[0]?.schoolDays ?? 0,
    present: 0,
    late: 0,
    absent: 0,
    earlyLeave: 0,
    other: 0,
    missing: 0,
    unconfirmed: 0,
    byReason: { ...ZERO_REASONS },
    rate: null,
  };
  let recorded = 0;
  for (const s of list) {
    g.present += s.present;
    g.late += s.late;
    g.absent += s.absent;
    g.earlyLeave += s.earlyLeave;
    g.other += s.other;
    g.missing += s.missing;
    g.unconfirmed += s.unconfirmed;
    recorded += s.recorded;
    for (const k of Object.keys(g.byReason) as ReasonType[]) g.byReason[k] += s.byReason[k];
  }
  if (recorded > 0) g.rate = Math.round(((recorded - g.absent) / recorded) * 1000) / 10;
  return g;
}

/**
 * 연락에서 읽은 출결을 그날 출석부에 채웁니다.
 *
 * **사람이 정한 줄은 절대 덮어쓰지 않습니다.** `attendance_records` 는 (학생, 날짜)가 유일해서
 * upsert 로 밀면 담임이 찍어둔 값이 조용히 바뀝니다. 그래서 먼저 그날 있는 줄을 읽고, **없는
 * 것만** 넣습니다.
 *
 * 넣는 줄은 `confirmed_by_human = false` 로 둡니다. 자동으로 들어왔다는 뜻이고, 화면에서
 * 노란 표시로 떠서 담임이 한 번 보고 넘깁니다. 자동 판단이 사람 판단을 이기지 않는다는
 * 규칙은 `attendance_entries` 를 만들 때부터 지켜온 것이라 여기서도 같습니다.
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
      .lte("date_from", dateKey)
      .gte("date_to", dateKey),
    supabase.from("attendance_records").select("student_id").eq("date", dateKey),
  ]);

  // 조용히 넘기지 않습니다. 여기서 삼키면 출석부는 그냥 비어 보이고, 아무도 자동이 멈춘 것을
  // 모릅니다 - 출결내역이 전부 비어 있던 지난번 사고가 정확히 이 자리였습니다.
  if (entryRes.error) return { added: 0, skipped: 0, error: entryRes.error.message };
  if (recRes.error) return { added: 0, skipped: 0, error: recRes.error.message };

  const already = new Set((recRes.data ?? []).map((r) => r.student_id as string));

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const e of entryRes.data ?? []) {
    const status = statusFromEntry(e.status as string);
    if (!status || !e.student_id) {
      skipped += 1;
      continue;
    }
    if (already.has(e.student_id as string)) {
      skipped += 1;
      continue;
    }
    already.add(e.student_id as string); // 한 아이가 두 연락에 걸려도 한 줄만.
    rows.push({
      student_id: e.student_id,
      date: dateKey,
      status,
      // 사유는 연락 글에서 알 수 없습니다. 비워두고 사람이 고르게 합니다 - 여기서 '질병' 을
      // 찍어두면 아무도 다시 안 봅니다.
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
