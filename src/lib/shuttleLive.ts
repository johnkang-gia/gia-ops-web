import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * **하원 명단이 달라지는 표는 한 곳에 적습니다.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 하원 시간에는 같은 명단을 세 화면이 동시에 봅니다.
 *
 *   · 하원 체크표      — 행정실에서 픽업·결석·노선이동을 누릅니다
 *   · 하원 셔틀명단    — 같은 화면의 옆 탭. 누가 어느 차를 타는지 봅니다
 *   · 차량 도착·출발 체크 — 현장에서 QR로 여는 화면. 실제로 아이를 태웁니다
 *
 * 세 화면이 **각자 다른 표 목록을 듣고 있었습니다.** 체크표는 배정·체크표·노선을 듣고,
 * 셔틀명단은 배정·정류장만 들었습니다. 그래서 체크표에서 결석을 눌러도 셔틀명단은 모르고,
 * 차번호를 고쳐도 명단은 옛 번호를 보여줬습니다.
 *
 * 어느 화면이 무엇을 듣는지를 화면마다 따로 적으면 **빠뜨린 화면은 오류를 내지 않습니다.**
 * 그냥 옛 명단을 보여줍니다. 종이에 뽑아 쓰는 표라 그 종이에 없는 아이는 아무도 안 찾고,
 * 빠져야 할 아이는 차에 탑니다. 되돌릴 수 없는 일입니다.
 *
 * ── 도착체크는 왜 여기 없나 ─────────────────────────────────────────────────
 *
 * 도착·출발 체크는 **로그인 없이 여는 토큰 화면**이라 실시간 구독을 쓸 수 없습니다. 대신
 * 3초마다 물어보고, 서버가 「번호가 바뀌었는가」로 답합니다(`boardRevision.ts`). 그 번호를
 * 올리는 트리거의 표 목록이 아래 목록과 **같아야** 세 화면이 같은 답을 합니다 -
 * `scripts/check-shuttle-live.mjs` 가 둘이 어긋나면 빌드를 멈춥니다.
 */
export const SHUTTLE_LIVE_TABLES = [
  /** 누가 어느 정류장에 배정됐나. 명단의 뼈대입니다. */
  "shuttle_assignments",
  /** 오늘의 픽업·결석·탑승·노선이동. 하원 시간에 가장 자주 바뀝니다. */
  "shuttle_boardings",
  /** 정류장이 어느 노선에 붙나. 정류장을 옮기면 아이도 함께 옮겨집니다. */
  "shuttle_stops",
  /** 차번호·기사님·노선 사용 여부. 체크표에서 차번호를 직접 고칩니다. */
  "shuttle_routes",
  /** 요일별 하원수단. 셔틀이 아닌 날은 명단에서 빠집니다. */
  "student_dismissal_plans",
  /** 지속 특이사항. 「매주 수요일은 학원차」 같은 것이 명단을 바꿉니다. */
  "shuttle_persistent_notes",
  /** 오늘 차가 떠났는가·도착했는가. 도착체크가 쓰고 체크표가 봅니다. */
  "shuttle_run_events",
] as const;

/**
 * 하원 자료가 바뀌면 알려줍니다. 세 화면 중 **로그인해서 여는 두 화면**이 씁니다.
 *
 * **구독에 조건을 걸지 않습니다.** 화면에 아직 없는 줄이 새로 생기거나 보고 있던 줄이
 * 지워지는 것은 조건에 안 걸려 통째로 놓칩니다 - 그리고 그 둘이 하필 가장 중요합니다
 * (새로 타게 된 아이 · 빠진 아이).
 *
 * @param onChange 무엇이 바뀌었는지는 넘기지 않습니다. 화면이 「무엇이 바뀌었으니 무엇을
 *   고친다」를 스스로 정하기 시작하면 그 규칙이 화면마다 한 벌씩 생기고, 한 벌이 틀리면
 *   그 화면만 다른 명단을 냅니다. 그냥 다시 읽습니다.
 */
export function subscribeShuttleLive(
  supabase: SupabaseClient,
  onChange: () => void,
  channelName = "shuttle-live",
  /**
   * 이 화면이 **스스로 더 촘촘히 듣고 있는** 표. 여기 적은 표는 이 구독에서 빠집니다.
   *
   * 하원 체크표는 픽업·결석을 누르면 서버를 다시 거치지 않고 그 줄만 바로 고칩니다 -
   * 누르자마자 바뀌어야 하는 화면이라 그게 맞습니다. 그 표까지 여기서 또 받으면 누를
   * 때마다 화면 전체를 다시 그리게 되고, 그건 빠른 것을 느리게 만듭니다.
   *
   * **적는 것이 요점입니다.** 빠뜨린 것과 일부러 뺀 것이 코드에서 구별되어야, 나중에
   * 「왜 이 표는 안 듣지」를 물어볼 수 있습니다.
   */
  handledElsewhere: readonly string[] = [],
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // 한 번 고치면 여러 줄이 잇따라 옵니다(노선 하나를 옮기면 배정 여러 줄). 아주 잠깐
  // 모았다 한 번만 다시 읽습니다 - 300ms 는 사람이 못 느끼는 시간입니다.
  const nudge = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 300);
  };

  let ch = supabase.channel(channelName);
  for (const table of SHUTTLE_LIVE_TABLES) {
    if (handledElsewhere.includes(table)) continue;
    ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, nudge);
  }
  ch.subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    void supabase.removeChannel(ch);
  };
}
