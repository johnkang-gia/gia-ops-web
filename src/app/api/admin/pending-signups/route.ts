import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";

/**
 * **승인을 기다리는 가입 신청** — 개발자 계정만 봅니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 누가 가입하면 슬랙으로 알림이 갑니다. 그런데 슬랙을 안 보고 있으면 그 사람은 「승인
 * 대기」 화면에 갇힌 채로 하루를 보냅니다 - 본인은 무엇을 더 해야 하는지 모르고, 우리는
 * 기다리는 사람이 있다는 것 자체를 모릅니다.
 *
 * 그래서 **앱 안에서도** 보이게 합니다. 슬랙과 둘 중 하나만 보면 되도록.
 *
 * ── 왜 개발자만인가 ─────────────────────────────────────────────────
 *
 * 승인은 개발자 계정이 [사용자 관리]에서 합니다. 처리할 수 없는 사람에게 띄우면 그저
 * 지워지지 않는 표시가 되고, 지워지지 않는 표시는 곧 안 읽히는 표시가 됩니다.
 */

export const dynamic = "force-dynamic";

export type PendingSignup = {
  email: string;
  name: string | null;
  department: string | null;
  position: string | null;
  created_at: string | null;
};

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  // 미리보기 중(previewOf)이라도 실제 계정이 개발자면 봅니다 - 이 알림은 화면 재현과
  // 상관없는 「사람이 기다리고 있다」는 사실이라, 미리보기 때문에 놓치면 안 됩니다.
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("email, name, department, position, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  // 읽지 못했으면 **0건이라고 답하지 않습니다.** 「기다리는 사람이 없다」와 「못 읽었다」는
  // 다른 말인데, 화면에는 똑같이 «아무 표시 없음»으로 보입니다.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data as PendingSignup[] | null) ?? [];
  return NextResponse.json({ count: items.length, items });
}
