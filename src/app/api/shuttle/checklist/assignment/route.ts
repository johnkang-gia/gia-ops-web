import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 하원 체크표(로그인 사용자 전체가 씀)에서 shuttle_assignments의 두 칸만 건드리는 전용
// API입니다. shuttle_assignments는 노선/정류장 같은 마스터데이터라 RLS가 행정직원·관리자만
// 쓰도록 막아뒀는데(요청: 노선 관리는 행정직원 전용), 체크표는 동승 선생님을 포함한 로그인
// 사용자 전체가 쓰는 화면이라 "계속 유지" 노선 변경(요청: "계속 수정이면 계속 바뀐그대로
// 고정")과 학생별 특이사항 메모(요청: "특이사항있는 아이들... 메모적을 수 있게")는 막히면
// 안 됩니다. 그래서 이 두 칸만 서비스 롤로 우회해 쓰고, 로그인한 giamicro.com 계정인지는
// 여기서 직접 확인합니다(테이블 전체를 열어주는 대신, 딱 이 API가 허용하는 두 칸만).
export async function POST(req: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();
  if (!email.endsWith("@giamicro.com")) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { assignmentId?: string; permanentRouteId?: string | null; note?: string | null } | null;
  const assignmentId = body?.assignmentId;
  if (!assignmentId) return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body ?? {}, "permanentRouteId")) patch.override_route_id = body?.permanentRouteId ?? null;
  if (Object.prototype.hasOwnProperty.call(body ?? {}, "note")) patch.note = (body?.note ?? "").toString().slice(0, 500) || null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const service = createServiceClient(url, serviceKey, { auth: { persistSession: false } });

  const { error } = await service.from("shuttle_assignments").update(patch).eq("id", assignmentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
