import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isDeveloperEmail } from "@/lib/roles";
import type { AppUser, WrClass, WrStudent, WrSubject } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";

export const dynamic = "force-dynamic";

// "학교 관리" 카테고리 자체를 눌렀을 때 나오는 한눈에 보기 대시보드입니다. 학기/반/과목/
// 교사·교직원·학생 현황을 요약해서 보여주고, 각 카드에서 해당 관리 화면으로 바로 이동할 수
// 있게 링크를 달아뒀습니다(요청: "학교 관리 탭을 누르면 ... 대시보드가 나와야해").
export default async function SchoolDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const isAdmin = isDeveloperEmail(me.email) || me.position === "관리자";
  const isStaffOrAbove = isAdmin || me.position === "행정직원";
  if (!isStaffOrAbove) redirect("/home");

  const [currentTerm, { data: classesData }, { data: subjectsData }, { data: usersData }, { data: studentsData }] =
    await Promise.all([
      getCurrentTerm(supabase),
      supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
      supabase.from("wr_subjects").select("*").order("name", { ascending: true }),
      supabase.from("app_users").select("*").eq("status", "approved").order("name", { ascending: true }),
      supabase.from("wr_students").select("*").eq("status", "active").order("grade", { ascending: true }).order("name", { ascending: true }),
    ]);

  const classes = (classesData as WrClass[] | null) ?? [];
  const subjects = (subjectsData as WrSubject[] | null) ?? [];
  const users = (usersData as AppUser[] | null) ?? [];
  const students = (studentsData as WrStudent[] | null) ?? [];

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const teachers = users.filter((u) => !isDeveloperEmail(u.email) && u.position === "교사");
  const staff = users.filter((u) => isDeveloperEmail(u.email) || u.position === "관리자" || u.position === "행정직원");

  const termLabel = currentTerm ? `${currentTerm.year} ${currentTerm.term_type}` : "진행중인 학기 없음";

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-lg font-bold">🏛️ 학교 관리 대시보드</h1>
      <p className="mb-4 text-xs text-slate-500">현재 학기·반·과목·교직원·학생 현황을 한눈에 확인합니다.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="현재 학기" value={termLabel} accent="#2563eb" />
        <StatCard label="개설된 반" value={classes.length} sub="개" accent="#7c3aed" />
        <StatCard label="과목" value={subjects.length} sub="개" accent="#7c3aed" />
        <StatCard label="교사" value={teachers.length} sub="명" accent="#0d9488" />
        <StatCard label="교직원" value={staff.length} sub="명" accent="#0d9488" />
        <StatCard label="재학생" value={students.length} sub="명" accent="#1e3a5f" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 개설된 반 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🏫 개설된 반</h2>
            <Link href="/weekly-report/admin/classes" className="text-[11px] font-semibold text-blue-600 hover:underline">
              반 관리 →
            </Link>
          </div>
          {classes.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 반이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {classes.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="font-semibold text-slate-700">
                    {c.grade}학년 {c.class_name}
                  </span>
                  <span className="truncate text-slate-400">
                    담임 {c.teacher_email ? nameByEmail.get(c.teacher_email) ?? c.teacher_email : "미지정"}
                    {c.sub_teacher_email ? ` · 부담임 ${nameByEmail.get(c.sub_teacher_email) ?? c.sub_teacher_email}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 과목 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">📘 과목</h2>
            <Link href="/weekly-report/admin/subjects" className="text-[11px] font-semibold text-blue-600 hover:underline">
              과목반 세팅 →
            </Link>
          </div>
          {subjects.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 과목이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {subjects.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color || "#94a3b8" }} />
                    {s.name}
                  </span>
                  <span className="truncate text-slate-400">
                    {s.teacher_email ? nameByEmail.get(s.teacher_email) ?? s.teacher_email : "담당 교사 미지정"} · 학생 {s.student_ids?.length ?? 0}명
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교사 리스트 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🧑‍🏫 교사 리스트</h2>
            {isAdmin && (
              <Link href="/admin/users" className="text-[11px] font-semibold text-blue-600 hover:underline">
                사용자 관리 →
              </Link>
            )}
          </div>
          {teachers.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 교사가 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {teachers.map((t) => (
                <li key={t.email} className="rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                  {t.name || t.email}
                  {t.department && <span className="ml-1 text-teal-400">({t.department})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교직원 리스트 */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🗂️ 교직원 리스트</h2>
            {isAdmin && (
              <Link href="/admin/users" className="text-[11px] font-semibold text-blue-600 hover:underline">
                사용자 관리 →
              </Link>
            )}
          </div>
          {staff.length === 0 ? (
            <p className="text-xs text-slate-400">등록된 교직원이 없습니다.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {staff.map((u) => (
                <li key={u.email} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  {u.name || u.email}
                  <span className="ml-1 text-slate-400">
                    ({isDeveloperEmail(u.email) ? "개발자" : u.position})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 학생 리스트 (요약) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🎓 학생 리스트 ({students.length}명)</h2>
            <Link href="/students" className="text-[11px] font-semibold text-blue-600 hover:underline">
              학생 정보 조회 →
            </Link>
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-slate-400">재학 중인 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {students.slice(0, 24).map((s) => (
                <div key={s.id} className="truncate text-xs text-slate-600">
                  <span className="font-medium">{s.name}</span>
                  <span className="ml-1 text-slate-400">
                    {s.grade}학년 {s.class_name}
                  </span>
                </div>
              ))}
              {students.length > 24 && (
                <div className="text-xs font-semibold text-blue-600">+{students.length - 24}명 더보기 →</div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
