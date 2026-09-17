/**
 * **제안 몇 건인가** — 한 곳에서만 셉니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 사이드바 「제안 · 채택」에 빨간 2가 떠 있는데 화면을 열면 「검토대기 (1건)」이었습니다.
 *
 * 둘이 서로 다른 것을 세고 있었습니다.
 *
 *   · 사이드바 — `proposals` **줄 수**
 *   · 화면     — 한 사건을 하나로 **묶은 수**(`groupProposals`)
 *
 * 한 사건에는 「학부모용」과 「실무자용」 제안이 함께 만들어집니다. 그래서 사건 하나가 줄로는
 * 둘입니다. 숫자가 다르면 보는 사람은 「하나를 못 찾고 있나」 하고 목록을 다시 훑게 되는데,
 * 찾을 것이 애초에 없습니다.
 *
 * 그래서 **묶는 규칙을 이 파일 하나에 둡니다.** 사이드바와 화면이 같은 함수를 부르면 두 숫자가
 * 어긋날 자리가 없습니다(§2-11).
 */

/** 묶을 수 있는 갈래. 같은 사건에서 나온 제안들을 하나로 봅니다. */
export const GROUPABLE_SOURCES = new Set(["incidents", "events", "meetings"]);

export type GroupableProposal = { id: string; source: string; source_id: string | null };

/** 한 사건 = 한 건. 같은 사건에서 나온 「학부모용·실무자용」은 함께 셉니다. */
export function proposalGroupKey(it: GroupableProposal): string {
  return it.source_id && GROUPABLE_SOURCES.has(it.source)
    ? `${it.source}:${it.source_id}`
    : `${it.source}:id:${it.id}`;
}

/** 사람이 보게 될 건수. 화면의 「검토대기 (N건)」과 사이드바 배지가 이 값을 함께 씁니다. */
export function countProposalGroups(items: readonly GroupableProposal[]): number {
  return new Set(items.map(proposalGroupKey)).size;
}
