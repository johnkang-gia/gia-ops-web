import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **바뀌었는지만 물어봅니다** — 중앙 대시보드·안내보드·도착체크가 뷰어가 되는 자리.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 대시보드는 30초마다(도착체크·안내보드는 3초마다) 스스로 다시 물어봅니다. 그때마다
 * 서버가 **처음부터 전부 다시 계산**했습니다 - 명부·반·교시·시간표·출결·픽업·체크표·
 * 쪽지·문의·업무를 매번 통째로 읽었습니다.
 *
 * 그런데 대부분의 30초 동안 **아무것도 안 바뀝니다.** 안 바뀐 것을 다시 계산해서 다시
 * 실어 보내는 일이 하루 1,500번 넘게 일어났고, 그것이 무료 한도를 통째로 먹었습니다.
 *
 * ── 어떻게 바꾸나 ────────────────────────────────────────────────────
 *
 * 화면이 **자기가 들고 있는 번호**를 함께 보냅니다. 번호가 같으면 서버는 「안 바뀌었습니다」
 * 한 줄만 돌려줍니다 - 계산도 안 하고 자료도 안 읽습니다.
 *
 * 번호를 올리는 일은 **자료를 바꾸는 쪽**이 합니다. 코드에서 부르지 않고 표에 트리거를
 * 걸어두었습니다(`20260916000000_board_revisions.sql`) - 코드에서 부르면 언젠가 한 곳을
 * 빠뜨리고, 빠뜨리면 「왜 반영이 안 되지」가 됩니다.
 *
 * ── 빠뜨려도 조용히 틀리지 않게 ──────────────────────────────────────
 *
 * 트리거를 못 건 표가 남아 있을 수 있습니다(새로 만든 표를 잊는 등). 그래서 번호가 같아도
 * **일정 시간이 지나면 한 번은 전부 계산합니다.** 최악이라도 그 시간 안에는 반영됩니다.
 *
 * 이 안전장치가 없으면 「번호를 안 올리는 표」 하나가 화면을 영영 멈춰 세울 수 있고,
 * 그건 지금 고치는 문제보다 훨씬 나쁩니다.
 */

/** 화면마다 보는 자료가 다릅니다. 하나로 묶으면 시간표 한 줄 고쳤다고 도착체크까지 다시 셉니다. */
export type BoardKey = "ops" | "shuttle" | "timetable";

/**
 * 번호가 같아도 이 시간이 지나면 한 번은 전부 계산합니다.
 *
 * 3분으로 잡은 이유: 하원 시간에 놓치면 안 되는 일(픽업·결석)이 3분 늦게 뜨는 것은
 * 견딜 만하고, 그보다 짧으면 아끼는 뜻이 옅어집니다.
 */
export const MAX_STALE_MS = 3 * 60_000;

export type RevisionCheck = {
  /** 지금 번호. 화면이 다음에 물어볼 때 이걸 그대로 보냅니다. */
  revision: number;
  /** 다시 계산해야 하는가. 번호가 다르거나, 오래 지났거나, 번호를 못 읽었으면 true. */
  stale: boolean;
  /** 왜 다시 계산하는지. 「번호가 안 올라가는 표」를 찾을 때 이 값이 단서입니다. */
  why: "번호다름" | "처음" | "시간지남" | "번호못읽음" | null;
};

/** 서버 한 대가 마지막으로 전부 계산한 때. 안전장치(MAX_STALE_MS)에 씁니다. */
const lastFull = new Map<string, number>();

/**
 * 화면이 보낸 번호와 지금 번호를 견줍니다.
 *
 * **못 읽으면 다시 계산합니다.** 「모르겠으니 그냥 안 바뀐 걸로 하자」는, 화면이 조용히
 * 멈춰 서는 길입니다.
 */
export async function checkRevision(
  supabase: SupabaseClient,
  key: BoardKey,
  since: number | null,
  scope = "",
): Promise<RevisionCheck> {
  const { data, error } = await supabase.from("board_revisions").select("revision").eq("key", key).maybeSingle();

  if (error || !data) {
    // 표가 아직 없거나(마이그레이션 전) 못 읽었으면 예전처럼 매번 계산합니다.
    // 아끼지 못할 뿐 틀리지는 않습니다.
    return { revision: 0, stale: true, why: "번호못읽음" };
  }

  const revision = Number((data as { revision: number }).revision ?? 0);
  const mark = `${key}:${scope}`;
  const now = Date.now();
  const last = lastFull.get(mark) ?? 0;

  if (since === null) {
    lastFull.set(mark, now);
    return { revision, stale: true, why: "처음" };
  }
  if (since !== revision) {
    lastFull.set(mark, now);
    return { revision, stale: true, why: "번호다름" };
  }
  if (now - last > MAX_STALE_MS) {
    // 번호는 같은데 오래 지났습니다. 트리거를 못 건 표가 있을 수 있으니 한 번 봅니다.
    lastFull.set(mark, now);
    return { revision, stale: true, why: "시간지남" };
  }
  return { revision, stale: false, why: null };
}

/** 주소의 `?since=` 를 숫자로. 없거나 이상하면 null(= 처음 물어보는 것으로 봅니다). */
export function parseSince(url: string): number | null {
  const raw = new URL(url).searchParams.get("since");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
