import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { logApiError } from "@/lib/logging";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(user.email)) {
    return NextResponse.json({ error: "개발자만 문의 상태를 변경할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const status = body.status as "접수" | "처리중" | "완료" | undefined;
  const developerNote = typeof body.developerNote === "string" ? body.developerNote : undefined;

  if (status && !["접수", "처리중", "완료"].includes(status)) {
    return NextResponse.json({ error: "status는 접수/처리중/완료 중 하나여야 합니다." }, { status: 400 });
  }

  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) {
      payload.status = status;
      payload.resolved_at = status === "완료" ? new Date().toISOString() : null;
    }
    if (developerNote !== undefined) payload.developer_note = developerNote;

    const { data, error } = await supabase.from("inquiries").update(payload).eq("id", id).select().single();
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "inquiries-update", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
