import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **올린 묶음을 버립니다.**
 *
 * 잘못 올린 파일, 시험으로 올린 파일이 목록에 남아 있으면 **언젠가 누가 반영을 누릅니다.**
 * 버리는 길이 없으면 그 파일은 영영 목록에 남고, 남아 있는 것은 결국 눌립니다.
 *
 * **이미 반영된 줄이 있으면 못 버립니다.** 버려도 나간 청구서는 그대로 남는데, 그러면
 * 「어느 파일에서 왔나」에 답할 곳이 사라집니다. 그 경우에는 나간 청구서를 취소하는 것이
 * 맞는 길입니다.
 *
 * 줄은 **지우지 않고 상태만 바꿉니다.** 지우면 「그때 무엇을 올렸었나」가 사라집니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!hasFinanceAccess(me)) return NextResponse.json({ error: "재무 권한이 필요합니다." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { batchId?: string; reason?: string } | null;
  const batchId = body?.batchId;
  if (!batchId) return NextResponse.json({ error: "묶음을 고르지 못했습니다." }, { status: 400 });

  const supabase = await createClient();

  const { count: applied } = await supabase
    .from("payment_import_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .not("applied_at", "is", null);

  if ((applied ?? 0) > 0) {
    return NextResponse.json(
      { error: `이미 ${applied}줄이 실제 자료로 나갔습니다. 버릴 수 없습니다 — 나간 청구서를 취소하거나 환불로 되돌려주세요.` },
      { status: 400 },
    );
  }

  const reason = String(body?.reason ?? "").trim();
  const { data, error } = await supabase
    .from("payment_imports")
    .update({ status: "버림", note: reason || null, applied_by: me.email, applied_at: new Date().toISOString() })
    .eq("id", batchId)
    .neq("status", "반영됨")
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // 정말 바뀌었는지 셉니다. 0줄이면 화면에는 성공으로 보이지만 아무것도 안 바뀐 것입니다.
  if (!data || data.length === 0) return NextResponse.json({ error: "이미 반영된 묶음은 버릴 수 없습니다." }, { status: 400 });

  // 남은 줄도 건너뜀으로 눕혀 둡니다. 「버림」인데 줄은 대기로 남아 있으면 진행 표에서
  // 계속 할 일로 세어집니다.
  await supabase.from("payment_import_rows").update({ decision: "건너뜀" }).eq("batch_id", batchId).is("applied_at", null);

  return NextResponse.json({ ok: true });
}
