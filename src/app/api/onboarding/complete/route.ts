import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 가입 첫 화면(온보딩)에서 입력한 내용을 저장합니다.
//
// 요청: "교사의 경우... 교사가 가입을 할 때, 반이나 과목을 선택할 수있게 하고, 관리자 이상이
// 수정도 할 수 있게 만들어줘. 교사와 교직원, 관리자를 선택했을 때 각각 다르게 아래에 나오도록"
//
// 이 라우트가 따로 필요한 이유: 담임반·담당과목을 저장하려면 wr_classes / wr_subjects를 고쳐야
// 하는데, 그 표는 관리자·행정직원만 쓸 수 있게 잠겨 있습니다(교사가 남의 반을 마음대로 바꾸면
// 안 되니까요). 그래서 화면에서 직접 저장하지 못하고, 서버가 아래 두 조건을 확인한 뒤에만
// 대신 채워줍니다.
//   ① 지금 로그인한 본인의 계정에만 쓴다
//   ② 담임이 아직 비어 있는 반, 담당 교사가 아직 비어 있는 과목만 채운다
// 그래서 이미 다른 선생님이 배정된 반을 가로챌 수 없고, 잘못 고른 경우 관리자가
// [반/담임 배정 관리]에서 바로잡으면 됩니다.

const POSITIONS = ["교사", "행정직원", "관리자"];
const DEPARTMENTS = ["유치부", "초등부", "중고등부"];

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const email = user.email.toLowerCase();

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    department?: string;
    position?: string;
    duty?: string;
    classId?: string | null;
    subjectIds?: string[];
  } | null;

  const name = (body?.name ?? "").trim();
  const department = body?.department ?? "";
  const position = body?.position ?? "";
  const duty = (body?.duty ?? "").trim();

  if (!name) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
  if (!DEPARTMENTS.includes(department)) return NextResponse.json({ error: "소속을 선택해주세요." }, { status: 400 });
  if (!POSITIONS.includes(position)) return NextResponse.json({ error: "직위를 선택해주세요." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  const admin = createServiceClient(url, key, { auth: { persistSession: false } });

  const { error: userError } = await admin
    .from("app_users")
    .update({ name, department, position, duty: duty || null })
    .eq("email", email);
  if (userError) return NextResponse.json({ error: userError.message }, { status: 500 });

  // 담임반·담당과목은 교사만. 직위를 행정직원으로 골랐다면 반/과목 값이 넘어와도 무시합니다.
  const assigned: { classLabel?: string; subjectNames: string[] } = { subjectNames: [] };

  if (position === "교사") {
    const classId = body?.classId ?? null;
    if (classId) {
      // 담임이 비어 있는 반만. is(null)로 확인해서, 동시에 두 사람이 같은 반을 골라도 먼저
      // 저장한 쪽만 반영되고 나중 쪽은 조용히 넘어갑니다.
      const { data: updated } = await admin
        .from("wr_classes")
        .update({ teacher_email: email })
        .eq("id", classId)
        .is("teacher_email", null)
        // 데모 반에 실제 선생님이 배정되면 안 됩니다.
        .eq("is_demo", false)
        .select("grade, class_name")
        .maybeSingle();
      if (updated) assigned.classLabel = `${updated.grade ?? ""}학년 ${updated.class_name ?? ""}`.trim();
    }

    const subjectIds = Array.isArray(body?.subjectIds) ? body!.subjectIds!.filter(Boolean).slice(0, 20) : [];
    if (subjectIds.length > 0) {
      const { data: updatedSubjects } = await admin
        .from("wr_subjects")
        .update({ teacher_email: email })
        .in("id", subjectIds)
        .is("teacher_email", null)
        .select("name");
      assigned.subjectNames = (updatedSubjects ?? []).map((s) => s.name as string);
    }
  }

  return NextResponse.json({ ok: true, assigned });
}
