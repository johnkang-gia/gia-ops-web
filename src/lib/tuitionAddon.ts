/**
 * **함께 하면 값이 바뀌는 프로그램** — 오케스트라처럼 다른 항목과 같이 할 때 합친 금액이
 * 정해진 항목.
 *
 * 학교는 「주5회 + 오케스트라 = 55만원」처럼 **합친 금액**으로 안내합니다. 그래서 표에도 합친
 * 금액을 적고(`fee_addon_prices.combined_amount`), 청구서에는 함께 하는 항목은 원래대로,
 * 이 프로그램은 **합친 금액 − 함께 하는 항목의 월 기준금액**으로 따로 한 줄을 씁니다. 학부모는
 * 방과후와 오케스트라가 각각 얼마인지 보고, 합은 안내한 금액과 같습니다.
 *
 * 조합마다 항목을 따로 만들지 않은 이유: 프로그램이 하나 늘 때마다 방과후 종류 수만큼 항목이
 * 늘고, 그중 하나의 금액을 고치는 일을 반드시 잊습니다.
 *
 * 금액 계산(회차·옵션 할인·학생 할인)은 다른 학비와 같은 `tuitionLine` 이 합니다 - 여기서는
 * 「한 달 기준금액이 얼마인가」만 정합니다.
 */

export type AddonPrice = {
  addon_plan_id: string;
  base_plan_id: string;
  combined_amount: number | string;
  active?: boolean | null;
};

export type AddonResolution = {
  /** 이 학생에게 이 프로그램의 한 달 기준금액. */
  monthly: number;
  /** 함께 하는 항목. 없으면 혼자 하는 값입니다. */
  withPlanId: string | null;
  withPlanName: string | null;
  combined: number | null;
  /** 혼자서는 신청할 수 없는데(기준금액 0) 함께 하는 항목도 없음. */
  blocked: boolean;
};

export function isAddonPlan(planId: string, prices: readonly AddonPrice[]): boolean {
  return prices.some((p) => p.addon_plan_id === planId && p.active !== false);
}

/**
 * @param chosenPlanIds 이 학생이 이 학기에 고른(옵션이나 직접 금액이 있는) 학비 항목들.
 * @returns 이 항목이 함께 하는 프로그램이 아니면 null.
 */
export function resolveAddon(
  plan: { id: string; base_amount: number | string },
  prices: readonly AddonPrice[],
  plans: readonly { id: string; name: string; base_amount: number | string }[],
  chosenPlanIds: readonly string[],
): AddonResolution | null {
  const rows = prices.filter((p) => p.addon_plan_id === plan.id && p.active !== false);
  if (rows.length === 0) return null;
  // 함께 하는 항목이 둘이면 합친 금액이 큰 쪽입니다 - 학교가 안내하는 표가 그 조합으로 묶여 있습니다.
  const hit = rows
    .filter((r) => chosenPlanIds.includes(r.base_plan_id))
    .sort((a, b) => Number(b.combined_amount) - Number(a.combined_amount))[0];
  if (hit) {
    const base = plans.find((p) => p.id === hit.base_plan_id);
    const combined = Number(hit.combined_amount) || 0;
    return {
      monthly: Math.max(0, combined - (Number(base?.base_amount) || 0)),
      withPlanId: hit.base_plan_id,
      withPlanName: base?.name ?? null,
      combined,
      blocked: false,
    };
  }
  const alone = Number(plan.base_amount) || 0;
  return { monthly: alone, withPlanId: null, withPlanName: null, combined: null, blocked: alone <= 0 };
}

/** `tuitionLine` 에 넘길 항목 - 기준금액만 바꾼 사본입니다. 이름은 그대로 둡니다(청구 범위가 이름으로 묶입니다). */
export function addonPlanForLine<P extends { base_amount: number | string }>(plan: P, res: AddonResolution | null): P {
  return res ? { ...plan, base_amount: res.monthly } : plan;
}

/** 비고 한 줄: 「방과후 5일반과 함께 · 합계 ₩550,000」 */
export function addonNote(res: AddonResolution | null): string | null {
  if (!res) return null;
  if (res.blocked) return "함께 하는 방과후가 없어 0원 — 방과후를 먼저 고르세요";
  if (!res.withPlanName) return null;
  return `${res.withPlanName}과 함께 · 합계 ₩${Math.round(res.combined ?? 0).toLocaleString()}`;
}
