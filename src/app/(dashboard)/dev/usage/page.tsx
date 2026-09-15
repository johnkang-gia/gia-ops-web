import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isSuperAdminUser } from "@/lib/roles";
import UsageClient, { type UsageRow } from "@/components/dev/UsageClient";

/**
 * **이용 기록 — 누가 언제 어느 화면을 얼마나 봤나.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 화면이 백 개 가까이 되는데 **어떤 화면이 실제로 쓰이는지 아무도 모릅니다.** 만든 사람은
 * 다 쓰인다고 생각하고, 안 쓰이는 화면은 조용히 남아 메뉴를 늘리고 다음 사람의 눈을 가립니다.
 * 반대로 하루에 스무 번 열리는 화면이 여전히 불편한 채로 있는데 그것도 숫자가 없으면 모릅니다.
 *
 * ── 누가 보나 ───────────────────────────────────────────────────────────────
 *
 * **최고관리자·개발자만** 봅니다. 사람에 대한 기록이라 화면에서 가리는 것으로는 부족해서,
 * 표 자체도 그 두 사람에게만 열려 있습니다(RLS, CLAUDE.md §2-8).
 */

export const dynamic = "force-dynamic";

const DAYS = 30;

export default async function UsagePage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 화면 가리기와 자물쇠가 **같은 기준**이어야 합니다. 어긋나면 「보이는데 자료가 안 온다」가
  // 되고, 원인을 짐작하기 어렵습니다.
  if (!isSuperAdminUser(me)) redirect("/home");

  const supabase = await createClient();
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  // 30일치를 한 번에 읽습니다. 하루 이용이 많아도 교직원 스무 명 규모라 줄 수가 크지 않고,
  // 나눠 읽으면 화면마다 다른 기간을 보게 됩니다.
  const { data, error } = await supabase
    .from("usage_events")
    .select("user_email, user_name, position, session_id, kind, path, label, action, duration_ms, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20000);

  return (
    <UsageClient
      rows={((data as UsageRow[] | null) ?? [])}
      days={DAYS}
      loadError={error?.message ?? null}
    />
  );
}
