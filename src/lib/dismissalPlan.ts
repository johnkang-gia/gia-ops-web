// 하원수단 — "이 아이는 무슨 요일에 무엇을 타고 집에 가는가".
//
// 요일마다 다른 방법으로 집에 가는 아이가 있습니다. 월요일 셔틀, 화·목 1시 55분 메타프랩버스,
// 수요일 4시 30분 블루웨일버스, 금요일 3시 35분 블루웨일버스 같은 식입니다.
// 담임 선생님 화면에서도 아이 하나를 열면 요일별 하원수단이 함께 떠야 합니다.
//
// 지금까지 "어떻게 집에 가는가"는 셔틀 배정에만 있었고, **셔틀을 안 타는 날은 적을 자리가
// 없었습니다.** 학원 버스는 셔틀이 아니지만, 선생님이 아이를 어디로 내보낼지 알아야 하는
// 정보입니다. 그래서 아이를 기준으로 요일마다 한 줄씩 둡니다.

export const DISMISSAL_KINDS = ["셔틀", "외부버스", "보호자픽업", "도보", "기타"] as const;
export type DismissalKind = (typeof DISMISSAL_KINDS)[number];

export type DismissalPlan = {
  id?: string;
  student_id: string;
  /** 1=월 … 5=금 */
  weekday: number;
  kind: DismissalKind;
  label: string | null;
  /** 'HH:MM' 문자열. 학부모가 "1:55"라고만 알려주는 일이 많아 시각 타입을 안 씁니다. */
  depart_time: string | null;
  note: string | null;
  updated_by?: string | null;
  updated_at?: string;
};

export const WEEKDAY_NAMES = ["", "월", "화", "수", "목", "금"] as const;

export const KIND_STYLE: Record<DismissalKind, { chip: string; dot: string; emoji: string }> = {
  셔틀: { chip: "bg-blue-100 text-blue-700", dot: "#3b82f6", emoji: "🚌" },
  외부버스: { chip: "bg-violet-100 text-violet-700", dot: "#8b5cf6", emoji: "🚐" },
  보호자픽업: { chip: "bg-pink-100 text-pink-700", dot: "#ec4899", emoji: "🚗" },
  도보: { chip: "bg-emerald-100 text-emerald-700", dot: "#10b981", emoji: "🚶" },
  기타: { chip: "bg-slate-200 text-slate-600", dot: "#94a3b8", emoji: "•" },
};

/**
 * "1:55 메타프랩버스"처럼 한 줄로. 하원 체크표·담임 화면에 그대로 붙습니다.
 *
 * 시각을 **앞에** 둡니다. 선생님이 급할 때 먼저 확인하는 것이 "지금 나가야 하나"라서입니다.
 */
export function planLabel(p: Pick<DismissalPlan, "kind" | "label" | "depart_time">): string {
  const name = (p.label ?? "").trim() || p.kind;
  const time = (p.depart_time ?? "").trim();
  return time ? `${time} ${name}` : name;
}

/** 학생 여러 명의 하원수단을 학생id → 요일 → 계획 으로 묶습니다. */
export function groupPlans(rows: readonly DismissalPlan[]): Map<string, Map<number, DismissalPlan>> {
  const m = new Map<string, Map<number, DismissalPlan>>();
  for (const r of rows) {
    let inner = m.get(r.student_id);
    if (!inner) m.set(r.student_id, (inner = new Map()));
    inner.set(r.weekday, r);
  }
  return m;
}

/** 오늘 요일(KST, 1=월…5=금). 주말이면 0 — 주말에는 하원수단이 없습니다. */
export function kstWeekdayNum(base: Date = new Date()): number {
  const wd = new Date(base.toLocaleString("en-US", { timeZone: "Asia/Seoul" })).getDay();
  return wd >= 1 && wd <= 5 ? wd : 0;
}

/**
 * "화 1:55 메타프랩 · 수 4:30 블루웨일 …" 처럼 일주일치를 한 줄로.
 *
 * 매일 같으면 요일을 안 적습니다 - 요일이 다 같은데도 다섯 번 적으면, 정작 요일마다 다른
 * 아이가 눈에 안 띕니다.
 */
export function weekSummary(byWeekday: Map<number, DismissalPlan>): string {
  const parts: string[] = [];
  for (let d = 1; d <= 5; d++) {
    const p = byWeekday.get(d);
    if (p) parts.push(`${WEEKDAY_NAMES[d]} ${planLabel(p)}`);
  }
  if (parts.length === 0) return "";
  const labels = [...byWeekday.values()].map(planLabel);
  if (byWeekday.size === 5 && new Set(labels).size === 1) return `매일 ${labels[0]}`;
  return parts.join(" · ");
}
