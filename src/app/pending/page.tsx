import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { getLang } from "@/lib/langServer";
import { makeT } from "@/lib/lang";
import { LanguageProvider } from "@/components/common/LanguageProvider";
import LanguageToggle from "@/components/common/LanguageToggle";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }
  const email = (user.email || "").toLowerCase();

  // 개발자거나 이미 승인된 사람이 실수로 이 페이지에 왔다면 바로 홈으로 보냅니다.
  if (isDeveloperEmail(email)) {
    redirect("/home");
  }
  const { data: appUser } = await supabase
    .from("app_users")
    .select("status")
    .eq("email", email)
    .maybeSingle();
  if (appUser?.status === "approved") {
    redirect("/home");
  }

  const isRejected = appUser?.status === "rejected";
  const lang = await getLang();
  const t = makeT(lang);

  return (
    <LanguageProvider initialLang={lang}>
      <main className="gia-navy-panel flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-3 flex justify-end">
            <LanguageToggle variant="plain" />
          </div>
          <div className="rounded-2xl bg-white p-8 text-center shadow-2xl">
            <Image
              src="/logo-login.png"
              alt="GIA Micro Lab"
              width={570}
              height={288}
              priority
              className="mx-auto mb-4 h-20 w-auto"
            />

            {isRejected ? (
              <>
                <h1 className="mb-2 text-lg font-bold text-red-600">{t("접근이 제한되었습니다", "Access is restricted")}</h1>
                <p className="mb-6 text-sm leading-relaxed text-slate-500">
                  {t(
                    `${email} 계정은 관리자에 의해 접근이 제한된 상태입니다. 문의사항이 있다면 관리자에게 직접 연락해주세요.`,
                    `Access for ${email} has been restricted by an administrator. Please contact an administrator directly if you have questions.`
                  )}
                </p>
              </>
            ) : (
              <>
                <h1 className="mb-2 text-lg font-bold">{t("승인 대기 중입니다", "Waiting for approval")}</h1>
                <p className="mb-6 text-sm leading-relaxed text-slate-500">
                  {t(
                    `${email} 계정으로 접근 신청이 접수되었습니다. 관리자가 승인하면 자동으로 이용하실 수 있습니다. 승인 후에는 이 화면을 새로고침하거나 다시 로그인해주세요.`,
                    `Your request for ${email} has been received. Once an administrator approves it you can start using the app. Refresh this page or sign in again after approval.`
                  )}
                </p>
              </>
            )}

            <div className="flex flex-col gap-2">
              <a
                href="/pending"
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                {t("승인 상태 새로고침", "Check approval status again")}
              </a>
              <SignOutButton />
            </div>
          </div>
        </div>
      </main>
    </LanguageProvider>
  );
}
