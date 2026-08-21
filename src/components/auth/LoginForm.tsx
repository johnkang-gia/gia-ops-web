"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/components/common/LanguageProvider";
import { SHARED_ACCOUNT_DOMAIN, toSharedAccountEmail } from "@/lib/sharedAccounts";

// 로그인 방법이 두 가지입니다.
//
// 1) 회사 구글 계정 - 교직원 개인 계정. 평소 쓰는 방법이고 기본으로 크게 보여줍니다.
// 2) 아이디 + 비밀번호 - 여러 사람이 돌아가며 쓰는 공용 계정 전용입니다(요청: "로그인할때,
//    아이디랑 비번 넣고 들어갈 수 있도록 만들어서, 도서관이랑, 오리엔테이션용 가계정을 만들어서
//    관리하게 해줘"). 도서관 대출 노트북이나 신입교사 교육용 계정은 특정 개인의 것이 아니라
//    구글 계정을 만들어 나눠 쓰기 곤란하고, 개인 계정을 빌려주면 그 사람 권한이 통째로 열립니다.
//
// 공용 계정 입구는 접어둡니다. 대부분의 교직원에게는 필요 없는 선택지라서, 매번 보이면
// "나는 어느 쪽으로 들어가야 하지?" 하고 한 번 더 고민하게 됩니다.

export default function LoginForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const domainError = searchParams.get("error") === "domain";
  const libraryError = searchParams.get("error") === "library";

  const [googleLoading, setGoogleLoading] = useState(false);
  const [showShared, setShowShared] = useState(false);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState("");

  async function handleGoogleLogin() {
    setGoogleLoading(true);
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

  async function handleSharedLogin(e: React.FormEvent) {
    e.preventDefault();
    setSharedError("");
    const id = account.trim();
    if (!id || !password) {
      setSharedError(t("아이디와 비밀번호를 모두 입력해주세요.", "Please enter both the account ID and password."));
      return;
    }

    setSharedLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      // 매번 "@giamicro.com"까지 치게 하면 오타가 나기 쉬워서, 아이디만 입력해도 되도록
      // 도메인을 붙여줍니다. 전체 주소를 그대로 입력해도 그대로 씁니다.
      email: toSharedAccountEmail(id),
      password,
    });
    setSharedLoading(false);

    if (error) {
      // Supabase는 "아이디가 없음"과 "비밀번호가 틀림"을 구분하지 않고 같은 오류를 돌려줍니다
      // (존재하는 계정을 추측해내지 못하게 하는 의도적인 설계입니다). 그대로 한 문장으로 안내합니다.
      setSharedError(t("아이디 또는 비밀번호가 맞지 않습니다.", "That account ID or password is not correct."));
      return;
    }
    // 어디로 갈지는 미들웨어가 계정 종류에 따라 정합니다(교육용 계정 → 주간 관찰기록,
    // 도서관 계정 → 접근 차단 안내). 여기서는 일단 홈으로 보냅니다.
    router.push("/home");
    router.refresh();
  }

  return (
    <div className="text-center">
      <p className="mb-6 text-sm text-slate-500">
        {t("giamicro.com 회사 구글 계정으로 로그인하세요.", "Sign in with your giamicro.com school Google account.")}
      </p>

      {libraryError && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-left text-sm text-amber-700">
          {t(
            "도서관 전용 계정은 운영앱에 접속할 수 없습니다. 도서관 시스템 주소로 접속해 주세요.",
            "Library-only accounts cannot open the operations app. Please use the library system address instead."
          )}
        </p>
      )}

      {domainError && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-left text-sm text-red-600">
          {t(
            "giamicro.com 계정으로만 접속할 수 있습니다. 다른 계정으로 로그인되어 자동으로 로그아웃되었습니다.",
            "Only giamicro.com accounts can sign in. You were signed out because a different account was used."
          )}
        </p>
      )}

      <button
        onClick={handleGoogleLogin}
        disabled={googleLoading}
        className="w-full rounded-lg bg-gia-navy px-4 py-2.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
      >
        {googleLoading ? t("이동 중...", "Redirecting...") : t("Google 계정으로 로그인", "Sign in with Google")}
      </button>

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        {t(
          "처음 로그인하시면 이름·소속·직위를 입력하는 화면이 나오고, 관리자 승인 후 이용하실 수 있습니다.",
          "On your first sign-in you will be asked for your name, department and role. An administrator approves your account before you can use the app."
        )}
      </p>

      {/* 공용 계정(도서관 노트북 · 신입교사 교육용) 로그인 */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        {!showShared ? (
          <button
            type="button"
            onClick={() => setShowShared(true)}
            className="text-xs font-semibold text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
          >
            {t("공용 계정으로 로그인 (아이디 · 비밀번호)", "Shared account sign-in (ID and password)")}
          </button>
        ) : (
          <form onSubmit={handleSharedLogin} className="text-left">
            <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
              {t(
                `도서관 대출 노트북, 신입교사 교육용처럼 여러 사람이 함께 쓰는 계정 전용입니다. 개인 계정은 위의 Google 로그인을 이용해주세요.`,
                "For accounts shared by several people, such as the library laptop or new-teacher training. For your own account, use Google sign-in above."
              )}
            </p>

            <label className="mb-1 block text-xs font-semibold text-slate-500">{t("아이디", "Account ID")}</label>
            <div className="mb-3 flex items-center rounded-lg border border-slate-300 focus-within:border-gia-navy">
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="gia-demo"
                className="min-w-0 flex-1 rounded-l-lg px-3 py-2.5 text-sm outline-none"
              />
              <span className="shrink-0 pr-3 text-xs text-slate-400">{SHARED_ACCOUNT_DOMAIN}</span>
            </div>

            <label className="mb-1 block text-xs font-semibold text-slate-500">{t("비밀번호", "Password")}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-gia-navy"
            />

            {sharedError && <p className="mb-2 text-sm text-red-600">{sharedError}</p>}

            <button
              type="submit"
              disabled={sharedLoading}
              className="w-full rounded-lg border border-gia-navy px-4 py-2.5 text-sm font-semibold text-gia-navy hover:bg-slate-50 disabled:opacity-50"
            >
              {sharedLoading ? t("확인 중...", "Signing in...") : t("공용 계정으로 로그인", "Sign in to shared account")}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowShared(false);
                setSharedError("");
                setPassword("");
              }}
              className="mt-2 w-full text-center text-[11px] text-slate-400 hover:text-slate-600"
            >
              {t("닫기", "Close")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
