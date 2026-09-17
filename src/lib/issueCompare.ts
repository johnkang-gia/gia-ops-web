/**
 * **이번에 발행할 것이 지난번과 같은가** — 발행 전에 한 번 묻기 위한 판정.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 이미 청구서가 나간 학생에게 또 발행하는 일이 생깁니다. 두 가지 경우인데 **뜻이 정반대**
 * 입니다.
 *
 *   · 지난번에 없던 항목이 생겼다 → 그 항목만 새로 보내야 합니다
 *   · 지난번과 똑같다            → 대개 잘못 누른 것입니다. 정말 한 장 더 보낼 일도
 *                                 있지만(분실·재발송) 그건 사람이 정할 일입니다
 *
 * 둘을 구별하지 않으면 한쪽은 같은 돈을 두 번 청구하고, 다른 쪽은 새 항목을 빠뜨립니다.
 * 화면에는 둘 다 「발행됨」으로 보입니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

/** 그 항목이 이미 청구서에 나갔는가. `모름` 은 이름이 겹쳐 가릴 수 없는 줄입니다. */
export type ItemState = "안나감" | "나감" | "모름";

export type CompareRow = {
  /** 사람이 읽는 이름. 번호가 있으면 앞에 붙여 두면 헷갈리지 않습니다. */
  label: string;
  state: ItemState;
  /** 어느 분류인가(교복·교재·악기…). 발행 전 확인창이 분류로 묶어 보여줍니다. */
  category?: string | null;
  /** 이 줄의 금액. 몇 권이면 이미 곱해진 값입니다. */
  amount?: number;
};

export type IssueVerdict =
  /** 이 학생에게 나간 청구서가 없습니다 - 그냥 발행하면 됩니다. */
  | "처음"
  /** 지난번에 없던 항목이 있습니다 - 그것만 새로 나갑니다. */
  | "다름"
  /** 담을 것이 모두 이미 나갔습니다 - 한 번 더 보낼지 사람이 정합니다. */
  | "같음";

export type IssueCompare = {
  verdict: IssueVerdict;
  /** 이번에 새로 나갈 항목. */
  fresh: string[];
  /** 이미 나갔던 항목. 「다름」일 때 무엇이 빠졌는지 보여주는 데 씁니다. */
  again: string[];
  /**
   * 이름이 겹쳐 가릴 수 없는 항목.
   *
   * 판정에는 **넣지 않습니다** - 모르는 것을 「새 항목」으로 세면 두 번 청구되고,
   * 「이미 나감」으로 세면 받을 돈이 사라집니다. 화면이 따로 적어 사람에게 묻습니다.
   */
  unsure: string[];
};

export function compareIssue(rows: readonly CompareRow[]): IssueCompare {
  const fresh: string[] = [];
  const again: string[] = [];
  const unsure: string[] = [];
  for (const r of rows) {
    if (r.state === "나감") again.push(r.label);
    else if (r.state === "모름") unsure.push(r.label);
    else fresh.push(r.label);
  }
  // 나간 것이 하나도 없으면 이 학생에게는 처음입니다.
  const verdict: IssueVerdict = again.length === 0 ? "처음" : fresh.length === 0 ? "같음" : "다름";
  return { verdict, fresh, again, unsure };
}

/**
 * 사람에게 물어볼 말. **화면마다 다른 문구를 쓰지 않습니다** - 같은 상황을 두 화면이
 * 다르게 말하면 어느 쪽이 맞는지 아무도 모릅니다.
 */
export function askText(c: IssueCompare): string | null {
  if (c.verdict === "처음") return null;
  if (c.verdict === "같음") return "이전 발행 항목과 같습니다. 한 번 더 발행하시겠습니까?";
  return "이전 발행 항목과 다릅니다. 발행하시겠습니까?";
}

/**
 * **발행 전 확인창에 뜨는 묶음** — 분류마다 항목·금액·소계.
 *
 * 예전에는 항목 이름을 「 · 」로 죽 이어 붙였습니다. 한 아이에게 교복 넷 + 교재 여덟이
 * 걸리면 한 줄이 열 두 칸짜리 글자 띠가 되고, 그 상태로는 **무엇이 얼마인지 눈으로 셀 수
 * 없습니다.** 발행은 되돌릴 수 없는데, 확인하라고 띄운 창에서 확인이 안 됐습니다.
 *
 * 분류 안에서는 **새로 나갈 것을 먼저** 둡니다. 이번에 청구되는 것이 먼저 읽혀야 합니다.
 */
export type IssueGroup = {
  category: string;
  rows: CompareRow[];
  /** 이번에 새로 나갈 금액의 합. 이미 나간 것은 빼고 셉니다. */
  freshTotal: number;
};

export function groupIssue(rows: readonly CompareRow[]): IssueGroup[] {
  const by = new Map<string, CompareRow[]>();
  for (const r of rows) {
    const c = (r.category ?? "").trim() || "기타";
    by.set(c, [...(by.get(c) ?? []), r]);
  }
  const rank = (s: ItemState) => (s === "안나감" ? 0 : s === "모름" ? 1 : 2);
  return [...by.entries()]
    .map(([category, list]) => ({
      category,
      rows: [...list].sort((a, b) => rank(a.state) - rank(b.state) || a.label.localeCompare(b.label, "ko")),
      // 새로 나갈 것만 더합니다. 이미 나간 것을 섞으면 이번에 청구되는 금액이 부풀려집니다.
      freshTotal: list.reduce((n, r) => n + (r.state === "안나감" ? (r.amount ?? 0) : 0), 0),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "ko"));
}
