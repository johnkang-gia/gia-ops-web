import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Adopted } from "@/lib/types";
import { logApiError } from "@/lib/logging";

// 요청 4번(채택예정 되돌리기): 제안함에서 실수로(또는 마음이 바뀌어) 승인한 항목을 다시
// 제안함(검토대기)으로 되돌립니다. adopted.source_id에는 원본 제안(proposals.case_id)이
// 그대로 저장되어 있으므로, 그 case_id로 원본 제안 행을 찾아 status를 "검토대기"로 되돌리고
// 이 채택예정 행은 삭제합니다. 이미 발행(publish=true)된 항목은 매뉴얼에 내용이 이미 합쳐져
// 들어갔기 때문에 되돌릴 수 없습니다(발행 전 단계에서만 되돌리기를 허용).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  try {
    const { data: row, error: fetchErr } = await supabase.from("adopted").select("*").eq("id", id).single();
    if (fetchErr || !row) {
      return NextResponse.json({ error: fetchErr?.message || "채택예정 항목을 찾을 수 없습니다." }, { status: 404 });
    }
    const adopted = row as Adopted;
    if (adopted.publish) {
      return NextResponse.json({ error: "이미 발행된 항목은 되돌릴 수 없습니다." }, { status: 400 });
    }

    const { data: originalProposal } = await supabase
      .from("proposals")
      .select("id")
      .eq("case_id", adopted.source_id)
      .maybeSingle();

    if (originalProposal) {
      const { error: updateErr } = await supabase
        .from("proposals")
        .update({ status: "검토대기", reflected_at: null })
        .eq("id", originalProposal.id);
      if (updateErr) throw new Error(updateErr.message);
    }

    const { error: deleteErr } = await supabase.from("adopted").delete().eq("id", id);
    if (deleteErr) throw new Error(deleteErr.message);

    return NextResponse.json({ success: true, restoredToProposal: Boolean(originalProposal) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "adopted-revert", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
