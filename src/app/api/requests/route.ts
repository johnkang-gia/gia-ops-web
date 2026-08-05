import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { genCaseId } from "@/lib/caseId";
import { logApiError } from "@/lib/logging";
import { translateKoEn } from "@/lib/ai/translate";

// 행정 요청(교사 → 행정직원) 등록 - 요청("교사는 행정부에... 요청하는 여러 일들(사물함파손,
// 물품구입, 아픈학생인계, 출결상황문의)"). requested_by_name은 클라이언트가 보낸 값을 믿지 않고
// create_staff_request RPC 안에서 로그인 계정 기준으로 채워집니다. 카테고리는 관리자가
// 등록/편집하는 staff_request_categories 테이블이 기준이라(요청: "관리자가 등록/편집할 수
// 있게"), 여기서 active한 값인지 먼저 확인합니다. 제목/내용은 한/영 번역을 함께 붙이고(요청:
// "교사들이 원어민이 많기 때문에... 한,영 번역을 지원해주고"), 등록과 동시에
// create_staff_request RPC로 초등부 전체 업무창에도 업무를 하나 만듭니다(요청: "초등부 전체
// 업무창에 자동으로 행정요청이 등록되게") - 요청 행과 업무 행을 한 트랜잭션으로 묶어 하나만
// 반쯤 생기는 일이 없도록 합니다.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const category = String(body.category || "");
  const title = String(body.title || "").trim();
  const content = String(body.content || "").trim();
  const studentName = String(body.studentName || "").trim();

  if (!title) {
    return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  }

  try {
    const { data: categoryRow } = await supabase
      .from("staff_request_categories")
      .select("category")
      .eq("category", category)
      .eq("active", true)
      .maybeSingle();
    if (!categoryRow) {
      return NextResponse.json({ error: "분류를 선택해주세요." }, { status: 400 });
    }

    // 번역 실패는 조용히 넘어갑니다(translateKoEn이 항상 {}를 반환) - title_ko/en 등이 비어도
    // 요청 등록 자체는 계속 진행됩니다.
    const translated = await translateKoEn({ title, ...(content ? { content } : {}) });

    const { data, error } = await supabase.rpc("create_staff_request", {
      p_case_id: genCaseId("REQ"),
      p_task_case_id: genCaseId("TSK"),
      p_category: category,
      p_title: title,
      p_title_ko: translated.title?.ko ?? null,
      p_title_en: translated.title?.en ?? null,
      p_content: content,
      p_content_ko: translated.content?.ko ?? null,
      p_content_en: translated.content?.en ?? null,
      p_student_name: studentName || null,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, item: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logApiError(supabase, "requests-create", err, user.email);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
