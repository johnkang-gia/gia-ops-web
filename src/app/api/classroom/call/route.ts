import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 행정실 → 교실 호출. 이쪽은 **로그인한 직원만** 부릅니다.
//
// 교실 화면(토큰)과 달리 여기는 사람이 누르는 자리라, 로그인 상태 그대로 씁니다.
// 누가 눌렀는지가 남아야 «누가 왜 불렀나»를 나중에 되짚을 수 있습니다.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    classId?: string;
    kind?: string;
    studentName?: string | null;
    reason?: string | null;
    cancelId?: string;
  };

  // 잘못 눌렀을 때. 지우지 않고 취소로 남깁니다.
  if (body.cancelId) {
    const { error } = await supabase
      .from("classroom_calls")
      .update({ canceled_at: new Date().toISOString() })
      .eq("id", body.cancelId)
      .is("acked_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!body.classId) return NextResponse.json({ error: "어느 반인지 알 수 없습니다." }, { status: 400 });

  // 교실에 화면이 없으면 호출해도 아무도 못 봅니다. 보내기 전에 알려줍니다 -
  // «보냈으니 됐다»가 가장 위험합니다.
  const { data: link } = await supabase
    .from("classroom_links")
    .select("id, enabled, last_seen_at")
    .eq("class_id", body.classId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("classroom_calls")
    .insert({
      class_id: body.classId,
      kind: body.kind ?? "호출",
      student_name: body.studentName ?? null,
      reason: body.reason ?? null,
      created_by: user.email ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const seen = link?.last_seen_at ? new Date(link.last_seen_at as string).getTime() : 0;
  const stale = !link || !link.enabled || Date.now() - seen > 2 * 60 * 1000;

  return NextResponse.json({
    ok: true,
    id: (data as { id: string }).id,
    // 화면이 죽어 있으면 그렇다고 말합니다. 호출은 남아 있으니 태블릿이 켜지면 그때 뜹니다.
    warning: stale
      ? !link
        ? "이 반은 교실 태블릿 링크가 아직 없습니다. 호출은 저장했지만 지금은 아무 데도 뜨지 않습니다."
        : "이 반 태블릿이 2분 넘게 조용합니다(꺼졌거나 와이파이 끊김). 직접 알려주세요."
      : null,
  });
}
