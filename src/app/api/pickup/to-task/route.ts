import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { genCaseId } from "@/lib/caseId";

export const dynamic = "force-dynamic";

// 학부모 문의 한 건을 업무로 올립니다.
//
// 요청: "문의탭에서만 우선보이고 클릭해서 업무로 등록할 수 있도록 만들어줘"
//
// 자동으로 만들지 않는 이유
//   문의는 하루에도 수십 건 들어옵니다. 전부 업무가 되면 원래 업무가 그 안에 묻히고, 업무
//   목록이 "읽을 것"이 되어버려 아무도 안 보게 됩니다. 그래서 담당자가 "이건 처리해야 할
//   일이다"라고 판단한 것만 손으로 넘깁니다.
//
// 담당자는 담임 선생님으로 미리 채웁니다. 학부모 문의는 대개 담임이 답하고, 아니면 화면에서
// 바꾸면 됩니다.
export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createClient();
  const body = await req.json().catch(() => null);
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

  const { data: row } = await supabase
    .from("pickup_requests")
    .select(
      "id, summary, raw_text, matched_name, ai_student_name, inquiry_type, urgency, homeroom_email, source_url, task_id, student_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "문의를 찾을 수 없습니다." }, { status: 404 });
  if (row.task_id) return NextResponse.json({ error: "이미 업무로 등록된 문의입니다." }, { status: 400 });

  let studentDepartment: string | null = null;
  if (row.student_id) {
    const { data: s } = await supabase.from("wr_students").select("department").eq("id", row.student_id).maybeSingle();
    studentDepartment = (s?.department as string | null) ?? null;
  }

  const student = (row.matched_name as string | null) ?? (row.ai_student_name as string | null) ?? "학생 미확인";
  const summary = (row.summary as string | null) ?? (row.raw_text as string | null) ?? "학부모 문의";
  const title = `[학부모 문의] ${student} · ${summary}`.slice(0, 80);

  // 담임이 아직 가입 전이면 넘긴 사람이 일단 맡습니다. 담당자가 비어 있으면 업무 흐름판에
  // 아예 안 보여서 그대로 잊힙니다.
  const assignee = (row.homeroom_email as string | null) ?? me.email;

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      case_id: genCaseId("TSK"),
      title,
      status: "예정",
      priority: row.urgency === "높음" ? "긴급" : "보통",
      // 부서는 학생의 부서(초등부)로 답니다 - 문의는 그 학생이 속한 부서의 일입니다.
      department: studentDepartment,
      owner_email: me.email,
      assignee_emails: [assignee],
      position: Date.now(),
      // 원문으로 돌아갈 수 있게 토들 링크를 본문에 남깁니다.
      description: [
        row.raw_text ? `학부모 문의 내용:\n${row.raw_text}` : null,
        row.inquiry_type ? `분류: ${row.inquiry_type}` : null,
        row.source_url ? `토들 원문: ${row.source_url}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
    })
    .select("id")
    .single();

  if (error || !task) return NextResponse.json({ error: error?.message ?? "업무를 만들지 못했습니다." }, { status: 500 });

  await supabase.from("pickup_requests").update({ task_id: task.id }).eq("id", id);

  return NextResponse.json({ ok: true, taskId: task.id });
}
