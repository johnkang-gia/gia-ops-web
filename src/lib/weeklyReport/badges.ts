import type { BadgeValue, EvalBadges, EvalCategory } from "@/lib/types";

// 원래 위클리 리포트 앱의 badgeHelper.tsx 로직을 그대로 옮겼습니다(뱃지는 AI가 아니라
// 선생님이 직접 클릭해서 고르는 수동 평가 태그입니다 - "ai_tags"라는 이름과 달리 실제
// AI 생성 로직은 없었습니다).
export const CATEGORY_LABELS: Record<string, string> = {
  academic: "학업",
  improvement: "보완",
  participation: "참여",
  behavior: "태도",
  social: "교우",
  overall: "종합",
};

export const BADGE_OPTIONS: {
  value: BadgeValue;
  emoji: string;
  label: string;
  enLabel: string;
  color: string;
  bg: string;
  border: string;
}[] = [
  { value: "excellent", emoji: "🌟", label: "탁월", enLabel: "Excellent", color: "#4F46E5", bg: "#EEF2FF", border: "#4F46E5" },
  { value: "good", emoji: "🟢", label: "양호", enLabel: "Good", color: "#10B981", bg: "#ECFDF5", border: "#10B981" },
  { value: "warning", emoji: "⚠️", label: "지도요망", enLabel: "Needs Attention", color: "#D97706", bg: "#FEF3C7", border: "#F59E0B" },
  { value: "bad", emoji: "🚨", label: "집중지도", enLabel: "Poor", color: "#B91C1C", bg: "#FEE2E2", border: "#EF4444" },
];

export const BADGE_MAP: Record<BadgeValue, { label: string; bg: string; color: string; isWarning: boolean }> = {
  excellent: { label: "🌟 탁월", bg: "#EEF2FF", color: "#4F46E5", isWarning: false },
  good: { label: "🟢 양호", bg: "#ECFDF5", color: "#10B981", isWarning: false },
  warning: { label: "⚠️ 지도요망", bg: "#FEF3C7", color: "#D97706", isWarning: true },
  bad: { label: "🚨 집중지도", bg: "#FEE2E2", color: "#B91C1C", isWarning: true },
};

export const EVAL_CATEGORIES: EvalCategory[] = ["academic", "improvement", "participation", "behavior", "social"];

export const EVAL_LABELS: Record<EvalCategory, { ko: string; en: string; hint: string }> = {
  academic: { ko: "학업 성취도", en: "Academic Performance", hint: "academic" },
  improvement: { ko: "보완점 및 발전 방향", en: "Improvement & Goals", hint: "improvement" },
  participation: { ko: "수업 참여도", en: "Class Participation", hint: "participation" },
  behavior: { ko: "생활 태도 및 성실성", en: "Behavior & Attitude", hint: "behavior" },
  social: { ko: "교우 관계 및 협동심", en: "Social Skills", hint: "social" },
};

export function initialBadges(): EvalBadges {
  return {
    academic: ["good"],
    improvement: ["good"],
    participation: ["good"],
    behavior: ["good"],
    social: ["good"],
  };
}

export function parseBadges(raw: unknown): EvalBadges {
  const fallback = initialBadges();
  if (!raw) return fallback;
  try {
    const tags = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(tags)) {
      if (tags.length === 0) return fallback;
      const mapped = tags.map((t) => {
        if (typeof t === "string") return t as BadgeValue;
        const label = (t as { label?: string })?.label ?? "";
        if (label.includes("탁월")) return "excellent";
        if (label.includes("집중") || label.includes("개선")) return "bad";
        if (label.includes("지도") || label.includes("주의")) return "warning";
        return "good";
      });
      return { overall: mapped as BadgeValue[] };
    }
    if (tags && typeof tags === "object") {
      return { ...fallback, ...tags };
    }
  } catch {
    // 형식이 깨진 데이터는 기본값으로 안전하게 대체합니다.
  }
  return fallback;
}

export function hasWarningBadges(badges: EvalBadges): boolean {
  const all = Object.values(badges).flat();
  return all.includes("warning") || all.includes("bad");
}

export function hasExcellentBadges(badges: EvalBadges): boolean {
  const all = Object.values(badges).flat();
  return all.includes("excellent");
}
