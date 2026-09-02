import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess, isStaffOrAboveUser } from "@/lib/roles";
import DismissalPlanEditor from "@/components/students/DismissalPlanEditor";
import type { DismissalPlan } from "@/lib/dismissalPlan";
import { won } from "@/lib/feeItems";
import type { Invoice } from "@/lib/types";
import type { Incident, Task, TaskComment, ChatMessage, WrClass, WrEnrollment, WrReport, WrStudent, WrStudentFieldDef } from "@/lib/types";

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
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  if (!isStaffOrAboveUser(me)) {
    redirect("/home");
  }

  const { data: studentData } = await supabase.from("wr_students").select("*").eq("id", id).maybeSingle();
  const student = studentData as WrStudent | null;
  if (!student) notFound();

  const searchName = coreName(student.name);

  // 인보이스는 **재무 열쇠를 가진 사람에게만** 보입니다. 담임 선생님이 학생 프로필을 여는 것과
  // 아이 집의 납부 상태를 보는 것은 다른 일입니다.
  const canSeeFinance = hasFinanceAccess(me);
  const invRes = canSeeFinance
    ? await supabase.from("invoices").select("*").eq("student_id", id).order("issue_date", { ascending: false })
    : null;
  if (invRes?.error) console.error("[학생 프로필] 인보이스를 읽지 못했습니다:", invRes.error.message);
  const invoices = (invRes?.data as Invoice[] | null) ?? [];
  const payRes =
    canSeeFinance && invoices.length > 0
      ? await supabase.from("payments").select("invoice_id, amount").in("invoice_id", invoices.map((v) => v.id))
      : null;
  if (payRes?.error) console.error("[학생 프로필] 수납을 읽지 못했습니다:", payRes.error.message);
  const paidByInvoice = new Map<string, number>();
  for (const p of (payRes?.data as { invoice_id: string | null; amount: number }[] | null) ?? []) {
    if (p.invoice_id) paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + Number(p.amount));
  }

  const [
    enrollmentsRes,
    reportsRes,
    incidentLinksRes,
    incidentTextRes,
    tasksRes,
    taskCommentsRes,
    messagesRes,
    currentClassRes,
    fieldDefsRes,
  ] = await Promise.all([
    supabase.from("wr_enrollments").select("*").eq("student_id", id).order("created_at", { ascending: false }),
    supabase.from("wr_reports").select("*").eq("student_id", id).order("report_date", { ascending: false }),
    supabase.from("incident_students").select("incident_id").eq("student_id", id),
    // 사건 입력화면의 "관련 학생(정확히 연결)" 선택은 선택사항이라(안 눌러도 저장됨), 그것만 믿으면
    // 자유 텍스트 "관련 학생 이름" 칸에만 이름이 적힌 과거/현재 사건이 전부 빠집니다(요청 확인:
    // "백서아 사건기록에 올라와있음에도 0으로 나와"). 텍스트 칸도 함께 검색해 합칩니다.
    supabase.from("incidents").select("*").ilike("students", `%${searchName}%`).order("date", { ascending: false }),
    supabase
      .from("tasks")
      .select("*")
      .or(`title.ilike.%${searchName}%,description.ilike.%${searchName}%`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("task_comments").select("*").ilike("content", `%${searchName}%`).order("created_at", { ascending: false }).limit(20),
    supabase.from("messages").select("*").ilike("content", `%${searchName}%`).order("created_at", { ascending: false }).limit(20),
    student.class_id ? supabase.from("wr_classes").select("*").eq("id", student.class_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("wr_student_field_defs").select("*").order("sort_order", { ascending: true }),
  ]);
  const fieldDefs = (fieldDefsRes.data as WrStudentFieldDef[] | null) ?? [];

  // 요일별 하원수단(학원 버스·보호자 픽업·도보 등). 셔틀과 별개의 표입니다 - 셔틀을 안 타는
  // 날은 셔틀 배정 자체가 없어서 적을 자리가 없었습니다.
  const { data: dpData } = await supabase
    .from("student_dismissal_plans")
    .select("id, student_id, weekday, kind, label, depart_time, note, updated_by, updated_at")
    .eq("student_id", id)
    .order("weekday");
  const dismissalPlans = (dpData as DismissalPlan[] | null) ?? [];

  // 이 아이가 어느 셔틀을 타는지.
  //
  // 지금까지 학생 프로필에는 셔틀이 아예 없었습니다. 학부모 전화를 받으면 학생 조회 → 셔틀 →
  // 노선·배정으로 세 번 옮겨 다녀야 "몇 호차 타는 아이인지"를 알 수 있었습니다. 이제 학생과
  // 배정이 student_id로 이어져 있으니(하원 명단 재등록 때 정리했습니다) 바로 읽어옵니다.
  const { data: asgData } = await supabase
    .from("shuttle_assignments")
    .select("id, weekdays, note, unlinked_reason, stop_id, shuttle_stops(seq, gate, address, route_id, shuttle_routes(route_no, name, direction, term, driver_name, driver_phone))")
    .eq("student_id", id);

  type StopJoin = {
    seq: number | null;
    gate: string | null;
    address: string | null;
    route_id: string;
    shuttle_routes: { route_no: string; name: string | null; direction: string; term: string; driver_name: string | null; driver_phone: string | null } | null;
  };
  const WD = ["", "월", "화", "수", "목", "금"];
  const shuttleRows = ((asgData as unknown as { id: string; weekdays: number[] | null; note: string | null; stop_id: string; shuttle_stops: StopJoin | null }[] | null) ?? [])
    .map((a) => {
      const s = a.shuttle_stops;
      const r = s?.shuttle_routes ?? null;
      const days = (a.weekdays ?? []).filter((d) => d >= 1 && d <= 5);
      return {
        id: a.id,
        routeId: s?.route_id ?? null,
        routeNo: r?.route_no ?? "?",
        routeName: r?.name ?? null,
        direction: r?.direction ?? "",
        term: r?.term ?? "",
        driver: r?.driver_name ?? null,
        driverPhone: r?.driver_phone ?? null,
        // 매일 타면 요일을 안 적습니다 - 다 적으면 예외인 아이가 안 보입니다.
        daysLabel: days.length === 5 || days.length === 0 ? "" : days.map((d) => WD[d]).join(""),
        stop: s?.gate || s?.address || null,
        note: a.note,
      };
    })
    .filter((x) => x.term === "정규학기")
    .sort((a, b) => a.direction.localeCompare(b.direction, "ko") || a.routeNo.localeCompare(b.routeNo, "ko", { numeric: true }));

  const enrollments = (enrollmentsRes.data as WrEnrollment[] | null) ?? [];
  const reports = (reportsRes.data as WrReport[] | null) ?? [];
  const incidentIds = ((incidentLinksRes.data as { incident_id: string }[] | null) ?? []).map((r) => r.incident_id);
  const tasks = (tasksRes.data as Task[] | null) ?? [];
  const taskComments = (taskCommentsRes.data as TaskComment[] | null) ?? [];
  const messages = (messagesRes.data as ChatMessage[] | null) ?? [];
  const currentClass = currentClassRes.data as WrClass | null;

  const { data: incidentsById } = incidentIds.length
    ? await supabase.from("incidents").select("*").in("id", incidentIds).order("date", { ascending: false })
    : { data: [] as Incident[] };
  // 구조적 연결(incident_students) + 텍스트 언급을 id 기준으로 합쳐 중복 없이 최신순으로 보여줍니다.
  const incidentMap = new Map<string, Incident>();
  for (const it of [...((incidentsById as Incident[] | null) ?? []), ...((incidentTextRes.data as Incident[] | null) ?? [])]) {
    incidentMap.set(it.id, it);
  }
  const incidents = [...incidentMap.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

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

  // 요청: "학생 검색했을 때 종합 정보가 한 페이지로 나오도록" - 이미 학적사항/사건기록/주간
  // 관찰기록이 한 페이지 안에 있었지만(레이아웃/가독성 개선 요청), 페이지가 길어질 때 지금 어느
  // 섹션을 보고 있는지 놓치기 쉬워 상단에 요약 수치 + 바로가기 탭을 추가하고, 목록이 길어지는
  // 사건/리포트 섹션은 안쪽 스크롤로 감싸 한 화면 안에서 전체 구조가 잡히도록 했습니다.
  const quickNav = [
    { href: "#academic", label: "학적사항" },
    { href: "#incidents", label: "관련 사건기록" },
    { href: "#reports", label: "주간 관찰기록" },
    { href: "#mentions", label: "업무/채팅 언급" },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/students" className="mb-3 inline-block text-xs text-slate-400 hover:text-slate-600">
        ← 학생 검색으로
      </Link>

      <div className="mb-3 flex items-start justify-between gap-3 g-panel-solid p-5 shadow-sm">
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

      {/* 요약 수치 + 바로가기 - 페이지가 길어져도 지금 무엇이 몇 건 있는지 한눈에 보이고, 원하는
          섹션으로 바로 이동할 수 있습니다. */}
      <div className="sticky top-0 z-10 mb-5 flex flex-wrap items-center gap-1.5 g-panel-solid/95 p-2.5 shadow-sm backdrop-blur">
        {quickNav.map((n) => (
          <a
            key={n.href}
            href={n.href}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          >
            {n.label}
          </a>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          학적 이력 {enrollments.length}건
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          사건기록 {incidents.length}건
        </span>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500">
          관찰기록 {reports.length}건
        </span>
      </div>

      {/* 하원수단 - 요일마다 다른 차를 타는 아이가 있습니다(백서아: 월 셔틀, 화·목 메타프랩,
          수·금 블루웨일). 셔틀 배정은 셔틀을 타는 날만 적을 수 있어서, 안 타는 날 이 아이가
          어떻게 가는지는 어디에도 없었습니다. 담임 선생님이 아이를 어디로 내보낼지 알아야
          하므로 **아이를 기준으로** 여기 둡니다. */}
      <DismissalPlanEditor
        studentId={student.id}
        studentName={student.name}
        initialPlans={dismissalPlans}
        userEmail={me.email}
      />

      {/* 재무 - 학부모가 "그 청구서 냈는데요" 하고 전화하면 여기서 바로 답이 나와야 합니다.
          재무 화면으로 건너가 이름을 다시 찾게 두면 통화 중에 못 합니다. */}
      {canSeeFinance && (
        <div className="mb-5 g-panel-solid p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-bold text-slate-700">💳 학비외 청구</h2>
            <a href="/finance/invoices" className="text-[11px] font-semibold text-teal-700 underline">
              인보이스 명단 →
            </a>
          </div>
          {invoices.length === 0 ? (
            <p className="text-xs text-slate-400">발행된 청구서가 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {invoices.map((v) => {
                const paid = paidByInvoice.get(v.id) ?? 0;
                const balance = Number(v.total_amount) - paid;
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
                    <a href={`/finance/invoices/${v.id}/print`} target="_blank" rel="noopener noreferrer" className="font-bold text-emerald-700 underline">
                      {v.invoice_no}
                    </a>
                    <span className="text-slate-400">{v.issue_date}</span>
                    <span className="font-bold tabular-nums text-slate-700">{won(Number(v.total_amount))}</span>
                    {v.status === "취소" ? (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">취소</span>
                    ) : balance <= 0 ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">완납</span>
                    ) : paid > 0 ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        일부 납부 · 잔액 {won(balance)}
                      </span>
                    ) : (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800">미납</span>
                    )}
                    {v.exported_at ? (
                      <span className="text-[10px] text-slate-400">올톡페이 발송함</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-amber-600">아직 발송 안 함</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 셔틀 - 학부모 전화를 받으면 가장 먼저 확인하는 것 중 하나인데, 여기 없어서 셔틀
          메뉴까지 옮겨 다녀야 했습니다. 요일별로 다른 차를 타는 아이가 12명 있어서
          "몇 호차"만으로는 답이 안 되고, 무슨 요일에 타는지가 같이 보여야 합니다. */}
      {shuttleRows.length > 0 && (
        <div className="mb-5 g-panel-solid p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">🚌 셔틀</h2>
          <div className="flex flex-col gap-1.5">
            {shuttleRows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
                <span className={"rounded px-1.5 py-0.5 font-bold " + (r.direction === "하원" ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700")}>
                  {r.direction}
                </span>
                <span className="font-bold text-slate-800">{r.routeNo}호</span>
                {r.routeName && <span className="text-slate-500">{r.routeName}</span>}
                {r.daysLabel && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-700">{r.daysLabel}</span>
                )}
                {r.stop && <span className="text-slate-500">📍 {r.stop}</span>}
                {r.note && <span className="text-amber-600">{r.note}</span>}
                {r.driver && (
                  <span className="text-slate-400">
                    {r.driver} 기사님{r.driverPhone ? ` · ${r.driverPhone}` : ""}
                  </span>
                )}
                <Link href="/shuttle" className="ml-auto shrink-0 text-blue-500 hover:underline">
                  노선 보기 ↗
                </Link>
              </div>
            ))}
          </div>
          {/* 요일이 안 적힌 줄은 매일 타는 아이입니다. 다 적으면 예외인 아이가 안 보입니다. */}
          <p className="mt-1.5 text-[11px] text-slate-400">요일 표시가 없으면 매일 탑니다.</p>
        </div>
      )}

      <div id="academic" className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 scroll-mt-16">
        <div className="g-panel-solid p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-slate-700">기본 인적사항</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">성별</dt><dd>{student.gender || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">생년월일</dt><dd>{fmtDate(student.birth_date)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">학생 연락처</dt><dd>{student.phone || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">보호자 연락처</dt><dd>{student.parent_phone || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">보호자 이메일</dt><dd>{student.parent_email || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">주소</dt><dd className="max-w-[60%] text-right">{student.address || "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">알러지</dt><dd className="max-w-[60%] text-right">{student.allergies || "-"}</dd></div>
            {student.note && <div className="flex justify-between"><dt className="text-slate-400">메모</dt><dd className="max-w-[60%] text-right">{student.note}</dd></div>}
            {fieldDefs.map((f) =>
              student.custom_fields?.[f.field_key] ? (
                <div key={f.id} className="flex justify-between">
                  <dt className="text-slate-400">{f.label}</dt>
                  <dd className="max-w-[60%] text-right">{student.custom_fields[f.field_key]}</dd>
                </div>
              ) : null
            )}
          </dl>
        </div>

        <div className="g-panel-solid p-4 shadow-sm">
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

      <div id="incidents" className="mb-5 g-panel-solid p-4 shadow-sm scroll-mt-16">
        <h2 className="mb-2 text-sm font-bold text-slate-700">📋 관련 사건기록 ({incidents.length}건)</h2>
        {incidents.length === 0 ? (
          <p className="text-xs text-slate-400">연결된 사건기록이 없습니다.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
            {incidents.map((it) => (
              <Link key={it.id} href="/records" className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-slate-50">
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                <span className="shrink-0 text-slate-400">{it.date}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div id="reports" className="mb-5 g-panel-solid p-4 shadow-sm scroll-mt-16">
        <h2 className="mb-2 text-sm font-bold text-slate-700">📈 주간 학생 관찰기록 이력 ({reports.length}건)</h2>
        {reports.length === 0 ? (
          <p className="text-xs text-slate-400">작성된 주간 학생 관찰기록이 없습니다.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
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

      <div id="mentions" className="g-panel-solid p-4 shadow-sm scroll-mt-16">
        <h2 className="mb-1 text-sm font-bold text-slate-700">🗂️ 업무/채팅 관련 언급 (참고용)</h2>
        <p className="mb-2 text-[11px] text-slate-400">
          &quot;{searchName}&quot; 이름이 들어간 업무·코멘트·채팅 메시지를 검색한 결과입니다. 자동 연결이 아니라
          텍스트 검색이라 다른 사람 언급이 섞일 수 있습니다 - 참고용으로만 봐주세요.
        </p>
        {tasks.length === 0 && taskComments.length === 0 && messages.length === 0 ? (
          <p className="text-xs text-slate-400">관련 언급이 없습니다.</p>
        ) : (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
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
