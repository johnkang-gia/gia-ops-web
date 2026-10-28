import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **「미납」 도장.** 올톡으로 보낸 뒤 결제가 안 된 장을 사람이 봤다는 기록만 남깁니다.
 *
 * 상태를 바꾸지 않습니다 - 미납은 잔액에서 계산합니다. 이 도장의 쓸모는 하나, 회차 화면이
 * «아직 안 본 장»과 «봤는데 안 낸 장»을 가르게 하는 것입니다. 입금이 붙으면 완납이 이깁니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { invoiceIds?: string[]; checked?: boolean } | null;
  const ids = (body?.invoiceIds ?? []).filter((x) => typeof x === "string");
  if (ids.length === 0) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });
  const checked = body?.checked !== false;

  const supabase = await createClient();
  const patch = checked ? { unpaid_checked_at: new Date().toISOString(), unpaid_checked_by: me.email } : { unpaid_checked_at: null, unpaid_checked_by: null };
  const { data, error } = await supabase.from("invoices").update(patch).in("id", ids).eq("status", "발행").select("id");
  if (error) return NextResponse.json({ error: `표시하지 못했습니다: ${error.message}` }, { status: 500 });
  const done = (data ?? []).length;
  if (done !== ids.length) {
    return NextResponse.json({ error: `${ids.length}장 중 ${done}장만 표시했습니다. 취소된 장이 섞여 있을 수 있습니다.`, done }, { status: 409 });
  }
  return NextResponse.json({ ok: true, done, at: patch.unpaid_checked_at, by: patch.unpaid_checked_by });
}
