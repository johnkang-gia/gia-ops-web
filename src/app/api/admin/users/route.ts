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

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const status = String(body.status || "");
  if (!email || !["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "email과 status(approved/rejected/pending)가 필요합니다." }, { status: 400 });
  }
  if (isDeveloperEmail(email)) {
    return NextResponse.json({ error: "개발자 계정 상태는 변경할 수 없습니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("app_users")
    .update({ status, decided_at: new Date().toISOString(), decided_by: user.email })
    .eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
