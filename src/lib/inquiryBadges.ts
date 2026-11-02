/**
 * 오늘의 문의사항 — 분류 뱃지와 경과 시간.
 *
 * 뱃지 목록은 여기 한 곳입니다. 수집(AI 판단)·화면·중앙 대시보드가 같은 목록을 씁니다. 화면마다
 * 따로 적으면 한쪽에만 새 뱃지가 생겨, 같은 글이 화면마다 다른 분류로 보입니다.
 *
 * 예전 분류는 셔틀이 기준이었습니다(픽업 / 문의 / 기타 + 문의 종류 하나). 이제는 학부모가 토들에
 * 쓴 글 전체를 행정실 일로 보므로 한 글에 뱃지를 여럿 붙입니다 — 「내일 결석하고, 두고 간 패딩도
 * 챙겨 주세요」는 출결이면서 물건입니다.
 */

export const INQUIRY_BADGES = [
  "출결",
  "픽업·하원",
  "셔틀",
  "물건",
  "건강·안전",
  "수업·학습",
  "생활·교우",
  "행사·일정",
  "납부·행정",
  "상담 요청",
  "인사·감사",
  "기타",
] as const;

export type InquiryBadge = (typeof INQUIRY_BADGES)[number];

/** 뱃지 색(테일윈드 클래스). 출결·픽업처럼 그날 바로 손이 가야 하는 것을 진하게 둡니다. */
export const BADGE_STYLE: Record<InquiryBadge, string> = {
  출결: "bg-rose-100 text-rose-800 border-rose-200",
  "픽업·하원": "bg-amber-100 text-amber-800 border-amber-200",
  셔틀: "bg-orange-100 text-orange-800 border-orange-200",
  물건: "bg-violet-100 text-violet-800 border-violet-200",
  "건강·안전": "bg-red-100 text-red-800 border-red-200",
  "수업·학습": "bg-sky-100 text-sky-800 border-sky-200",
  "생활·교우": "bg-teal-100 text-teal-800 border-teal-200",
  "행사·일정": "bg-indigo-100 text-indigo-800 border-indigo-200",
  "납부·행정": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "상담 요청": "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  "인사·감사": "bg-slate-100 text-slate-500 border-slate-200",
  기타: "bg-slate-100 text-slate-700 border-slate-200",
};

const LEGACY_TYPE: Record<string, InquiryBadge> = {
  출결: "출결",
  "차량·하원": "셔틀",
  "수업·학습": "수업·학습",
  "생활·교우": "생활·교우",
  "건강·안전": "건강·안전",
  "행사·일정": "행사·일정",
  "납부·행정": "납부·행정",
};

/**
 * AI가 준 뱃지를 다듬습니다. 목록에 없는 글자는 버리고, 하나도 안 남으면 예전 분류(kind·inquiry_type)
 * 에서 옮깁니다. **빈 뱃지는 만들지 않습니다** — 뱃지 없는 줄은 어느 칩으로 걸러도 안 보입니다.
 */
export function normalizeBadges(
  raw: unknown,
  fallback: { kind?: string | null; inquiryType?: string | null },
): InquiryBadge[] {
  const set = new Set<InquiryBadge>();
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const t = typeof v === "string" ? v.trim() : "";
      if ((INQUIRY_BADGES as readonly string[]).includes(t))
        set.add(t as InquiryBadge);
    }
  }
  if (fallback.kind === "픽업") set.add("픽업·하원");
  if (set.size === 0) {
    if (fallback.kind === "기타") set.add("인사·감사");
    else if (fallback.inquiryType && LEGACY_TYPE[fallback.inquiryType])
      set.add(LEGACY_TYPE[fallback.inquiryType]);
    else set.add("기타");
  }
  // 인사·감사는 다른 뱃지와 함께 붙지 않습니다. 할 일이 있는 글을 접힌 칸에 숨기면 안 됩니다.
  if (set.size > 1) set.delete("인사·감사");
  return INQUIRY_BADGES.filter((b) => set.has(b));
}

/** 답할 것이 없는 글인가. 목록에서 기본으로 접고, 미처리 숫자에서 뺍니다. */
export function isNoActionBadges(
  badges: readonly string[] | null | undefined,
): boolean {
  return (
    !!badges && badges.length > 0 && badges.every((b) => b === "인사·감사")
  );
}

/** 경과 시간 글자. 「방금」·「12분」·「1시간 5분」·「1일 3시간」. */
export function elapsedLabel(fromIso: string, nowMs: number): string {
  const min = Math.max(
    0,
    Math.floor((nowMs - new Date(fromIso).getTime()) / 60000),
  );
  if (min < 1) return "방금";
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}시간 ${min % 60}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}일 ${h % 24}시간` : `${d}일`;
}

/**
 * 경과 시간 색. 학부모가 기다린 시간입니다 — 10분 미만은 회색, 30분까지 주황, 그 뒤는 빨강.
 * 「답함」이 되면 멈추므로 이 색은 답하지 않은 줄에만 씁니다.
 */
export function elapsedTone(
  fromIso: string,
  nowMs: number,
): "calm" | "warn" | "late" {
  const min = (nowMs - new Date(fromIso).getTime()) / 60000;
  if (min < 10) return "calm";
  if (min < 30) return "warn";
  return "late";
}

/** 답하는 데 걸린 시간(분). 화면에 「32분 만」으로 적습니다. */
export function minutesBetween(fromIso: string, toIso: string): number {
  return Math.max(
    0,
    Math.round(
      (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000,
    ),
  );
}
