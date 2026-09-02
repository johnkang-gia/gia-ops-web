import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { isDeveloperEmail, isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import type { AppUser, WrClass, WrStudent, WrSubject } from "@/lib/types";
import StatCard from "@/components/admin/StatCard";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🏛️ 학교 관리 대시보드란?",
    lines: [
      "현재 학기·개설된 반·과목·교사·교직원·재학생 현황을 한 화면에서 요약해서 보여줍니다.",
      "각 카드/목록의 '→' 링크를 누르면 해당 관리 화면(반 관리, 과목반 세팅, 사용자 관리, 학생 정보 조회)으로 바로 이동합니다.",
    ],
  },
  {
    title: "📥 구글시트로 가져오기",
    lines: ["관리자는 우상단 버튼으로 기존에 쓰던 구글시트의 학생/반 명단을 한 번에 불러와 초기 세팅을 빠르게 할 수 있습니다."],
  },
  {
    title: "📊 운영 분석은 어디서 보나요?",
    lines: [
      "반복 사건 유형, 학생 랭킹, 월별 추이, 부서별 완료율 같은 관리자 전용 운영 분석은 별도의 \"관리자 통합 대시보드\"(관리자 메뉴)에서 확인할 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

// "학교 관리" 카테고리 자체를 눌렀을 때 나오는 한눈에 보기 대시보드입니다. 반/과목/교직원/학생
// 현황(로스터) 요약에 집중하고, 관리자 전용 운영 분석(반복 사건·학생 랭킹·월별 추이·부서별
// 완료율)은 별도의 "관리자 통합 대시보드"(/admin/dashboard)로 분리했습니다(요청: "관리자 통합
// 대시보드가 없어졌어, 관리자 페이지에서 관리자만 볼 수 있게 해주고" - 한때 이 화면 하나로
// 합쳤었는데, 분석 내용이 로스터 화면 맨 아래에 묻혀 찾기 어렵다는 문제가 있었습니다). 행정직원은
// 로스터 정보까지만 보고, 관리자는 상단 카드의 링크로 통합 대시보드로 바로 넘어갈 수 있습니다.
export default async function SchoolDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const isAdmin = isAdminUser(me);
  const isStaffOrAbove = isStaffOrAboveUser(me);
  if (!isStaffOrAbove) redirect("/home");

  const [currentTerm, { data: classesData }, { data: subjectsData }, { data: usersData }, { data: studentsData }] =
    await Promise.all([
      getCurrentTerm(),
      supabase.from("wr_classes").select("*").order("grade", { ascending: true }).order("class_name", { ascending: true }),
      supabase.from("wr_subjects").select("*").order("name", { ascending: true }),
      supabase.from("app_users").select("*").eq("status", "approved").order("name", { ascending: true }),
      supabase.from("wr_students").select("*").eq("is_demo", false).eq("status", "active").order("grade", { ascending: true }).order("name", { ascending: true }),
    ]);

  const classes = (classesData as WrClass[] | null) ?? [];
  const subjects = (subjectsData as WrSubject[] | null) ?? [];
  const users = (usersData as AppUser[] | null) ?? [];
  const students = (studentsData as WrStudent[] | null) ?? [];

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const teachers = users.filter((u) => !isDeveloperEmail(u.email) && u.position === "교사");
  // 개발자 계정은 다른 관리자들에게 존재 자체가 드러나지 않도록 교직원 리스트/카운트에서도
  // 완전히 제외합니다.
  const staff = users.filter(
    (u) => !isDeveloperEmail(u.email) && (u.position === "관리자" || u.position === "행정직원")
  );

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🏛️ 학교 관리 대시보드</h1>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && (
            <Link
              href="/admin/dashboard"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              📊 관리자 통합 대시보드 →
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/school/import"
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              📥 구글시트로 가져오기
            </Link>
          )}
          <GuideButton title="학교 관리 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-500">현재 학기·반·과목·교직원·학생 현황을 한눈에 확인합니다.</p>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* 연도는 항상 나오니 작게 위에, 학기(여름캠프 등)는 줄바꿈해서 가운데에 크게 보여줍니다. */}
        <div className="flex flex-col items-center justify-center g-panel-solid p-4 text-center shadow-sm">
          {currentTerm ? (
            <>
              <div className="text-[11px] font-semibold text-slate-400">{currentTerm.year}</div>
              <div className="mt-1 break-keep text-lg font-bold leading-tight text-blue-600">{currentTerm.term_type}</div>
            </>
          ) : (
            <div className="text-sm font-semibold text-slate-300">진행중인 학기 없음</div>
          )}
        </div>
        <StatCard label="개설된 반" value={classes.length} sub="개" accent="#7c3aed" />
        <StatCard label="과목" value={subjects.length} sub="개" accent="#7c3aed" />
        <StatCard label="교사" value={teachers.length} sub="명" accent="#0d9488" />
        <StatCard label="교직원" value={staff.length} sub="명" accent="#0d9488" />
        <StatCard label="재학생" value={students.length} sub="명" accent="#1e3a5f" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 개설된 반 */}
        <section className="g-panel-solid p-4 shadow-sm">
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
                <li key={c.id} className="py-1.5">
                  <div className="text-xs font-semibold text-slate-700">
                    {c.grade}학년 {c.class_name}
                  </div>
                  <div className="mt-0.5 break-keep text-[11px] leading-snug text-slate-400">
                    담임 {c.teacher_email ? nameByEmail.get(c.teacher_email) ?? c.teacher_email : "미지정"}
                    {c.sub_teacher_email ? ` · 부담임 ${nameByEmail.get(c.sub_teacher_email) ?? c.sub_teacher_email}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 과목 */}
        <section className="g-panel-solid p-4 shadow-sm">
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
                <li key={s.id} className="py-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color || "#94a3b8" }} />
                    <span className="break-keep">{s.name}</span>
                  </div>
                  <div className="mt-0.5 break-keep text-[11px] leading-snug text-slate-400">
                    {s.teacher_email ? nameByEmail.get(s.teacher_email) ?? s.teacher_email : "담당 교사 미지정"} · 학생 {s.student_ids?.length ?? 0}명
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교사 리스트 */}
        <section className="g-panel-solid p-4 shadow-sm">
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
                <li
                  key={t.email}
                  className="max-w-full truncate rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700"
                >
                  {t.name || t.email}
                  {t.department && <span className="ml-1 text-teal-400">({t.department})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 교직원 리스트 */}
        <section className="g-panel-solid p-4 shadow-sm">
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
                <li
                  key={u.email}
                  className="max-w-full truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                >
                  {u.name || u.email}
                  <span className="ml-1 text-slate-400">({u.position})</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 학생 리스트 (요약) */}
        <section className="g-panel-solid p-4 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700">🎓 학생 리스트 ({students.length}명)</h2>
            <Link href="/students" className="text-[11px] font-semibold text-blue-600 hover:underline">
              학생 정보 조회 →
            </Link>
          </div>
          {students.length === 0 ? (
            <p className="text-xs text-slate-400">재학 중인 학생이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
              {students.slice(0, 24).map((s) => (
                <div key={s.id} className="min-w-0">
                  <div className="truncate text-xs font-medium leading-tight text-slate-700">{s.name}</div>
                  {s.name_en && (
                    <div className="truncate text-[11px] font-normal leading-tight text-slate-400">{s.name_en}</div>
                  )}
                  <div className="truncate text-[11px] leading-tight text-slate-400">
                    {s.grade}학년 {s.class_name}
                  </div>
                </div>
              ))}
              {students.length > 24 && (
                <div className="flex items-center text-xs font-semibold text-blue-600">+{students.length - 24}명 더보기 →</div>
              )}
            </div>
          )}
        </section>
      </div>

      {isAdmin && (
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-amber-800">📊 반복 사건·학생 랭킹·월별 추이·부서별 완료율 같은 운영 분석은?</h2>
              <p className="mt-1 text-xs text-amber-700">별도의 관리자 통합 대시보드에서 확인할 수 있습니다.</p>
            </div>
            <Link
              href="/admin/dashboard"
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              통합 대시보드 열기 →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
