import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { AppUser } from "@/lib/types";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // 목록 조회 자체는 is_app_admin() RLS 정책이 최종적으로 막아줍니다(승인되지 않은 사용자는
  // 본인 행 하나만 보이게 됩니다). 여기서는 사용성을 위해 미승인 사용자에게 명확한 에러만 줍니다.
  const { data, error } = await supabase
    .from("app_users")
    .select("*")
    .order("status", { ascending: true })
    .order("requested_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data as AppUser[]) ?? [];
  const isSelfOnly = rows.length <= 1 && !isDeveloperEmail(user.email);
  if (isSelfOnly) {
    return NextResponse.json({ error: "승인된 관리자만 사용자 목록을 볼 수 있습니다." }, { status: 403 });
  }

  return NextResponse.json({ users: rows });
}

const EDITABLE_POSITIONS = ["교사", "행정직원", "관리자"];

// status(승인/거절/차단)와 position(직위=권한)을 둘 다 여기서 다룹니다. 둘 중 하나만 보내도
// 되고 둘 다 보내도 됩니다(예: 승인하면서 직위도 같이 정정). 실제 쓰기 권한은 DB의
// is_app_admin() RLS 정책이 최종적으로 막아주므로(관리자/개발자가 아니면 이 UPDATE 자체가
// 거부됨), 여기서는 입력값 형식만 확인합니다.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const status = body.status !== undefined ? String(body.status) : undefined;
  const position = body.position !== undefined ? String(body.position) : undefined;

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (status !== undefined && !["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "status는 approved/rejected/pending 중 하나여야 합니다." }, { status: 400 });
  }
  if (position !== undefined && position !== "" && !EDITABLE_POSITIONS.includes(position)) {
    return NextResponse.json({ error: "position은 교사/행정직원/관리자 중 하나여야 합니다." }, { status: 400 });
  }
  if (status === undefined && position === undefined) {
    return NextResponse.json({ error: "status 또는 position 중 하나는 필요합니다." }, { status: 400 });
  }
  if (isDeveloperEmail(email)) {
    return NextResponse.json({ error: "개발자 계정은 변경할 수 없습니다." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (status !== undefined) {
    update.status = status;
    update.decided_at = new Date().toISOString();
    update.decided_by = user.email;
  }
  if (position !== undefined) {
    update.position = position || null;
  }

  const { error } = await supabase.from("app_users").update(update).eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
