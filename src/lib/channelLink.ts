import type { SupabaseClient } from "@supabase/supabase-js";
import type { RosterEntry } from "@/lib/pickupParse";
import { channelKey } from "@/lib/toddleChannel";

export type LoadedChannel = { id: string; label: string; students: RosterEntry[] };

/**
 * 사람이 이어 둔 토들 방을 읽어옵니다.
 *
 * **확인한 방만 씁니다**(`confirmed_at is not null`). 화면이 제안만 해둔 줄을 여기서
 * 쓰면, 기계가 제안한 것이 사람이 확인한 것처럼 굳어집니다 - 그러면 확인이라는 단계가
 * 아무 뜻이 없어집니다.
 *
 * 못 읽어도 던지지 않습니다. 연결이 없으면 예전처럼 방 이름을 글자로 풀면 됩니다 -
 * 다만 **조용히 넘기지는 않습니다.**
 */
export async function loadChannelLink(
  supabase: SupabaseClient,
  label: string | null | undefined,
  roster: RosterEntry[],
): Promise<LoadedChannel | null> {
  const key = channelKey(label);
  if (!key) return null;

  const { data, error } = await supabase
    .from("toddle_channels")
    .select("id, label, confirmed_at, toddle_channel_students(student_id, seq)")
    .eq("label", (label ?? "").trim())
    .maybeSingle();
  if (error) {
    // 표가 아직 없는 경우(마이그레이션 전)는 «연결이라는 개념이 없다»는 뜻이라 조용히 넘깁니다.
    if (error.code !== "PGRST205" && error.code !== "42P01") {
      console.error("[channel] 토들 채널 연결을 읽지 못했습니다 — 이름을 글자로 풉니다:", error.message);
    }
    return null;
  }
  const row = data as { id: string; label: string; confirmed_at: string | null; toddle_channel_students: { student_id: string; seq: number }[] } | null;
  if (!row || !row.confirmed_at) return null;

  const byId = new Map(roster.map((s) => [s.id, s]));
  const students = [...(row.toddle_channel_students ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .map((l) => byId.get(l.student_id))
    // 졸업·전학으로 명부에서 빠진 아이는 뺍니다. 없는 아이를 가리키는 연결은 붙는 순간 틀립니다.
    .filter((x): x is RosterEntry => !!x);
  if (students.length === 0) return null;
  return { id: row.id, label: row.label, students };
}

/**
 * 이 방에서 글이 들어왔다는 사실을 남깁니다. 아직 안 이어진 방도 줄을 만들어 두어야
 * **연결 화면에 뜹니다** — 토들에서 방 목록을 받아올 길이 없으니, 글이 들어온 방이
 * 우리가 아는 전부입니다.
 */
export async function touchChannel(supabase: SupabaseClient, label: string | null | undefined, at: string): Promise<void> {
  const clean = (label ?? "").trim();
  if (!clean) return;
  const { error } = await supabase
    .from("toddle_channels")
    .upsert({ label: clean, last_seen_at: at, updated_at: at }, { onConflict: "label", ignoreDuplicates: false });
  if (error && error.code !== "PGRST205" && error.code !== "42P01") {
    console.error("[channel] 방 기록을 남기지 못했습니다 — 연결 화면에 안 뜰 수 있습니다:", error.message);
  }
}

/**
 * **방 번호만 찾습니다** — 사람이 확인했든 아니든.
 *
 * `loadChannelLink` 는 「이 연락은 누구 이야기인가」를 정하는 데 쓰므로 **사람이 확인한 방만**
 * 돌려줍니다. 그건 판단이라서 그렇습니다.
 *
 * 하지만 「어느 방에서 왔는가」는 판단이 아니라 **사실**입니다. 확인 전이든 형제방이든 방은
 * 방이고, 그 사실을 버릴 이유가 없습니다 - 학생을 한 명으로 못 좁혀도 그 집 아이들 이력에는
 * 떠야 합니다.
 */
export async function findChannelId(
  supabase: SupabaseClient,
  label: string | null | undefined,
): Promise<string | null> {
  const clean = (label ?? "").trim();
  if (!clean) return null;
  const { data, error } = await supabase.from("toddle_channels").select("id").eq("label", clean).maybeSingle();
  if (error) {
    // 표가 아직 없는 경우(마이그레이션 전)는 조용히 넘깁니다. 그 밖에는 남깁니다 -
    // 집이 안 붙으면 그 연락은 아무에게도 안 보입니다.
    if (error.code !== "PGRST205" && error.code !== "42P01") {
      console.error("[channel] 방 번호를 찾지 못했습니다 — 이 연락에 집이 안 붙습니다:", error.message);
    }
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}
