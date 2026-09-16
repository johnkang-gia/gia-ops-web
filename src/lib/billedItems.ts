/**
 * **이 항목을 이미 청구했는가** — 한 곳에서만 정합니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 학비외에는 이 판정이 **아예 없었습니다.** 그래서 같은 돈이 두 번 나가는 길이 둘 있었습니다.
 *
 * **① 「이미 받음」이 고른 항목만 담지 않았습니다.**
 * 교복 10만원만 체크해도 만들어지는 청구서에는 그 아이의 학비외 항목이 **전부** 담겼습니다.
 * 입금은 체크한 10만원만 붙으니 그 청구서는 일부납으로 남고, 교재비가 미납·연체 목록에
 * 다시 떴습니다 - 이미 받았다고 적어둔 항목이 되돌아오는 것처럼 보입니다.
 *
 * **② 발행이 이미 청구된 항목을 안 걸렀습니다.**
 * 교복을 한 번 청구한 뒤 교재비를 청구하려고 다시 발행하면 교복이 또 담겼습니다. 학부모
 * 화면에는 낼 돈이 두 배로 뜨는데, 오류가 아니라 「청구된 금액」으로 보입니다.
 *
 * 두 구멍의 뿌리는 같습니다 — **무엇이 이미 나갔는지를 아무도 안 셌습니다.**
 *
 * ── 무엇을 근거로 세나 ──────────────────────────────────────────────────────
 *
 * `invoice_lines` 입니다. 청구서에 실제로 찍힌 줄이 유일한 사실이고, 항목을 나중에 지우거나
 * 이름을 바꿔도 그때 나간 종이는 안 바뀝니다.
 *
 * **번호(`item_id`)로 가릅니다.** 처음에는 이름으로 갈랐는데, 「《加油(Go for it)-小学中文 3》」
 * 은 2·3·4·5학년 네 항목의 이름이 **똑같습니다**(다른 것은 한국어 이름뿐). 2학년 것 하나를
 * 적었더니 넷이 모두 「받음」으로 잠겼고, 아직 안 나간 4학년 교재가 발행에서도 빠졌습니다 -
 * 받을 돈이 화면에서 조용히 사라진 것입니다.
 *
 * 번호가 없는 옛 줄은 이름으로 볼 수밖에 없습니다. 그때 겹치는 이름이면 **모른다고 합니다**
 * (`markOf` 의 `unsure`) - 모르는 채로 잠그면 누락이고, 모르는 채로 열면 중복입니다.
 *
 * **취소된 청구서는 세지 않습니다.** 취소는 「없던 일로 한다」는 뜻이라 그 항목은 다시
 * 청구해야 합니다. 이월된 장(`carried_to_invoice_id`)도 세지 않습니다 - 그 돈은 새 장으로
 * 옮겨갔고, 옮겨간 장이 따로 세어집니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */

/** 받았는가. 청구서 단위로 봅니다 - 입금은 청구서에 붙지 줄에 붙지 않습니다. */
export type BillState = "완납" | "일부" | "미납";

export type BilledInvoice = {
  id: string;
  student_id: string | null;
  status?: string | null;
  total_amount: number | string;
  carried_to_invoice_id?: string | null;
};

export type BilledLine = {
  invoice_id: string;
  name: string;
  /**
   * 어느 항목이었나. **옛 줄은 비어 있습니다.**
   *
   * 이름이 같은 항목이 넷 있습니다(학년별 중국어 교재). 번호가 있으면 정확히 가르고,
   * 없으면 이름으로 볼 수밖에 없는데 그때는 **겹치는 이름을 잠그지 않습니다** - 모르는
   * 채로 잠그면 아직 안 나간 교재가 「받음」으로 보여 받을 돈이 사라집니다.
   */
  item_id?: string | null;
};
export type BilledPayment = { invoice_id: string | null; amount: number | string };

export type BilledMark = {
  state: BillState;
  /** 어느 청구서에 담겼나. 화면이 「그 청구서 보기」로 이어줍니다. */
  invoiceId: string;
  /**
   * **번호가 아니라 이름으로 찾은 것인가.** 옛 줄에는 번호가 없습니다.
   *
   * 이름으로 찾았고 그 이름을 쓰는 항목이 여럿이면 어느 것이 나갔는지 알 수 없습니다.
   * 그때 화면은 잠그지 않고 「확인 필요」라고 적습니다 - 모르는 채로 잠그면 받을 돈이
   * 사라지고, 모르는 채로 열면 두 번 청구됩니다. 둘 다 나쁘므로 사람이 봅니다.
   */
  byName?: boolean;
};

/**
 * 학생 → 항목 이름 → 그 항목이 어느 청구서에 담겼고 걷혔는가.
 *
 * 같은 항목이 여러 장에 있으면 **덜 걷힌 쪽이 사실입니다.** 완납으로 덮으면 아직 안 받은
 * 돈이 화면에서 사라지고, 사라진 돈은 아무도 안 찾습니다.
 */
export function billedItems(
  invoices: readonly BilledInvoice[],
  lines: readonly BilledLine[],
  payments: readonly BilledPayment[],
): Map<string, Map<string, BilledMark>> {
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  const alive = new Map<string, BilledInvoice>();
  for (const v of invoices) {
    if (!v.student_id) continue;
    if ((v.status ?? "") === "취소") continue;
    if (v.carried_to_invoice_id) continue;
    alive.set(v.id, v);
  }

  const out = new Map<string, Map<string, BilledMark>>();
  for (const l of lines) {
    const inv = alive.get(l.invoice_id);
    if (!inv || !inv.student_id) continue;
    const total = Number(inv.total_amount);
    const paid = paidBy.get(inv.id) ?? 0;
    const state: BillState = paid <= 0 ? "미납" : paid >= total ? "완납" : "일부";

    const per = out.get(inv.student_id) ?? out.set(inv.student_id, new Map()).get(inv.student_id)!;
    /**
     * **번호가 있으면 번호로 세웁니다.** 이름이 같은 항목이 넷 있어서(학년별 중국어 교재)
     * 이름만으로 세면 하나가 나갔을 때 넷이 모두 나간 것으로 읽힙니다 - 아직 안 나간
     * 교재가 「받음」으로 뜨고 발행에서도 빠져, 받을 돈이 조용히 사라집니다.
     *
     * 이름 열쇠도 **함께** 남깁니다. 옛 줄(번호 없음)과 섞여 있을 때 화면이 둘 다 찾아볼
     * 수 있어야 합니다.
     */
    const keys: { key: string; byName: boolean }[] = l.item_id
      ? [{ key: l.item_id, byName: false }, { key: l.name, byName: true }]
      : [{ key: l.name, byName: true }];
    for (const { key, byName } of keys) {
      const cur = per.get(key);
      // 덜 걷힌 쪽이 이깁니다. 미납 > 일부 > 완납 순으로 셉니다.
      if (!cur || rank(state) > rank(cur.state)) per.set(key, { state, invoiceId: inv.id, byName });
    }
  }
  return out;
}

/**
 * **이 항목이 이미 나갔는가** — 화면이 부르는 자리.
 *
 * 번호로 먼저 찾고, 없으면 이름으로 찾습니다. 이름으로 찾았는데 **그 이름을 쓰는 항목이
 * 여럿이면** 「모름」입니다 - 어느 것이 나갔는지 알 수 없으니 잠그지도, 조용히 열지도
 * 않고 사람에게 묻습니다.
 */
export function markOf(
  marks: Map<string, BilledMark> | undefined,
  item: { id: string; name: string },
  /** 그 이름을 쓰는 항목이 몇 개인가. 1이면 이름으로 찾아도 헷갈릴 것이 없습니다. */
  sameNameCount = 1,
): (BilledMark & { unsure: boolean }) | null {
  if (!marks) return null;
  const byId = marks.get(item.id);
  if (byId && !byId.byName) return { ...byId, unsure: false };
  const byName = marks.get(item.name);
  if (!byName) return null;
  return { ...byName, unsure: sameNameCount > 1 };
}

function rank(s: BillState): number {
  return s === "미납" ? 2 : s === "일부" ? 1 : 0;
}

/** 화면에 붙이는 말. 색은 화면이 정하고, 말은 여기서 한 번만 정합니다. */
export const BILL_LABEL: Record<BillState, string> = {
  // 「받음」보다 「납부완료」가 눈에 걸립니다 - 이 뱃지 하나로 그 항목을 다시 청구할지가
  // 갈리는데, 흐린 말로 적으면 사람이 한 번 더 확인하게 됩니다.
  완납: "납부완료",
  일부: "일부받음",
  미납: "청구됨",
};
