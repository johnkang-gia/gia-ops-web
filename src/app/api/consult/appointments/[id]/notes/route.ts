import { NextResponse } from "next/server";
import { consultSession } from "@/lib/consult/access";
import { genCaseId } from "@/lib/caseId";
import { departmentOf } from "@/lib/department";
import { loadStudent } from "@/lib/students";

export const dynamic = "force-dynamic";

/**
 * 상담 메모 남기기. 쓴 사람과 관리자만 다시 읽습니다(표의 자물쇠).
 *
 * `follow_up` 을 보내면 그 내용으로 업무보드에 할 일을 하나 만들고 학생 번호로 잇습니다 -
 * 상담에서 «다음 주까지 자료 보내 드릴게요»라고 한 약속이 메모 속에 묻혀 잊히는 일을 막으려는 것입니다.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: apptId } = await params;
  const s = await consultSession();
  if (!s.ok) return s.res;
  // 면담하는 선생님은 그날 정해지므로 담당 방으로 막지 않습니다(호출·시작·종료와 같은 이유).
  // 메모는 쓴 사람과 관리자만 다시 읽으므로, 열어 두어도 남의 메모가 보이지는 않습니다.

  const body = (await req.json().catch(() => ({}))) as { student_id?: string | null; room_id?: string | null; body?: string; follow_up?: string | null };
  const text = String(body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "메모 내용을 적어 주세요." }, { status: 400 });

  const { data: appt, error: aErr } = await s.supabase
    .from("consult_appointments")
    .select("id, event_id, consult_events(is_demo), consult_appointment_students(student_id)")
    .eq("id", apptId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!appt) return NextResponse.json({ error: "예약을 찾지 못했습니다." }, { status: 404 });
  const isDemo = !!(appt as unknown as { consult_events: { is_demo: boolean } | null }).consult_events?.is_demo;
  const linked = ((appt as unknown as { consult_appointment_students: { student_id: string }[] | null }).consult_appointment_students ?? []).map((x) => x.student_id);
  const studentId = body.student_id && linked.includes(body.student_id) ? body.student_id : linked.length === 1 ? linked[0] : null;

  let taskId: string | null = null;
  const follow = String(body.follow_up ?? "").trim();
  if (follow) {
    const { row: student } = studentId ? await loadStudent(s.supabase, studentId, { demo: isDemo }) : { row: null };
    const who = student?.name ?? "학생";
    const { data: task, error: tErr } = await s.supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title: `[상담 후속] ${who} · ${follow}`.slice(0, 80),
        status: "예정",
        owner_email: s.me.email,
        assignee_emails: [s.me.email],
        department: student ? departmentOf({ department: student.department, grade: student.grade }) : null,
      })
      .select("id")
      .single();
    if (tErr) return NextResponse.json({ error: `후속 할 일을 만들지 못했습니다: ${tErr.message}` }, { status: 500 });
    taskId = (task as { id: string }).id;
    if (studentId) {
      const { error: lErr } = await s.supabase.from("task_students").insert({ task_id: taskId, student_id: studentId, linked_by: s.me.email });
      if (lErr) return NextResponse.json({ error: `할 일은 만들었지만 학생을 잇지 못했습니다: ${lErr.message}` }, { status: 500 });
    }
  }

  const { error } = await s.supabase.from("consult_notes").insert({
    appointment_id: apptId,
    student_id: studentId,
    room_id: body.room_id || null,
    author_email: s.me.email.toLowerCase(),
    author_name: s.me.name,
    body: text,
    task_id: taskId,
  });
  if (error) return NextResponse.json({ error: `메모를 남기지 못했습니다: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, taskId });
}
