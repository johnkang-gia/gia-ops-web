import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **지금 무슨 학기인가** — 화면(클라이언트)에서 물어보는 자리.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 학사일정에서 [항목 추가]를 누르면 팝업이 뜨자마자 「학기 정보를 읽지 못했습니다」가
 * 났습니다. 이유는 **없는 칸을 물어봤기 때문**입니다.
 *
 *     supabase.from("terms").select("*").eq("is_current", true)   ← terms 에 없는 칸
 *
 * `is_current` 는 **요금 학기표(fee_terms)** 의 칸입니다. 학사 학기표(terms)는 `status`
 * 로 「진행중」을 나타냅니다. 두 표가 같은 말을 다른 칸에 담고 있어서, 한쪽을 보고 쓴
 * 코드가 다른 쪽에 그대로 갔습니다.
 *
 * 화면에는 「학기 정보를 읽지 못했습니다」로만 보입니다 - 자료가 없는 것인지, 권한이
 * 없는 것인지, 칸 이름이 틀린 것인지 구별되지 않습니다. 그래서 두 곳 다 몇 주를 그대로
 * 있었습니다.
 *
 * 서버에서 읽는 자리는 `@/lib/currentTerm` 의 `getCurrentTerm()` 입니다. 이 파일은
 * **같은 기준을 화면에서 쓰기 위한 것**이고, 서버 전용 코드를 끌어오지 않도록 따로
 * 두었습니다(클라이언트 컴포넌트가 서버 모듈을 import 하면 빌드가 깨집니다).
 */

/** 학사 학기표에서 「진행중」을 뜻하는 값. 글자를 여기저기 적지 않습니다. */
export const TERM_RUNNING = "진행중";

/**
 * 지금 진행 중인 학기 한 줄. **못 읽은 것과 없는 것을 갈라서** 돌려줍니다.
 *
 * 「학기가 아직 안 만들어졌다」와 「읽다가 실패했다」는 사람이 할 일이 다릅니다.
 * 앞은 학기 관리에서 만들면 되고, 뒤는 고쳐야 하는 것입니다.
 */
export async function fetchCurrentTerm<T = Record<string, unknown>>(
  supabase: SupabaseClient,
): Promise<{ term: T | null; error: string | null }> {
  const { data, error } = await supabase
    .from("terms")
    .select("*")
    .eq("status", TERM_RUNNING)
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { term: null, error: error.message };
  return { term: ((data as T[] | null) ?? [])[0] ?? null, error: null };
}
