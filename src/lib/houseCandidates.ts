/**
 * **이 연락은 어느 집에서 왔나** — 방에 이어 둔 아이들을 꺼내옵니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 학기 초에 사람이 황라원·황라윤을 그 토들 방에 이어 두었습니다. 그런데 형제방에서 온 글은
 * 본문이 둘 중 누구인지 안 갈라 주면 **학생 번호가 비어 있고**, 화면은 그 비어 있음만 보고
 * 「학생 미연결」이라고 띄웠습니다.
 *
 * 이어 둔 것이 있는데도 없는 것처럼 보이면, 보는 사람은 **처음부터 다시 찾습니다** - 137명
 * 목록을 열어 이름을 치고, 이미 한 일을 또 합니다. 게다가 「미연결」은 틀린 말입니다: 집은
 * 확정돼 있고 아이만 안 갈린 것입니다.
 *
 * ── 왜 여기 한 곳인가 ───────────────────────────────────────────────────────
 *
 * 학생 하루 보드가 이미 같은 일을 하고 있었습니다(`studentDayLoad`). 픽업 창구가 따로
 * 만들면 두 화면이 서로 다른 집을 말하게 되고, 어느 쪽이 맞는지 아무도 모릅니다.
 *
 * **명부는 번호로 찾습니다**(CLAUDE.md §2-4). 이름으로 찾으면 김재이 셋이 한 줄을 나눠 씁니다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseChild = { id: string; name: string };

/**
 * 방 번호 → 그 방에 이어 둔 아이들(이어 둔 순서대로).
 *
 * 못 읽으면 **빈 표가 아니라 이유를 함께** 돌려줍니다. 이어 둔 것이 안 보이는 것과 이어 둔
 * 것이 없는 것은 다른 말인데, 화면만 보고는 구별할 수 없습니다(CLAUDE.md §5).
 */
export async function loadHouseCandidates(
  supabase: SupabaseClient,
  channelIds: string[],
  /** 명부. 졸업·전학으로 빠진 아이는 고르게 두지 않습니다. */
  roster: readonly { id: string; name: string }[],
): Promise<{ houseOf: Map<string, HouseChild[]>; problem: string | null }> {
  const ids = [...new Set(channelIds.filter(Boolean))];
  const houseOf = new Map<string, HouseChild[]>();
  if (ids.length === 0) return { houseOf, problem: null };

  const { data, error } = await supabase
    .from("toddle_channel_students")
    .select("channel_id, student_id, seq")
    .in("channel_id", ids);
  if (error) return { houseOf, problem: `이어 둔 방의 아이를 읽지 못했습니다: ${error.message}` };

  const byId = new Map(roster.map((s) => [s.id, s]));
  for (const l of ((data as { channel_id: string; student_id: string; seq: number }[] | null) ?? []).sort(
    (a, b) => a.seq - b.seq,
  )) {
    const st = byId.get(l.student_id);
    if (!st) continue;
    houseOf.set(l.channel_id, [...(houseOf.get(l.channel_id) ?? []), { id: st.id, name: st.name }]);
  }
  return { houseOf, problem: null };
}
