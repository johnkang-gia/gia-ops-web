import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { createRequest, type RequestKind } from "@/lib/financeRequests";

export const dynamic = "force-dynamic";

/**
 * 결손·환불 결재 요청을 올립니다. 장부는 아직 바뀌지 않습니다 - 다른 사람이 승인해야
 * 들어갑니다(`financeRequests.ts`).
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const b = (await req.json().catch(() => null)) as
    | { kind?: string; invoiceId?: string; amount?: number; reason?: string; refundedAt?: string; method?: string }
    | null;
  const kind = b?.kind === "결손" || b?.kind === "환불" ? (b.kind as RequestKind) : null;
  if (!kind) return NextResponse.json({ error: "결손인지 환불인지 골라주세요." }, { status: 400 });
  if (!b?.invoiceId) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });

  const supabase = await createClient();
  const r = await createRequest(supabase, me, {
    kind,
    invoiceId: b.invoiceId,
    amount: Number(b.amount),
    reason: String(b.reason ?? ""),
    refundedAt: b.refundedAt ?? null,
    method: b.method ?? null,
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, request: r.request });
}
