import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

/**
 * 청구서의 **올톡페이 보냄 표시**를 켜고 끕니다.
 *
 * 파일을 내보내면 저절로 찍히지만(`export/alltalkpay` 의 mark), 올톡페이 화면에서 직접
 * 등록한 건은 앱이 모릅니다. 사람이 표시할 자리가 없으면 그 장은 영영 「안 보냄」으로
 * 남아 또 보내게 됩니다.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { invoiceIds?: string[]; exported?: boolean };
  const ids = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter((v) => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "청구서를 골라주세요." }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoices")
    .update(body.exported === false ? { exported_at: null, export_batch: null } : { exported_at: new Date().toISOString(), export_batch: `수동:${me.email}` })
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: ids.length });
}
