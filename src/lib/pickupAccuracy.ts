import { needsOneStudent } from "@/lib/pickupOwner";

/**
 * **자동 분류가 얼마나 맞고 있는가** — 재는 자리.
 *
 * ── 왜 만들었나 ─────────────────────────────────────────────────────────────
 *
 * 토들 방을 학생에게 이어 둔 이유는 글을 긁어올 때 **실수 없이 아이를 특정해서 출결을
 * 자동으로 하기 위해서**입니다. 그런데 그게 지금 얼마나 되고 있는지 **화면 어디에도
 * 없었습니다.**
 *
 * 숫자가 없으면 고쳐도 나아졌는지 알 수 없고, 나빠져도 모릅니다. 실제로 이 숫자들은
 * 사람이 그때그때 손으로 뽑아 봐야 했습니다.
 *
 * ── 무엇을 재나 ─────────────────────────────────────────────────────────────
 *
 * 「몇 %가 맞았나」 하나로 뭉뚱그리지 않습니다. 고칠 자리가 저마다 다르기 때문입니다.
 *
 *   · 집도 학생도 없는 줄   → 방 연결이 없습니다. [토들 채널]에서 이어야 합니다.
 *   · 집만 있는 줄          → 정상입니다. 아이를 한 명 정할 필요가 없는 글입니다.
 *   · 한 명이 필요한데 못 정한 줄 → **사람이 봐야 합니다.** 이 숫자가 0에 가까워야 합니다.
 *   · 본문이 없는 줄        → 어떤 규칙도 못 씁니다. **정확도의 천장**입니다.
 *   · 사람이 고친 출결 판정  → 자동이 틀린 비율. 이게 줄어야 자동을 믿을 수 있습니다.
 */

export type AccuracyPickup = {
  student_id: string | null;
  channel_id?: string | null;
  channel_label: string | null;
  raw_text: string | null;
  summary: string | null;
  kind: string | null;
  inquiry_type: string | null;
};

export type AccuracyEntry = {
  state: string | null;
  touched_by_human: boolean | null;
};

export type AccuracyRule = {
  kind: string | null;
  pattern: string | null;
  student_name: string | null;
};

/** 학생 이름일 리 없는 흔한 말. 이런 것이 별칭으로 들어가면 아무 글이나 걸립니다. */
const COMMON_WORDS = ["오늘", "내일", "어제", "선생", "선생님", "감사", "안녕", "학교", "부탁", "아이", "아이들", "이제"];

export function shakyAlias(pattern: string): string | null {
  const p = (pattern ?? "").trim();
  if (!p) return "빈 값";
  if (p.length <= 1) return "한 글자라 아무 글에나 걸립니다";
  if (/\d/.test(p)) return "숫자가 섞여 있습니다(반 이름이 붙은 채 저장된 듯)";
  if (COMMON_WORDS.some((w) => p === w || p.startsWith(w))) return "학생 이름이 아니라 흔한 말입니다";
  return null;
}

export type AccuracyReport = {
  total: number;
  /** 아이가 한 명으로 정해진 줄. */
  withStudent: number;
  /** 아이는 못 정했지만 집은 정해진 줄. **이건 문제가 아닙니다.** */
  houseOnly: number;
  /** 집도 학생도 없는 줄. 방 연결이 없다는 뜻입니다. */
  orphan: number;
  /** 출결·하원에 반영되는 글(= 아이가 한 명이어야 하는 글). */
  needsOne: number;
  /** 그중 아직 아이를 못 정한 줄. **사람이 봐야 하는 진짜 숫자입니다.** */
  needsOneUnresolved: number;
  /**
   * 본문이 없는 줄.
   *
   * **대부분은 일부러 안 남긴 것입니다.** 「감사합니다」 같은 인사말은 학부모 대화를 쌓아두지
   * 않겠다는 원칙에 따라 본문을 지우고 요약 60자만 남깁니다(`isPleasantry`).
   */
  noText: number;
  /**
   * 본문도 요약도 없는 줄. **이쪽이 진짜 문제입니다** - 사람이 봐도 무슨 글인지 알 수 없고,
   * 어떤 규칙도 못 씁니다. 수집기가 본문을 못 가져온 것일 수 있습니다.
   */
  noTextNoSummary: number;
  /**
   * **믿기 어려운 별칭 규칙.** 사람이 🔎 로 가르친 것 중 잘못 잘린 조각이 섞입니다
   * (「이제오늘」·「2c김재이」). 한 글자이거나 숫자가 섞였거나 흔한 말이면 의심합니다 -
   * 그런 규칙은 엉뚱한 글을 그 아이 것으로 만듭니다.
   */
  shakyAliases: { pattern: string; studentName: string | null; why: string }[];
  /** 출결 판정 전체(무시 제외). */
  entriesLive: number;
  /** 그중 사람이 손댄 것. 자동이 틀렸거나 애매했다는 뜻입니다. */
  entriesHumanFixed: number;
};

const blank = (s: string | null | undefined) => !(s ?? "").trim();

export function buildAccuracy(input: {
  pickups: readonly AccuracyPickup[];
  entries: readonly AccuracyEntry[];
  rules?: readonly AccuracyRule[];
}): AccuracyReport {
  const p = input.pickups;
  const needsOneRows = p.filter((r) => needsOneStudent(r.kind, r.inquiry_type));
  const live = input.entries.filter((e) => e.state !== "무시");

  return {
    total: p.length,
    withStudent: p.filter((r) => r.student_id).length,
    houseOnly: p.filter((r) => !r.student_id && r.channel_id).length,
    orphan: p.filter((r) => !r.student_id && !r.channel_id).length,
    needsOne: needsOneRows.length,
    needsOneUnresolved: needsOneRows.filter((r) => !r.student_id).length,
    noText: p.filter((r) => blank(r.raw_text)).length,
    noTextNoSummary: p.filter((r) => blank(r.raw_text) && blank(r.summary)).length,
    entriesLive: live.length,
    entriesHumanFixed: live.filter((e) => e.touched_by_human).length,
    shakyAliases: (input.rules ?? [])
      .filter((r) => r.kind === "alias")
      .map((r) => ({ pattern: (r.pattern ?? "").trim(), studentName: r.student_name, why: shakyAlias(r.pattern ?? "") ?? "" }))
      .filter((r) => r.why),
  };
}

/** 백분율 한 줄. 분모가 0이면 「—」입니다 - 0%로 적으면 나쁜 것처럼 보입니다. */
export function pct(n: number, of: number): string {
  if (of <= 0) return "—";
  return `${Math.round((n / of) * 1000) / 10}%`;
}
