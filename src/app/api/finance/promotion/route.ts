import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { applyPromotion, buildPromotion } from "@/lib/promotion";

export const dynamic = "force-dynamic";

/** 미리보기. 아무것도 바꾸지 않습니다. */
export async function GET(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const u = new URL(req.url);
  const from = u.searchParams.get("from");
  const to = u.searchParams.get("to");
  if (!from || !to) return NextResponse.json({ error: "옮길 학기 둘을 골라주세요." }, { status: 400 });
  const supabase = await createClient();
  const r = await buildPromotion(supabase, from, to, me.email);
  if (!r.plan) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ students: r.plan.students, counts: r.plan.counts });
}

/**
 * 옮깁니다. **미리보기를 다시 계산해서** 넣습니다 - 화면이 보낸 목록을 그대로 믿으면, 미리 본 뒤
 * 다른 사람이 새 학기에 넣은 줄과 겹쳐 같은 할인이 두 번 붙을 수 있습니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { from?: string; to?: string } | null;
  if (!b?.from || !b?.to) return NextResponse.json({ error: "옮길 학기 둘을 골라주세요." }, { status: 400 });
  const supabase = await createClient();
  const r = await buildPromotion(supabase, b.from, b.to, me.email);
  if (!r.plan) return NextResponse.json({ error: r.error }, { status: 400 });
  const out = await applyPromotion(supabase, r.plan);
  if (out.errors.length > 0) return NextResponse.json({ error: `일부를 옮기지 못했습니다: ${out.errors.join(" / ")}`, done: out.done }, { status: 500 });
  return NextResponse.json({ ok: true, done: out.done });
}
