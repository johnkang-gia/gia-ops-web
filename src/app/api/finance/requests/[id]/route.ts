import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { decideRequest } from "@/lib/financeRequests";

export const dynamic = "force-dynamic";

/** 승인 · 반려 · (올린 사람의) 취소. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const { id } = await params;

  const b = (await req.json().catch(() => null)) as { action?: string; note?: string } | null;
  const action = b?.action === "승인" || b?.action === "반려" || b?.action === "취소" ? b.action : null;
  if (!action) return NextResponse.json({ error: "승인·반려·취소 중 하나를 골라주세요." }, { status: 400 });
  const note = (b?.note ?? "").trim() || null;
  // 반려는 이유가 있어야 합니다. 올린 사람이 무엇을 고쳐 다시 올릴지 알 수 없습니다.
  if (action === "반려" && !note) return NextResponse.json({ error: "반려 사유를 적어주세요." }, { status: 400 });

  const supabase = await createClient();
  const r = await decideRequest(supabase, me, id, action, note);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, warning: r.error });
}
