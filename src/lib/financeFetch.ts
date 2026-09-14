/**
 * **재무 화면은 줄을 잘라 읽지 않습니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 재무 화면들이 `limit(500)` · `limit(1000)` 으로 목록을 읽어 그 자리에서 더했습니다.
 * 학생 139명 × (학비 + 학비외) ≒ **월 278장**이라, 두 달이면 500을 넘고 넉 달이면 1000을
 * 넘습니다.
 *
 * 넘는 순간 무슨 일이 생기는지가 중요합니다 - **오류가 나지 않습니다.** 개요의 「발행한
 * 금액」이 조용히 줄어들고, 상습 미납 목록에서 오래된 사람이 사라지고, 수납 화면의 미대사
 * 입금이 안 보입니다. 화면에는 그냥 «다른 숫자»로 보이고, 그 숫자가 틀렸다는 사실은
 * 어디에도 안 나타납니다. 조용한 실패입니다(CLAUDE.md 5).
 *
 * ── 어떻게 고쳤나 ───────────────────────────────────────────────────────────
 *
 * 한도를 올리는 것은 답이 아닙니다. 올린 한도도 언젠가 넘고, 넘는 날은 또 조용합니다.
 * **끝까지 읽습니다** - `range()` 로 1000줄씩 이어 붙여 더 없을 때까지 갑니다.
 *
 * 그래도 상한은 둡니다(`FINANCE_CEILING`). 자료가 잘못 불어났을 때 화면이 영영 안 뜨는
 * 것보다는 낫습니다. 다만 상한에 닿으면 **`truncated` 로 알려주고 화면이 그 사실을
 * 빨간 줄로 적습니다.** 잘렸다는 것을 모르는 채로 더한 합계가 가장 나쁩니다.
 *
 * 합계를 데이터베이스가 내는 자리(`finance_monthly` · `finance_item_monthly`)에서는 이것도
 * 필요 없습니다. 목록 자체가 필요한 화면에서만 씁니다.
 */

/** 한 번에 읽는 줄 수. Supabase 기본 상한(1000)에 맞춥니다. */
export const FINANCE_PAGE = 1000;

/** 여기까지만 읽습니다. 1년치 청구서(≒3,400장)의 열 배가 넘는 값입니다. */
export const FINANCE_CEILING = 50_000;

export type PageResult = { data: unknown[] | null; error: { message: string } | null };

export type ReadAllResult<T> = {
  rows: T[];
  /** 상한에 닿아 더 있는데 못 읽었는가. 참이면 **화면이 반드시 그 사실을 적습니다.** */
  truncated: boolean;
  error: string | null;
};

/**
 * 끝까지 읽습니다.
 *
 * ```ts
 * const inv = await readAll<Invoice>((from, to) =>
 *   supabase.from("invoices").select("*").order("created_at", { ascending: false }).range(from, to),
 * );
 * ```
 *
 * **정렬을 반드시 넣으세요.** 정렬 없이 `range()` 로 나눠 읽으면 페이지마다 순서가 달라져
 * 같은 줄이 두 번 오거나 아예 빠질 수 있습니다. 그것도 오류로는 안 보입니다.
 */
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>): Promise<ReadAllResult<T>> {
  const rows: T[] = [];
  for (let from = 0; from < FINANCE_CEILING; from += FINANCE_PAGE) {
    const { data, error } = await page(from, from + FINANCE_PAGE - 1);
    // 중간에 실패하면 **거기까지 읽은 것을 합계로 쓰지 않습니다.** 절반짜리 합계는
    // 화면에서 온전한 합계와 구별되지 않습니다.
    if (error) return { rows: [], truncated: false, error: error.message };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < FINANCE_PAGE) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

/**
 * 여러 번 읽은 것 중 하나라도 잘렸는가 · 실패했는가를 한 줄로 모읍니다.
 * 화면마다 세 개씩 늘어놓으면 하나를 빠뜨립니다.
 */
export function readNotice(...results: { truncated: boolean; error: string | null }[]): string | null {
  const failed = results.map((r) => r.error).filter(Boolean);
  if (failed.length > 0) return `자료를 읽지 못했습니다: ${failed.join(" / ")}`;
  if (results.some((r) => r.truncated)) {
    return `자료가 너무 많아 ${FINANCE_CEILING.toLocaleString("ko-KR")}줄까지만 읽었습니다. 아래 숫자는 실제보다 적습니다 — 개발자에게 알려주세요.`;
  }
  return null;
}
