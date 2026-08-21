import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { getLang } from "@/lib/langServer";
import { makeT } from "@/lib/lang";
import { LanguageProvider } from "@/components/common/LanguageProvider";
import LanguageToggle from "@/components/common/LanguageToggle";
import OnboardingForm from "@/components/onboarding/OnboardingForm";

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
            />
          </div>
        </div>
      </main>
    </LanguageProvider>
  );
}
