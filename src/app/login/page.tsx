"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const domainError = searchParams.get("error") === "domain";

  async function handleGoogleLogin() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // hd 파라미터는 구글 계정 선택 화면에서 해당 도메인 계정을 우선 보여주는 힌트일 뿐,
        // 실제 접근 제한은 middleware.ts + Supabase RLS에서 이메일 도메인으로 다시 검사합니다.
        queryParams: { hd: "giamicro.com", prompt: "select_account" },
      },
    });
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
      <h1 className="text-xl font-bold mb-1">GIA 운영</h1>
      <p className="text-sm text-slate-500 mb-6">
        giamicro.com 회사 구글 계정으로 로그인하세요.
      </p>

      {domainError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          giamicro.com 계정으로만 접속할 수 있습니다. 다른 계정으로 로그인되어
          자동으로 로그아웃되었습니다.
        </p>
      )}

      <button
        onClick={handleGoogleLogin}
        disabled={loading}
        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {loading ? "이동 중..." : "Google 계정으로 로그인"}
      </button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
