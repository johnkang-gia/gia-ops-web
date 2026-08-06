import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { Incident, WrClass, WrEnrollment, WrReport, WrStudent } from "@/lib/types";

export const dynamic = "force-dynamic";

// 학생 이름의 영문 표기(괄호 안)를 뗀 한글(또는 원문) 이름만 남깁니다 - /students/[id] 페이지와
// 동일한 규칙입니다.
function coreName(fullName: string) {
  return fullName.split("(")[0].trim();
}

// /students/[id] 페이지가 하던 학생 프로필 집계 조회를 JSON API로도 쓸 수 있게 뺐습니다.
// 실무자매뉴얼 화면에서 전화 응대 중 학생을 검색하면, 페이지 이동 없이 바로 이 API를 불러서
// 매뉴얼과 학생 기록을 한 화면에서 동시에 볼 수 있게 하기 위한 용도입니다.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const email = (user.email ?? "").toLowerCase();
  if (!isDeveloperEmail(email)) {
    const { data: me } = await supabase.from("app_users").select("position").eq("email", email).maybeSingle();
    if (me?.position !== "관리자" && me?.position !== "행정직원") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
  }

  const { data: studentData } = await supabase.from("wr_students").select("*").eq("id", id).maybeSingle();
  const student = studentData as WrStudent | null;
  if (!student) return NextResponse.json({ error: "학생을 찾을 수 없습니다." }, { status: 404 });

  const searchName = coreName(student.name);

  const [enrollmentsRes, reportsRes, incidentLinksRes, incidentTextRes, currentClassRes] = await Promise.all([
    supabase.from("wr_enrollments").select("*").eq("student_id", id).order("created_at", { ascending: false }),
    supabase.from("wr_reports").select("*").eq("student_id", id).order("report_date", { ascending: false }),
    supabase.from("incident_students").select("incident_id").eq("student_id", id),
    // /students/[id] 페이지와 동일하게, 구조적 연결(incident_students)만 보면 "관련 학생" 자유
    // 텍스트 칸에만 이름이 적힌 사건이 빠지므로 텍스트도 함께 검색해 합칩니다.
    supabase.from("incidents").select("*").ilike("students", `%${searchName}%`).order("date", { ascending: false }),
    student.class_id ? supabase.from("wr_classes").select("*").eq("id", student.class_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const enrollments = (enrollmentsRes.data as WrEnrollment[] | null) ?? [];
  const reports = (reportsRes.data as WrReport[] | null) ?? [];
  const incidentIds = ((incidentLinksRes.data as { incident_id: string }[] | null) ?? []).map((r) => r.incident_id);
  const currentClass = currentClassRes.data as WrClass | null;

  const { data: incidentsById } = incidentIds.length
    ? await supabase.from("incidents").select("*").in("id", incidentIds).order("date", { ascending: false })
    : { data: [] as Incident[] };
  const incidentMap = new Map<string, Incident>();
  for (const it of [...((incidentsById as Incident[] | null) ?? []), ...((incidentTextRes.data as Incident[] | null) ?? [])]) {
    incidentMap.set(it.id, it);
  }
  const incidents = [...incidentMap.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const termIds = [...new Set([...enrollments.map((e) => e.term_id), ...reports.map((r) => r.term_id)].filter((x): x is string => !!x))];
  const { data: termsData } = termIds.length
    ? await supabase.from("terms").select("id, year, term_type").in("id", termIds)
    : { data: [] as { id: string; year: string; term_type: string }[] };
  const termLabelMap = Object.fromEntries((termsData ?? []).map((t) => [t.id, `${t.year} ${t.term_type}`]));

  const teacherEmails = [...new Set([currentClass?.teacher_email, ...enrollments.map((e) => e.homeroom_teacher_email)].filter((x): x is string => !!x))];
  const { data: teachersData } = teacherEmails.length
    ? await supabase.from("app_users").select("email, name").in("email", teacherEmails)
    : { data: [] as { email: string; name: string | null }[] };
  const teacherNameMap = Object.fromEntries((teachersData ?? []).map((t) => [t.email, t.name || t.email]));

  return NextResponse.json({
    student,
    currentClass,
    enrollments,
    reports,
    incidents,
    termLabelMap,
    teacherNameMap,
    searchName,
  });
}
