import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { logApiError } from "@/lib/logging";

// 행정 요청 상태 변경(접수대기→처리중→완료) - 관리자/행정직원만 처리할 수 있습니다
// (DB의 is_wr_manager() RLS가 최종 방어선이고, 여기서도 미리 한 번 더 확인해 권한 없는
// 사용자에게는 명확한 오류 메시지를 돌려줍니다).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const me = await getCurrentAppUser();
  if (!isStaffOrAboveUser(me)) {
    return NextResponse.json({ error: "관리자/행정직원만 처리할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const status = String(body.status || "");
  const resolvedNote = typeof body.resolvedNote === "string" ? body.resolvedNote : undefined;

  if (!["접수대기", "처리중", "완료"].includes(status)) {
    return NextResponse.json({ error: "알 수 없는 상태입니다." }, { status: 400 });
  }

  try {
    const payload: Record<string, unknown> = { status };
    if (resolvedNote !== undefined) payload.resolved_note = resolvedNote;
    if (status === "완료") {
      payload.resolved_by = user.email;
      payload.resolved_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("staff_requests")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "requests-update", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
