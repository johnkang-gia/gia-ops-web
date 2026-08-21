import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { getLang } from "@/lib/langServer";
import { makeT } from "@/lib/lang";
import { LanguageProvider } from "@/components/common/LanguageProvider";
import LanguageToggle from "@/components/common/LanguageToggle";
import OnboardingForm, { type OpenClass, type OpenSubject } from "@/components/onboarding/OnboardingForm";

export const dynamic = "force-dynamic";

// 가입 첫 화면입니다. 원어민 교사도 직접 가입하기 때문에 한국어/영어로 완전히 전환됩니다
// (요청: "가입할때 교사도 가입해야하니까 가입하는것도 영어병기 해주고").
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  const email = (user.email || "").toLowerCase();

  if (isDeveloperEmail(email)) {
    redirect("/home");
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("name, department, position")
    .eq("email", email)
    .maybeSingle();

  // 담임이 아직 비어 있는 반 / 담당 교사가 없는 과목만 보여줍니다(요청: "교사가 가입을 할 때,
  // 반이나 과목을 선택할 수있게"). 이미 배정된 곳은 목록에 없으니 남의 반을 고를 수 없습니다.
  // 데모 계정용 가짜 반은 제외합니다.
  const [{ data: classRows }, { data: subjectRows }] = await Promise.all([
    supabase
      .from("wr_classes")
      .select("id, grade, class_name, teacher_name, is_demo")
      .is("teacher_email", null)
      .order("grade")
      .order("class_name"),
    supabase.from("wr_subjects").select("id, name, teacher_name").is("teacher_email", null).order("name"),
  ]);
  const openClasses: OpenClass[] = ((classRows as { id: string; grade: string | null; class_name: string | null; teacher_name: string | null; is_demo: boolean | null }[] | null) ?? [])
    .filter((c) => !c.is_demo)
    .map((c) => ({ id: c.id, grade: c.grade, className: c.class_name, teacherName: c.teacher_name }));
  const openSubjects: OpenSubject[] = ((subjectRows as { id: string; name: string; teacher_name: string | null }[] | null) ?? [])
    .map((s) => ({ id: s.id, name: s.name, teacherName: s.teacher_name }));

  // 이미 이름을 입력했다면(온보딩 완료) 다시 올 필요가 없습니다 - 승인 대기 중이면 /pending으로,
  // 승인됐다면 /home으로 미들웨어가 알아서 보내줍니다.
  if (appUser?.name) {
    redirect("/pending");
  }

  const lang = await getLang();
  const t = makeT(lang);

  return (
    <LanguageProvider initialLang={lang}>
      <main className="gia-navy-panel flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-3 flex justify-end">
            <LanguageToggle variant="plain" />
          </div>
          <div className="rounded-2xl bg-white p-8 shadow-2xl">
            <Image
              src="/logo-login.png"
              alt="GIA Micro Lab"
              width={570}
              height={288}
              priority
              className="mx-auto mb-4 h-20 w-auto"
            />
            <h1 className="mb-1 text-center text-lg font-bold">{t("처음 오셨네요", "Welcome to GIA")}</h1>
            <p className="mb-6 text-center text-sm leading-relaxed text-slate-500">
              {t(
                `${email} 계정으로 이용하기 전에, 이름과 소속·직위를 알려주세요. 입력한 정보는 관리자가 승인 여부를 판단할 때 확인하고, 이후 시스템 곳곳에서 이메일 대신 이름으로 표시됩니다.`,
                `Before you start using ${email}, please tell us your name, department and role. An administrator reviews this when approving your account, and your name is shown throughout the app instead of your email address.`
              )}
            </p>
            <OnboardingForm
              initialDepartment={appUser?.department ?? null}
              initialPosition={appUser?.position ?? null}
              openClasses={openClasses}
              openSubjects={openSubjects}
            />
          </div>
        </div>
      </main>
    </LanguageProvider>
  );
}
