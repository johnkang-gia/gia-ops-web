import type { BoardScale } from "@/lib/useBoardDensity";

/**
 * 운영 대시보드가 **여러 조각에서 함께 쓰는 것들** — 화면에 담기는 자료의 모양과, 작은 도구들.
 *
 * OpsBoardClient 하나가 1,968줄이었습니다. 화면 한 장이라 한 파일이 자연스러웠지만, 그
 * 파일을 여는 순간 시간표·픽업 알람·교실 쪽지·글자 크기 손잡이가 한꺼번에 눈에 들어와
 * 어디를 고쳐야 하는지 찾는 것부터 일이 됐습니다. **동작은 그대로 두고 자리만 나눴습니다.**
 */

export type Lesson = { subjectName: string; teacherName: string | null; room: string | null };
export type BoardData = {
  appVersion?: string;
  label: string;
  department: string;
  today: string;
  nowLabel: string;
  isWeekday: boolean;
  currentPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  nextPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  grades: {
    grade: string;
    classes: { id: string; className: string; homeroom: string | null; room: string | null; current: Lesson | null; next: Lesson | null }[];
  }[];
  studentCount: number;
  nightInfo?: { events: { date: string; name: string }[]; reportsThisWeek: number };
  absences: { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean }[];
  /** 오늘 픽업. 시각·반이 함께 옵니다 - 그 시각에 교실로 데리러 가야 해서 반이 필요합니다. */
  pickups: {
    name: string;
    time: string | null;
    grade?: string | null;
    className?: string | null;
    classId?: string | null;
    /** 어느 길로 들어온 픽업인가. 「이 아이가 왜 떴지」를 화면에서 바로 답합니다. */
    source?: "체크표" | "출결내역" | "학부모연락";
    /** 명부와 못 이은 건. 조용히 빼지 않고 올리되 확인이 필요하다고 적습니다. */
    unmatched?: boolean;
    /** 평소 하원수단(학원차·보호자하원). 아래 목록에 또 뜨지 않도록 여기로 합쳤습니다. */
    plan?: string | null;
  }[];
  /** 아직 시작하지 않은 등록 건. 시작일이 오면 저절로 오늘 명단으로 넘어갑니다. */
  upcoming?: { name: string; status: string; from: string; to: string; note: string | null }[];
  /** 오늘 요일에 셔틀이 아닌 방법으로 가는 아이들(학원차·보호자·도보). 매주 반복됩니다. */
  dismissalToday?: {
    name: string;
    className: string;
    /** 지금 그 반이 어느 교실에서 무슨 수업 중인지 찾는 열쇠. */
    classId?: string | null;
    kind: string;
    label: string | null;
    time: string | null;
    note: string | null;
  }[];
  /**
   * 앞으로 예약된 하원수단(이번 주 남은 날 + 다음 주). 그날이 되면 위 dismissalToday 로
   * 넘어갑니다 - 사람이 옮기거나 지우지 않습니다.
   */
  dismissalAhead?: { name: string; className: string; date: string; kind: string; label: string | null; time: string | null }[];
  /** 교실 태블릿에서 온 특이사항·문의. 읽으면 그 시각이 교실 화면에 그대로 뜹니다. */
  classroomNotes?: {
    id: string;
    className: string;
    kind: string;
    studentName: string | null;
    body: string;
    urgent: boolean;
    at: string;
    readAt: string | null;
    reply: string | null;
  }[];
  inquiries: { id: string; student: string; type: string | null; typeGuessed?: boolean; summary: string; urgent: boolean; at: string; replied?: boolean }[];
  /** 아직 사람이 한 번 봐야 하는 픽업 요청(확인대기). 비어 있는 것이 정상입니다. */
  pendingInbox?: { name: string; date: string | null; time: string | null; today: boolean }[];
  collector: { lastSeen: string | null; status: string | null; stale: boolean } | null;
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string; endLabel: string };
};

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 출결·픽업 칸에 쓸 짧은 이름(요청: "칸이 작으니 마야 같은 경우 이름 전체 말고 Maya만").
//
// 이 칸은 화면의 작은 한 조각인데 'Maya Rodriguez Kim' 같은 이름이 들어오면 배지 하나가
// 줄을 통째로 먹고, 정작 몇 명인지가 안 보입니다. 누구인지 알아보는 데는 첫 이름이면
// 충분하고(같은 반에 같은 이름이 겹치는 일은 드뭅니다), 전체 이름은 마우스를 올리면 뜹니다.
// 한글 이름은 원래 붙여 쓰므로 그대로 둡니다.
export function shortName(name: string): string {
  const trimmed = name.trim();
  if (/[가-힣]/.test(trimmed)) return trimmed; // 한글 이름은 이미 짧습니다
  return trimmed.split(/\s+/)[0] || trimmed;
}

export const STATUS_COLOR: Record<string, string> = {
  결석: "#dc2626",
  지각: "#d97706",
  조퇴: "#7c3aed",
  기타: "#64748b",
};

export function btn(sc: BoardScale, bg: string): React.CSSProperties {
  return {
    borderRadius: 999,
    border: "none",
    background: bg,
    color: "#fff",
    fontSize: sc.s(16, 12),
    fontWeight: 800,
    padding: `${sc.s(8, 5)}px ${sc.s(18, 11)}px`,
    cursor: "pointer",
  };
}

// 「9/21~23」처럼 짧게. 하루짜리면 한 번만 적습니다 - 「9/21~9/21」은 읽는 데 방해만 됩니다.
export function dayRange(from: string, to: string): string {
  const short = (d: string) => d.slice(5).replace("-", "/");
  return from === to ? short(from) : `${short(from)}~${short(to)}`;
}

/**
 * **같은 아이의 같은 상태는 한 줄로 묶습니다.**
 *
 * 한우영 결석이 두 줄로 올라와 있었습니다(9/16~23, 9/16~28). 화면에는 「예정 3건」으로만
 * 떠서, 보는 사람은 **아이가 셋인 줄** 압니다. 결석 아이 수를 세는 것이 이 칸의 첫 쓸모인데
 * 건수와 사람 수가 다르면 숫자를 못 믿게 됩니다.
 *
 * 겹치는 기간은 합치지 않고 **그대로 나란히 적습니다.** 「9/16~23 · 9/16~28」이 보여야
 * 사람이 「둘 중 하나는 잘못 들어왔구나」를 알아챕니다. 자동으로 넓은 쪽만 남기면 잘못
 * 들어온 줄이 조용히 사라지고, 그러면 왜 그렇게 됐는지 영영 못 찾습니다.
 */
export function mergeByStudent<T extends { name: string; status: string; from: string; to: string; note: string | null }>(
  rows: T[],
): { name: string; status: string; spans: { from: string; to: string }[]; note: string | null; conflicting: boolean }[] {
  const m = new Map<string, { name: string; status: string; spans: { from: string; to: string }[]; note: string | null }>();
  for (const r of rows) {
    const key = `${r.name}::${r.status}`;
    const cur = m.get(key);
    if (cur) {
      // 같은 기간이 두 번 온 것은 진짜 중복이라 한 번만 적습니다.
      if (!cur.spans.some((s) => s.from === r.from && s.to === r.to)) cur.spans.push({ from: r.from, to: r.to });
      if (!cur.note && r.note) cur.note = r.note;
    } else {
      m.set(key, { name: r.name, status: r.status, spans: [{ from: r.from, to: r.to }], note: r.note });
    }
  }
  return [...m.values()].map((v) => ({
    ...v,
    spans: v.spans.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    // 기간이 둘 이상이면 어느 쪽이 맞는지 사람이 봐야 합니다.
    conflicting: v.spans.length > 1,
  }));
}
