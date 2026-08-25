import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { isDemoAccount } from "@/lib/sharedAccounts";

export const dynamic = "force-dynamic";

// 담임/과목 선생님 → 행정실 문의 창구(요청 4). 교사는 본인 글만, 관리자·행정직원은 전체를
// 봅니다. 서비스 롤로 조회하되 로그인 사용자의 이메일/권한으로만 좁혀 다른 반 글이 새지
// 않게 합니다.
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  const me = await getCurrentAppUser();
  if (!me?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const supabase = admin();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const scope = new URL(req.url).searchParams.get("scope");
  const staff = isStaffOrAboveUser(me);

  let q = supabase.from("teacher_office_requests").select("*").order("created_at", { ascending: false }).limit(100);
  if (scope === "all" && staff) {
    // 업무 대시보드용: 아직 완료되지 않은 것 위주로(완료도 최근 것은 함께).
  } else {
    // 교사 본인 화면: 자기 글만.
    q = q.eq("teacher_email", me.email);
  }
  const { data } = await q;
  return NextResponse.json({ requests: data ?? [], staff });
}

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const supabase = admin();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { category?: string; message?: string; classLabel?: string | null };
  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });
  const category = ["도움요청", "문의", "기타"].includes(body.category ?? "") ? body.category! : "문의";

  const demo = isDemoAccount(me.email);
  // 담임 반 라벨을 서버에서 채웁니다(클라이언트가 보낸 값은 참고용).
  let classLabel = (body.classLabel ?? "").trim() || null;
  if (!classLabel) {
    const { data: cls } = await supabase
      .from("wr_classes")
      .select("grade, class_name")
      .or(`teacher_email.eq.${me.email},sub_teacher_email.eq.${me.email}`)
      .eq("is_demo", demo);
    classLabel =
      (cls ?? []).map((c) => `${c.grade ?? ""}${c.class_name ?? ""}`.trim()).filter(Boolean).join(" · ") || null;
  }

  const { data, error } = await supabase
    .from("teacher_office_requests")
    .insert({
      teacher_email: me.email,
      teacher_name: me.name ?? null,
      class_label: classLabel,
      category,
      message,
      is_demo: demo,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ request: data });
}

export async function PATCH(req: Request) {
  const me = await getCurrentAppUser();
  if (!me?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const supabase = admin();
  if (!supabase) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!body.id || !["접수", "확인", "완료"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const patch: Record<string, unknown> = { status: body.status };
  patch.resolved_at = body.status === "완료" ? new Date().toISOString() : null;
  const { error } = await supabase.from("teacher_office_requests").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
