import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail, canManageFinanceAccess } from "@/lib/roles";
import { getCurrentAppUser } from "@/lib/currentUser";
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

// 최고관리자를 여기 넣지 않은 것은 실수가 아닙니다. 최고관리자는 개발자 바로 밑이라
// **개발자만** 올릴 수 있습니다(아래에서 따로 거릅니다). 관리자가 스스로를 최고관리자로
// 올릴 수 있으면 계층이 계층이 아닙니다.
const EDITABLE_POSITIONS = ["교사", "행정직원", "관리자"];
const DEVELOPER_ONLY_POSITIONS = ["최고관리자"];
const EDITABLE_DEPARTMENTS = ["유치부", "초등부", "중고등부"];

// status(승인/거절/차단)와 position(직위=권한)을 둘 다 여기서 다룹니다. 둘 중 하나만 보내도
// 되고 둘 다 보내도 됩니다(예: 승인하면서 직위도 같이 정정). 실제 쓰기 권한은 DB의
// is_app_admin() RLS 정책이 최종적으로 막아주므로(관리자/개발자가 아니면 이 UPDATE 자체가
// 거부됨), 여기서는 입력값 형식만 확인합니다.
// name/department는 요청("개발자는 사용자관리에서 사용자의 이름,부서들을 바꿀 수 있도록")에
// 따라 추가했습니다 - 온보딩 때 본인이 잘못 입력했거나 오탈자가 있을 때 개발자가 직접 정정할
// 수 있게 하되, 일반 관리자는 여전히 승인/직위만 바꿀 수 있고 이름/부서는 여기서(앱 계층에서)
// 개발자 계정으로만 제한합니다(DB RLS는 관리자도 app_users를 쓸 수 있게 열려 있어서, DB가
// 아니라 이 라우트가 마지막 방어선입니다).
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
  // 재무 열쇠(요청: "재무관리자만 이 돈에 관한 메뉴를 볼 수 있도록").
  const financeAccess = body.financeAccess !== undefined ? Boolean(body.financeAccess) : undefined;
  const financeReason = body.financeReason !== undefined ? String(body.financeReason) : undefined;
  const name = body.name !== undefined ? String(body.name) : undefined;
  const department = body.department !== undefined ? String(body.department) : undefined;
  // 교직원 통합기록(요청: "언제 입사하였고, 퇴사는 언제했는지... 고유 데이터로 기록 유지") -
  // 입사일/퇴사일은 status/position과 같은 권한 경계(is_app_admin())로 관리자가 직접 넣습니다.
  // 빈 문자열을 보내면 "날짜 지움"으로 처리합니다(퇴사 취소 등).
  const hireDate = body.hire_date !== undefined ? String(body.hire_date) : undefined;
  const leaveDate = body.leave_date !== undefined ? String(body.leave_date) : undefined;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (hireDate !== undefined && hireDate !== "" && !DATE_RE.test(hireDate)) {
    return NextResponse.json({ error: "입사일 형식이 올바르지 않습니다(YYYY-MM-DD)." }, { status: 400 });
  }
  if (leaveDate !== undefined && leaveDate !== "" && !DATE_RE.test(leaveDate)) {
    return NextResponse.json({ error: "퇴사일 형식이 올바르지 않습니다(YYYY-MM-DD)." }, { status: 400 });
  }
  if (status !== undefined && !["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "status는 approved/rejected/pending 중 하나여야 합니다." }, { status: 400 });
  }
  if (position !== undefined && position !== "" && !EDITABLE_POSITIONS.includes(position)) {
    // 최고관리자로 올리는 것은 개발자만 할 수 있습니다.
    if (!(DEVELOPER_ONLY_POSITIONS.includes(position) && isDeveloperEmail(user.email))) {
      return NextResponse.json(
        { error: "position은 교사/행정직원/관리자 중 하나여야 합니다(최고관리자는 개발자만 지정)." },
        { status: 400 }
      );
    }
  }
  if (department !== undefined && department !== "" && !EDITABLE_DEPARTMENTS.includes(department)) {
    return NextResponse.json({ error: "department는 유치부/초등부/중고등부 중 하나여야 합니다." }, { status: 400 });
  }
  if (name !== undefined && name.trim() === "") {
    return NextResponse.json({ error: "이름은 비워둘 수 없습니다." }, { status: 400 });
  }
  if (
    status === undefined &&
    position === undefined &&
    name === undefined &&
    department === undefined &&
    hireDate === undefined &&
    leaveDate === undefined
  ) {
    return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  }
  if (isDeveloperEmail(email)) {
    return NextResponse.json({ error: "개발자 계정은 변경할 수 없습니다." }, { status: 400 });
  }
  if ((name !== undefined || department !== undefined) && !isDeveloperEmail(user.email)) {
    return NextResponse.json({ error: "이름/부서 변경은 개발자만 할 수 있습니다." }, { status: 403 });
  }

  // ── 재무 열쇠는 별도의 문을 씁니다 ──────────────────────────────────
  //
  // 이 라우트에 들어왔다는 것은 관리자라는 뜻일 뿐입니다. 열쇠를 주고 뺏는 것은 개발자와
  // 최고관리자만 할 수 있습니다 - 관리자끼리 서로 열쇠를 나눠 가질 수 있으면 "재무관리자만
  // 본다"가 아무 뜻도 없어집니다.
  const me = await getCurrentAppUser();
  if (financeAccess !== undefined && !canManageFinanceAccess(me)) {
    return NextResponse.json({ error: "재무 권한은 최고관리자만 바꿀 수 있습니다." }, { status: 403 });
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
  if (name !== undefined) {
    update.name = name.trim();
  }
  if (department !== undefined) {
    update.department = department || null;
  }
  if (hireDate !== undefined) {
    update.hire_date = hireDate || null;
  }
  if (leaveDate !== undefined) {
    update.leave_date = leaveDate || null;
  }
  if (financeAccess !== undefined) {
    update.finance_access = financeAccess;
  }

  const { error } = await supabase.from("app_users").update(update).eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 열쇠를 누가 언제 주고 뺏었는지 남깁니다. "지금 누가 갖고 있나"만으로는 나중에 문제가
  // 생겼을 때 아무 설명도 못 합니다. 기록이 실패해도 권한 변경 자체는 되돌리지 않습니다
  // (되돌리면 화면에는 실패로 보이는데 DB는 이미 바뀐 상태가 되어 더 헷갈립니다).
  if (financeAccess !== undefined) {
    await supabase
      .from("finance_access_log")
      .insert({
        target_email: email,
        granted: financeAccess,
        changed_by: user.email,
        reason: financeReason?.trim() || null,
      })
      .then(undefined, () => undefined);
  }

  return NextResponse.json({ success: true });
}
