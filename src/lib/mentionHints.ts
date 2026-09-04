/**
 * 멘션을 «지울 것»이 아니라 «단서»로 읽습니다.
 *
 * 구글챗 출결 글은 대개 이렇게 시작합니다.
 *
 *   @Minkyung Kim @Michelle Seo @Demian Jung  Vivian, Sophia pick up today
 *
 * 여기서 부르는 사람은 두 갈래입니다.
 *
 *   · **행정실** — 픽업·결석을 실제로 처리하는 사람들. 누구 글이든 늘 불립니다.
 *   · **그 아이의 담임(또는 관련 교사)** — 그 아이가 누구인지를 아는 사람.
 *
 * 앞엣것을 걷어내면 뒤엣것만 남고, 담임이 정해지면 **반이 정해집니다.** 그러면
 * "Sophia 가 둘인데 누구인가" 같은 물음이 그 자리에서 풀립니다 - 멘션된 담임의 반에
 * 있는 Sophia 가 그 Sophia 입니다.
 *
 * 지금까지 멘션은 오탐의 원인이라 지우기만 했습니다. 사실은 글쓴이가 «이건 이 반 아이
 * 이야기»라고 이미 알려주고 있었는데, 그걸 버리고 본문만 들여다본 셈입니다.
 */

/**
 * 행정실 계정. 여기 있는 사람은 «관련 교사»가 아니라 늘 부르는 사람입니다.
 *
 * 이름으로 두는 이유: 멘션에는 표시 이름만 오고, 계정이 없는 분도 불립니다.
 * 사람이 바뀌면 이 목록만 고치면 됩니다.
 *
 * Paul Lee 가 여기 있는 것에 주의합니다 — G9 학생 이준서의 영문명과 같습니다.
 * 멘션 안의 Paul Lee 는 행정실이고, 본문 안의 Paul Lee 는 학생입니다. 이제 둘을
 * 좌표로 가르므로 섞이지 않습니다.
 */
export const ADMIN_MENTION_NAMES = [
  "Minkyung Kim",
  "Demian Jung",
  "Boeun Park",
  "Helena Kwon",
  "John Kang",
  "Yeunjin Ryu",
  "Paul Lee",
];

/** 비교용 정규화 - 공백·마침표·대소문자를 지웁니다("Carina Ann John" ↔ "carinaannjohn"). */
export function normMentionName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[\s.'-]/g, "");
}

const ADMIN_SET = new Set(ADMIN_MENTION_NAMES.map(normMentionName));

export function isAdminMention(name: string | null | undefined): boolean {
  return ADMIN_SET.has(normMentionName(name));
}

/** 담임 한 명이 맡은 반. 계정 이름과 반 표(wr_classes)에 적힌 이름 둘 다로 찾습니다. */
export type TeacherClass = {
  /** 계정 이름(app_users.name) 또는 반 표의 담임 이름(wr_classes.teacher_name). */
  names: string[];
  classNames: string[];
};

/**
 * 멘션 목록에서 «그 아이의 반»을 좁힙니다.
 *
 * 행정실은 빼고, 남은 사람 중 담임인 사람의 반만 모읍니다. 담임이 여럿 불렸으면
 * 여러 반이 나오고, 그때는 좁히지 못한 것으로 봅니다 - 반 하나로 확정될 때만 쓸모가
 * 있고, 억지로 하나를 고르면 조용히 틀립니다.
 */
export function classHintFromMentions(
  mentionNames: (string | null | undefined)[],
  teachers: TeacherClass[],
): string[] {
  const named = mentionNames.map(normMentionName).filter((n) => n.length >= 3);
  if (named.length === 0) return [];

  const out = new Set<string>();
  for (const n of named) {
    if (ADMIN_SET.has(n)) continue;
    for (const t of teachers) {
      // 계정 이름이 "Ms. Jaime" 처럼 호칭을 달고 있는 경우가 있어, 어느 한쪽이 다른 쪽을
      // 품고 있으면 같은 사람으로 봅니다. 3글자 이상만 보므로 우연히 겹치기 어렵습니다.
      const hit = t.names.some((raw) => {
        const v = normMentionName(raw);
        return v.length >= 3 && (v === n || v.includes(n) || n.includes(v));
      });
      if (hit) for (const c of t.classNames) if (c) out.add(c);
    }
  }
  return [...out];
}
