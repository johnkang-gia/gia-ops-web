import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { normalizePlate, plateProblem } from "@/lib/plateMatch";

export const dynamic = "force-dynamic";

/**
 * 하원 체크표에서 **차번호만** 고치는 창구.
 *
 * ── 왜 따로 만드나 ──────────────────────────────────────────────────────────
 *
 * 지입차량이라 차가 자주 바뀝니다. 그런데 지금까지 차번호를 고치려면 셔틀 → 노선 관리로
 * 옮겨가야 했습니다. 차가 바뀐 것을 아는 순간은 **체크표를 보고 있을 때**이고, 그 자리에서
 * 못 고치면 「나중에 고쳐야지」가 되고 대개 안 고쳐집니다. 그 사이 체크표·안내보드·도착체크에
 * 옛 번호가 뜨는데, 그건 오류가 아니라 **그냥 다른 차 번호**로 보입니다.
 *
 * `shuttle_routes` 는 노선 마스터라 RLS가 행정직원·관리자만 쓰도록 막혀 있습니다. 체크표는
 * 동승 선생님까지 쓰는 화면이라, 표 전체를 열어주는 대신 **이 칸 하나만** 서비스 롤로
 * 우회하고 **여기서 직위를 직접 확인**합니다.
 *
 * ── 누가 고칠 수 있나 ───────────────────────────────────────────────────────
 *
 * 행정직원·관리자입니다(`isStaffOrAboveUser`). 차번호는 노선 마스터 자료라, 오늘 하루
 * 체크만 하는 분이 손대면 그 뒤로 모든 화면이 그 값을 따릅니다.
 *
 * **화면에서 단추를 안 보여주는 것은 예의이지 자물쇠가 아닙니다**(CLAUDE.md 2-8). 주소만
 * 알면 그대로 부를 수 있으므로 여기서 다시 봅니다.
 *
 * ── 기록 ────────────────────────────────────────────────────────────────────
 *
 * 바뀐 이력은 `shuttle_route_vehicle_history` 트리거가 알아서 남깁니다. 여기서 또 적으면
 * 두 줄이 생기고, 어느 쪽이 맞는지 나중에 알 수 없습니다.
 */
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isStaffOrAboveUser(me)) {
    return NextResponse.json(
      { error: "차번호는 행정직원·관리자만 고칠 수 있습니다. 행정실에 알려주세요." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => null)) as { routeId?: string; vehicleNo?: string | null } | null;
  const routeId = body?.routeId;
  if (!routeId) return NextResponse.json({ error: "routeId가 필요합니다." }, { status: 400 });

  // 다듬는 규칙은 @/lib/plateMatch 한 곳입니다 - 화면과 여기가 다르게 다듬으면, 화면에
  // 보이는 글자와 저장된 글자가 달라집니다.
  const vehicleNo = normalizePlate(body?.vehicleNo);
  const problem = plateProblem(body?.vehicleNo);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const service = createServiceClient(url, serviceKey, { auth: { persistSession: false } });

  // 데모 노선은 건드리지 않습니다. 오리엔테이션용 가짜 자료라 실제 운행과 섞이면 안 됩니다.
  const { data: route } = await service.from("shuttle_routes").select("id, term, vehicle_no").eq("id", routeId).maybeSingle();
  if (!route) return NextResponse.json({ error: "그런 노선이 없습니다." }, { status: 404 });
  if (route.term === "데모") return NextResponse.json({ error: "연습용 노선은 고칠 수 없습니다." }, { status: 400 });

  const { error } = await service.from("shuttle_routes").update({ vehicle_no: vehicleNo }).eq("id", routeId);
  // 조용히 넘기면 화면에는 바뀐 것처럼 보이는데 실제로는 옛 번호가 남습니다.
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, vehicleNo, before: route.vehicle_no ?? null });
}
