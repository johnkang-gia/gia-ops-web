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
