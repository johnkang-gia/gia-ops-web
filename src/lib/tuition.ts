/**
 * 학비 청구액 계산 — **한 곳에서만** 냅니다.
 *
 * 이 계산은 화면(표에 뜨는 금액), 서버(청구서에 굳히는 금액), 인쇄본 세 곳에서 필요합니다.
 * 세 곳이 각자 계산하면 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 아무도 모릅니다. 돈에서는
 * 그게 곧 「청구서 금액이 왜 다르죠」가 됩니다.
 *
 * ── 순서가 곧 금액입니다 ──────────────────────────────────────────────
 *
 *   ① 기준액   = 항목 기준금액 × 옵션 회차수      (11,000,000 × 3 = 33,000,000)
 *   ② 옵션할인 = 기준액 × 옵션 할인율             (33,000,000 × 0.10 = 3,300,000)
 *   ③ 소계     = ① − ②                           (29,700,000)  ← 안내문 숫자와 일치
 *   ④ 추가할인 = 소계 기준으로 비율, 정액은 그대로
 *   ⑤ 청구액   = ③ − ④  (0 아래로는 안 내려갑니다)
 *
 * **비율 할인을 기준액이 아니라 소계에 겁니다.** 두 할인을 각각 기준액에 걸면 합이 실제보다
 * 커져서, 연납 10% + 특별감면 10% 가 20% 가 됩니다. 실제로는 연납가에서 다시 10%입니다.
 *
 * 반올림은 **마지막에 한 번만** 합니다. 중간마다 반올림하면 학생마다 1~2원씩 어긋나고,
 * 그 차이는 월말 대사에서 「왜 안 맞지」로 돌아옵니다.
 */

export type PlanLike = { id: string; name: string; base_amount: number; unit: string };
export type OptionLike = { id: string; name: string; periods: number; discount_rate: number };
export type DiscountLike = { id: string; name: string; kind: "percent" | "amount"; value: number };

export type TuitionLine = {
  /** 안내문의 「Option B. 1년 납부」 같은 이름. 청구서에 이대로 찍습니다. */
  label: string;
  planName: string;
  optionName: string;
  /** 기준금액 × 회차수 */
  base: number;
  /** 옵션 할인액(연납 10% 등) */
  optionDiscount: number;
  /** 기준액 − 옵션할인 */
  subtotal: number;
  /** 사람이 따로 붙인 할인들 */
  discounts: { name: string; amount: number }[];
  /** 실제로 청구할 금액 */
  amount: number;
};

/** 원 단위로 맞춥니다. 1원 미만은 청구서에 찍을 자리가 없습니다. */
function won(n: number): number {
  return Math.round(n);
}

/**
 * 한 항목(정규과정·방과후 5일반 …)의 청구 한 줄.
 *
 * 옵션이 없으면 null 을 돌려줍니다 — 「고르지 않았다」와 「0원이다」는 다른 말이고, 0원으로
 * 처리하면 아무것도 안 고른 학생이 청구서에 0원 줄로 올라갑니다.
 */
export function tuitionLine(
  plan: PlanLike,
  option: OptionLike | null,
  discounts: DiscountLike[] = [],
): TuitionLine | null {
  if (!option) return null;

  const base = Number(plan.base_amount) * Number(option.periods);
  const optionDiscount = base * Number(option.discount_rate);
  const subtotal = base - optionDiscount;

  const applied: { name: string; amount: number }[] = [];
  for (const d of discounts) {
    const amt = d.kind === "percent" ? subtotal * Number(d.value) : Number(d.value);
    if (!(amt > 0)) continue;
    applied.push({ name: d.name, amount: won(amt) });
  }

  const off = applied.reduce((n, d) => n + d.amount, 0);
  // 할인이 금액을 넘으면 0으로 멈춥니다. 마이너스 청구서는 환불이지 청구가 아니고,
  // 그건 이 화면이 다룰 일이 아닙니다.
  const amount = Math.max(0, won(subtotal) - off);

  return {
    label: `${plan.name} · ${option.name}`,
    planName: plan.name,
    optionName: option.name,
    base: won(base),
    optionDiscount: won(optionDiscount),
    subtotal: won(subtotal),
    discounts: applied,
    amount,
  };
}

/** 한 학생의 학비 총액. 줄이 하나도 없으면 0입니다(청구할 것이 없다는 뜻). */
export function tuitionTotal(lines: (TuitionLine | null)[]): number {
  return lines.reduce((n, l) => n + (l?.amount ?? 0), 0);
}

/**
 * 지금 쓸 수 있는 할인인가.
 *
 * 끈 할인(active=false)과 기간이 지난 할인은 **새로 붙일 수 없습니다.** 다만 이미 붙어 있던
 * 건은 지우지 않습니다 - 지난 청구서가 왜 그 금액이었는지 설명할 수 있어야 합니다.
 */
export function discountUsable(
  d: { active: boolean; effective_from: string | null; effective_to: string | null },
  today: string,
): boolean {
  if (!d.active) return false;
  if (d.effective_from && today < d.effective_from) return false;
  if (d.effective_to && today > d.effective_to) return false;
  return true;
}

/**
 * **이 학생의 이 항목에 걸리는 할인** — 한 곳에서만 고릅니다.
 *
 * 할인은 항목마다 다릅니다. 정규과정에는 목사 자제·형제자매·유치부 졸업이 붙고, 방과후에는
 * 5개월납·10개월납이 붙습니다. 두 목록이 섞이면 방과후 금액에서 형제 할인이 또 빠지는데,
 * 화면에는 오류가 아니라 **그냥 깎인 금액**으로 보입니다.
 *
 * 세 화면(청구 표·청구서 발행·인쇄본)이 이 함수를 같이 씁니다. 각자 거르면 언젠가 한 곳이
 * 다른 금액을 내고, 돈에서 그건 「청구서 금액이 왜 다르죠」가 됩니다.
 *
 * 걸러내는 기준은 둘입니다.
 *
 * | 무엇 | 뜻 |
 * |---|---|
 * | 붙인 줄의 `plan_id` | 이 학생에게 **어느 항목에** 붙였는가. 비었으면 학비 전체(예전 줄) |
 * | 할인 규칙의 `plan_id` | 이 할인이 **원래 어느 항목 것인가**. 비었으면 아무 항목에나 |
 *
 * 둘 다 맞아야 겁니다. 규칙이 정규과정 전용인데 방과후에 붙어 있으면 그건 잘못 붙은
 * 것이고, 잘못 붙은 채로 깎으면 아무도 못 찾습니다.
 */
export function discountsForPlan<D extends { id: string; plan_id: string | null }>(
  rows: { discount_id: string; term_id: string | null; plan_id: string | null }[],
  discounts: D[],
  planId: string,
  termId: string | null,
): D[] {
  const out: D[] = [];
  for (const r of rows) {
    // 학기가 없는 줄은 「학기를 안 가린다」는 뜻입니다 - 예전 줄이 그렇습니다.
    if (r.term_id && termId && r.term_id !== termId) continue;
    if (r.plan_id && r.plan_id !== planId) continue;
    const d = discounts.find((x) => x.id === r.discount_id);
    if (!d) continue;
    if (d.plan_id && d.plan_id !== planId) continue;
    // 같은 할인이 두 줄로 들어와 있으면 한 번만 겁니다. 두 번 깎이면 금액이 조용히 틀립니다.
    if (out.some((x) => x.id === d.id)) continue;
    out.push(d);
  }
  return out;
}
