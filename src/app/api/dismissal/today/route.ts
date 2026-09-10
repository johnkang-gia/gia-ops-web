import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { loadTodayPickups } from "@/lib/pickups";
import { todayKst } from "@/lib/kst";

/**
 * **오늘 픽업** — 「오늘 하원체크」가 셔틀 아닌 아이를 전부 보여주기 위해 씁니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 업무보드 맨 위의 「오늘 하원체크」는 [학생 → 하원수단]만 읽었습니다. 그래서 학원차·보호자
 * 픽업으로 **미리 등록해 둔** 아이만 떴고, **오늘 학부모가 연락해 온 픽업**은 안 떴습니다.
 * 담당자에게는 둘 다 「오늘 이 아이를 어떻게 내보내나」인데 화면이 반쪽만 보여준 것입니다.
 *
 * 픽업 판단은 **다시 만들지 않습니다.** `loadTodayPickups` 한 곳에서만 정합니다 - 화면마다
 * 다시 쓰면 화면마다 다른 답이 나오고, 그러면 사람은 어느 화면도 안 믿게 됩니다.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createClient();
  const day = todayKst();

  const { data: roster, error: rosterErr } = await supabase
    .from("wr_students")
    .select("id, name")
    .eq("is_demo", false);
  // 명부를 못 읽으면 **빈 목록으로 답하지 않습니다.** 「오늘 픽업이 없다」와 「못 읽었다」가
  // 화면에서 똑같이 보이면, 아무도 안 데리러 가는 날에도 아무 일 없어 보입니다.
  if (rosterErr) return NextResponse.json({ error: `명부를 읽지 못했습니다: ${rosterErr.message}` }, { status: 500 });

  const nameById = new Map(((roster as { id: string; name: string }[] | null) ?? []).map((s) => [s.id, s.name]));
  const pickups = await loadTodayPickups(supabase, day, (id) => nameById.get(id) ?? null);

  return NextResponse.json({ day, pickups });
}
