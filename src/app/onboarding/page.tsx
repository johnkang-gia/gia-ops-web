import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import OnboardingForm from "@/components/onboarding/OnboardingForm";

export const dynamic = "force-dynamic";

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

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-login.png" alt="GIA Micro Lab" className="mx-auto mb-4 h-20 w-auto" />
        <h1 className="mb-1 text-center text-lg font-bold">처음 오셨네요</h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          {email} 계정으로 이용하기 전에, 이름과 소속·직위를 알려주세요. 입력한 정보는 관리자가
          승인 여부를 판단할 때 확인하고, 이후 시스템 곳곳(업무 보드, 채팅 멘션 등)에서 이메일
          대신 이름으로 표시됩니다.
        </p>
        <OnboardingForm
          initialDepartment={appUser?.department ?? null}
          initialPosition={appUser?.position ?? null}
        />
      </div>
    </main>
  );
}
