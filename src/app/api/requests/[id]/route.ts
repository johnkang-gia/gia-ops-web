import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { logApiError } from "@/lib/logging";
import type { StaffRequest } from "@/lib/types";

// 행정 요청 상태 변경(접수대기→처리중→완료) - 관리자/행정직원만 처리할 수 있습니다
// (DB의 is_wr_manager() RLS가 최종 방어선이고, 여기서도 미리 한 번 더 확인해 권한 없는
// 사용자에게는 명확한 오류 메시지를 돌려줍니다). 보통은 업무보드에서 담당자가 "확인"하거나
// "완료"로 옮기면 tasks_sync_staff_request 트리거가 이 상태를 자동으로 갱신해주지만(요청:
// "업무목록에서 확인체크를 한개라도하면... 완료탭으로 옮기면..."), 이 화면에서 직접 상태를
// 바꾸는 수동 처리 경로도 남겨둡니다 - 그 경우 연결된 업무(tasks)도 함께 맞춰서 업무보드와
// 요청 화면이 서로 어긋나지 않게 합니다.
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

    const item = data as StaffRequest;
    if (item.task_id) {
      if (status === "완료") {
        await supabase
          .from("tasks")
          .update({ status: "완료", completed_at: new Date().toISOString(), updated_by: user.email })
          .eq("id", item.task_id)
          .neq("status", "완료");
      } else {
        await supabase
          .from("tasks")
          .update({ status: "진행중", completed_at: null, updated_by: user.email })
          .eq("id", item.task_id)
          .eq("status", "완료");
      }
    }

    return NextResponse.json({ success: true, item });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "requests-update", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
