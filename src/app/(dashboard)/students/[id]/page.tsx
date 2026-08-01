import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { Incident, Task, TaskComment, ChatMessage, WrClass, WrEnrollment, WrReport, WrStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

// 학생 이름의 영문 표기(괄호 안)를 뗀 한글(또는 원문) 이름만 남깁니다 - 업무/채팅 자유 텍스트
// 검색에 이 짧은 이름을 씁니다(예: "강여명(Ryeomyeong Kang)" → "강여명").
function coreName(fullName: string) {
  return fullName.split("(")[0].trim();
}

function fmtDate(d: string | null) {
  if (!d) return "-";
  return d;
}

export default async function StudentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = (user.email ?? "").toLowerCase();
  if (!isDeveloperEmail(email)) {
    const { data: me } = await supabase.from("app_users").select("position").eq("email", email).maybeSingle();
    if (me?.position !== "관리자" && me?.position !== "행정직원") redirect("/home");
  }

  const { data: studentData } = await supabase.from("wr_students").select("*").eq("id", id).maybeSingle();
  const student = studentData as WrStudent | null;
  if (!student) notFound();

  const searchName = coreName(student.name);

  const [
    enrollmentsRes,
    reportsRes,
    incidentLinksRes,
    tasksRes,
    taskCommentsRes,
    messagesRes,
    currentClassRes,
  ] = await Promise.all([
    supabase.from("wr_enrollments").select("*").eq("student_id", id).order("created_at", { ascending: false }),
    supabase.from("wr_reports").select("*").eq("student_id", id).order("report_date", { ascending: false }),
    supabase.from("incident_students").select("incident_id").eq("student_id", id),
    supabase
      .from("tasks")
      .select("*")
      .or(`title.ilike.%${searchName}%,description.ilike.%${searchName}%`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("task_comments").select("*").ilike("content", `%${searchName}%`).order("created_at", { ascending: false }).limit(20),
    supabase.from("messages").select("*").ilike("content", `%${searchName}%`).order("created_at", { ascending: false }).limit(20),
    student.class_id ? supabase.from("wr_classes").select("*").eq("id", student.class_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const enrollments = (enrollmentsRes.data as WrEnrollment[] | null) ?? [];
  const reports = (reportsRes.data as WrReport[] | null) ?? [];
  const incidentIds = ((incidentLinksRes.data as { incident_id: string }[] | null) ?? []).map((r) => r.incident_id);
  const tasks = (tasksRes.data as Task[] | null) ?? [];
  const taskComments = (taskCommentsRes.data as TaskComment[] | null) ?? [];
  const messages = (messagesRes.data as ChatMessage[] | null) ?? [];
  const currentClass = currentClassRes.data as WrClass | null;

  const { data: incidentsData } = incidentIds.length
    ? await supabase.from("incidents").select("*").in("id", incidentIds).order("date", { ascending: false })
    : { data: [] as Incident[] };
  const incidents = (incidentsData as Incident[] | null) ?? [];

  // 학기(연도+학기유형) 라벨을 붙이기 위해 재학이력/리포트에 등장하는 term_id를 한 번에 조회합니다.
  const termIds = [...new Set([...enrollments.map((e) => e.term_id), ...reports.map((r) => r.term_id)].filter((x): x is string => !!x))];
  const { data: termsData } = termIds.length
    ? await supabase.from("terms").select("id, year, term_type").in("id", termIds)
    : { data: [] as { id: string; year: string; term_type: string }[] };
  const termLabel = new Map((termsData ?? []).map((t) => [t.id, `${t.year} ${t.term_type}`]));

  // 담임선생님 이메일 → 이름 표시를 위해 조회합니다.
  const teacherEmails = [...new Set([currentClass?.teacher_email, ...enrollments.map((e) => e.homeroom_teacher_email)].filter((x): x is string => !!x))];
  const { data: teachersData } = teacherEmails.length
    ? await supabase.from("app_users").select("email, name").in("email", teacherEmails)
    : { data: [] as { email: string; name: string | null }[] };
  const teacherName = new Map((teachersData ?? []).map((t) => [t.email, t.name || t.email]));

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/students" className="mb-3 inline-block text-xs text-slate-400 hover:text-slate-600">
        ← 학생 검색으로
      </Link>

      <div className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-800">{student.name}</h1>
            <span className="rounded-full bg-gia-gold-soft/40 px-2 py-0.5 text-[11px] font-semibold text-gia-navy">
              {student.student_no}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {student.grade}학년 {student.class_name}반
            {currentClass?.teacher_email && ` · 담임: ${teacherName.get(currentClass.teacher_email) ?? currentClass.teacher_email}`}
          </p>
        </div>
        <span className={"shrink-0 rounded-full px-2 py-1 text-xs font-semibold " + (student.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>
          {student.status === "active" ? "재적" : "비재적"}
        </span>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">기본 인적사항</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">생년월일</dt><dd>{fmtDate(student.birth_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">학생 연락처</dt><dd>{student.phone || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">보호자 연락처</dt><dd>{student.parent_phone || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">주소</dt><dd className="max-w-[60%] text-right">{student.address || "-"}</dd></div>
            {student.note && <div className="flex justify-between"><dt className="text-slate-400">메모</dt><dd className="max-w-[60%] text-right">{student.note}</dd></div>}
          </dl>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">학적 이력(연도·학기별)</h2>
          {enrollments.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 재학 이력이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5 text-xs">
              {enrollments.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                  <span className="font-medium text-slate-600">{e.term_id ? termLabel.get(e.term_id) ?? "학기 미상" : "학기 미상"}</span>
                  <span className="text-slate-500">
                    {e.grade}학년 {" "}
                    {e.homeroom_teacher_email ? `· 담임 ${teacherName.get(e.homeroom_teacher_email) ?? e.homeroom_teacher_email}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-700">📋 관련 사건기록 ({incidents.length}건)</h2>
        {incidents.length === 0 ? (
          <p className="text-xs text-slate-400">연결된 사건기록이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {incidents.map((it) => (
              <Link key={it.id} href="/records" className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                <span className="shrink-0 text-slate-400">{it.date}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-slate-700">📈 위클리 리포트 이력 ({reports.length}건)</h2>
        {reports.length === 0 ? (
          <p className="text-xs text-slate-400">작성된 위클리 리포트가 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {reports.slice(0, 20).map((r) => (
              <Link key={r.id} href={`/weekly-report/students/${student.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate">
                  [{r.subject}] {r.status === "published" ? "발행됨" : "임시저장"}
                  {r.term_id && termLabel.get(r.term_id) ? ` · ${termLabel.get(r.term_id)}` : ""}
                </span>
                <span className="shrink-0 text-slate-400">{r.report_date}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-sm font-bold text-slate-700">🗂️ 업무/채팅 관련 언급 (참고용)</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          &quot;{searchName}&quot; 이름이 들어간 업무·코멘트·채팅 메시지를 검색한 결과입니다. 자동 연결이 아니라
          텍스트 검색이라 다른 사람 언급이 섞일 수 있습니다 - 참고용으로만 봐주세요.
        </p>
        {tasks.length === 0 && taskComments.length === 0 && messages.length === 0 ? (
          <p className="text-xs text-slate-400">관련 언급이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {tasks.map((t) => (
              <div key={`task-${t.id}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">업무</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
              </div>
            ))}
            {taskComments.map((c) => (
              <div key={`tc-${c.id}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                <span className="shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">코멘트</span>
                <span className="min-w-0 flex-1 truncate">{c.content}</span>
              </div>
            ))}
            {messages.map((m) => (
              <div key={`msg-${m.id}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
                <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">채팅</span>
                <span className="min-w-0 flex-1 truncate">{m.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
