import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterEntry } from "@/lib/pickupParse";
import { buildAliasIndex, type AliasRule } from "@/lib/studentMatch";

/**
 * 사람이 가르쳐 둔 별칭을 읽어옵니다 — **출결과 픽업이 같은 표를 봅니다.**
 *
 * 표는 하나뿐입니다(`attendance_learning_rules`). 출결 인박스의 🔎 「가르치기」가 쓰고,
 * 셔틀 명단 연결도 이걸 읽습니다. 픽업만 안 읽고 있었습니다.
 *
 * 표를 따로 만들지 않은 이유: 사람은 「마야 = 김마야」를 한 번 가르쳤다고 생각합니다.
 * 표가 두 개면 두 번 가르쳐야 하는데, 화면에는 그렇게 안 적혀 있어서 **가르쳤는데도
 * 안 되는 것**으로 보입니다.
 *
 * 못 읽어도 던지지 않습니다. 별칭은 «있으면 더 잘 붙는 것»이지 없다고 멈출 일이
 * 아닙니다 - 다만 **조용히 넘기지는 않습니다.**
 */
export async function loadAliasIndex(supabase: SupabaseClient, roster: RosterEntry[]): Promise<Map<string, RosterEntry>> {
  const { data, error } = await supabase
    .from("attendance_learning_rules")
    .select("pattern, student_id, student_name")
    .eq("kind", "alias");
  if (error) {
    console.error("[alias] 가르쳐 둔 별칭을 읽지 못했습니다 — 이름이 평소보다 덜 붙습니다:", error.message);
    return new Map();
  }
  return buildAliasIndex((data as AliasRule[] | null) ?? [], roster);
}
