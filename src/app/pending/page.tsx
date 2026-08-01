import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
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

  return (
    <main className="gia-navy-panel flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-login.png" alt="GIA Micro Lab" className="mx-auto mb-4 h-20 w-auto" />

        {isRejected ? (
          <>
            <h1 className="mb-2 text-lg font-bold text-red-600">접근이 제한되었습니다</h1>
            <p className="mb-6 text-sm text-slate-500">
              {email} 계정은 관리자에 의해 접근이 제한된 상태입니다. 문의사항이 있다면 관리자에게
              직접 연락해주세요.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-lg font-bold">승인 대기 중입니다</h1>
            <p className="mb-6 text-sm text-slate-500">
              {email} 계정으로 접근 신청이 접수되었습니다. 관리자가 승인하면 자동으로 이용하실 수
              있습니다. 승인 후에는 이 화면을 새로고침하거나 다시 로그인해주세요.
            </p>
          </>
        )}

        <div className="flex flex-col gap-2">
          <a
            href="/pending"
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            승인 상태 새로고침
          </a>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
