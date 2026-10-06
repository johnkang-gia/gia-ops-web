import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { createRequest } from "@/lib/financeRequests";

export const dynamic = "force-dynamic";

/**
 * **환불 요청을 올립니다.** 장부(반대 방향 입금 한 줄)는 다른 사람이 승인할 때 들어갑니다.
 *
 * 예전에는 이 창구가 곧바로 입금 줄을 넣었습니다. 되돌리기 어려운 일을 한 사람이 혼자 끝낼
 * 수 있었고, 「누가 확인했나」에 답이 없었습니다. 옛 화면·즐겨찾기가 이 주소를 부르므로
 * 주소는 남기고 하는 일만 결재 요청으로 바꿉니다(`financeRequests.ts`).
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { invoiceId?: string; amount?: number; reason?: string; refundedAt?: string; method?: string }
    | null;
  if (!body?.invoiceId) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });

  const supabase = await createClient();
  const r = await createRequest(supabase, me, {
    kind: "환불",
    invoiceId: body.invoiceId,
    amount: Number(body.amount),
    reason: String(body.reason ?? ""),
    refundedAt: body.refundedAt ?? null,
    method: body.method ?? null,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, pending: true, request: r.request });
}
