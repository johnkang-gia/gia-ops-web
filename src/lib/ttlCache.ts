/**
 * **잠깐 들고 있기** — 몇 초 사이에 바뀔 리 없는 조회를 매번 다시 하지 않습니다.
 *
 * ── 왜 만들었나 ──────────────────────────────────────────────────────
 *
 * 중앙 대시보드는 사무실 모니터에서 **30초마다** 스스로 다시 읽습니다. 하루 1,500번이
 * 넘습니다. 그때마다 학생 137명 명부, 반 목록, 교시, 오늘 시간표를 통째로 다시 읽고
 * 있었습니다 - 이것들은 **학기 중에 거의 안 바뀝니다.**
 *
 * 안 바뀌는 것을 계속 실어 나르는 일은 화면이 느려지는 것으로도, 오류로도 보이지
 * 않습니다. **청구서에만 보입니다.** 실제로 Supabase 무료 한도(월 5GB)를 넘겼습니다.
 *
 * ── 무엇을 넣고 무엇을 안 넣나 ───────────────────────────────────────
 *
 * 넣는 것: 명부·반·교시·시간표처럼 **사람이 오늘 안 건드릴 것**.
 * 안 넣는 것: 출결·픽업·체크표·쪽지·문의처럼 **방금 누른 것이 바로 보여야 하는 것**.
 *
 * 잘못 넣으면 「눌렀는데 화면이 안 바뀐다」가 되고, 그건 지금 고치는 문제보다 나쁩니다.
 *
 * ── 왜 이렇게 단순한가 ───────────────────────────────────────────────
 *
 * 서버는 여러 대로 늘어날 수 있어서, 이 기억은 **한 대 안에서만** 통합니다. 그래도
 * 대시보드 한 대가 30초마다 두드리면 대개 같은 서버로 가서 잘 맞습니다. 안 맞으면
 * 그냥 한 번 더 읽을 뿐이라 틀릴 일이 없습니다 - 맞으면 이득이고 틀리면 본전입니다.
 */

type Entry = { at: number; value: unknown };

const store = new Map<string, Entry>();

/** 기본 보관 시간. 대시보드 폴링(30초)보다 넉넉히 길게 잡아야 실제로 맞습니다. */
export const DEFAULT_TTL_MS = 120_000;

/**
 * `key` 로 잠깐 들고 있다가, 시간이 지났으면 `load()` 를 다시 부릅니다.
 *
 * **읽기 전용에만 씁니다.** 쓰기가 섞이면 방금 저장한 것이 안 보입니다.
 */
export async function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as T;

  const value = await load();
  store.set(key, { at: now, value });

  // 오래된 것을 걷어냅니다. 안 그러면 날짜가 열쇠에 섞인 항목이 하루하루 쌓입니다.
  if (store.size > 200) {
    for (const [k, v] of store) if (now - v.at > ttlMs * 4) store.delete(k);
  }
  return value;
}

/** 자료를 고친 뒤 즉시 다시 읽게 만듭니다(명부를 손봤을 때 등). */
export function invalidate(prefix: string): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
