import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";

const DEPARTMENTS = ["유치부", "초등부", "중고등부"];
const POSITIONS = ["교사", "행정직원", "관리자", "개발자"];

// 교직원 통합기록의 연도/학기별 담당 이력(staff_assignments) 추가/삭제입니다. 실제 쓰기 권한은
// DB의 admin_write_staff_assignments RLS 정책(is_app_admin())이 최종적으로 막아주므로, 여기서는
// 입력값 형식만 확인하고 명확한 에러 메시지를 줍니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 담당 이력을 추가할 수 있습니다." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const staffEmail = String(body.staff_email || "").toLowerCase().trim();
  const roleLabel = String(body.role_label || "").trim();
  const termId = body.term_id ? String(body.term_id) : null;
  const department = body.department ? String(body.department) : null;
  const position = body.position ? String(body.position) : null;
  const grade = body.grade ? String(body.grade) : null;
  const classId = body.class_id ? String(body.class_id) : null;
  const note = body.note ? String(body.note) : null;

  if (!staffEmail) return NextResponse.json({ error: "staff_email이 필요합니다." }, { status: 400 });
  if (!roleLabel) return NextResponse.json({ error: "담당 역할(role_label)을 입력해주세요." }, { status: 400 });
  if (department && !DEPARTMENTS.includes(department)) {
    return NextResponse.json({ error: "department는 유치부/초등부/중고등부 중 하나여야 합니다." }, { status: 400 });
  }
  if (position && !POSITIONS.includes(position)) {
    return NextResponse.json({ error: "position 값이 올바르지 않습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("staff_assignments")
    .insert({
      staff_email: staffEmail,
      term_id: termId,
      department,
      position,
      role_label: roleLabel,
      grade,
      class_id: classId,
      note,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ assignment: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAdminUser(me)) return NextResponse.json({ error: "관리자만 담당 이력을 삭제할 수 있습니다." }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { error } = await supabase.from("staff_assignments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
