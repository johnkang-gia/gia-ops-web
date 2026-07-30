import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPinCookieValid, pinCookieName } from "@/lib/pinCookie";
import { isDeveloperEmail } from "@/lib/roles";

const ALLOWED_DOMAIN = "@giamicro.com";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * 모든 요청마다 Supabase 로그인 세션을 갱신하고, giamicro.com 도메인 계정이 아니면
 * 로그인을 강제로 끊습니다(서버 미들웨어 단계 확인 + Postgres RLS 이중 확인 중 첫 번째 방어선).
 * 도메인 확인을 통과해도 관리자가 승인한 계정이 아니면 /pending(승인 대기)으로 보냅니다
 * (개발자 계정은 면제). 승인까지 통과한 뒤에는 PIN 2차 확인 여부를 검사합니다(개발자 계정 면제).
 * /login, /auth, /pin, /api/pin, /pending 으로 시작하는 경로는 이 검사들 자체를 위한
 * 화면/API이므로 제외합니다.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/pin") ||
    path.startsWith("/api/pin") ||
    path.startsWith("/pending");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && !isAuthRoute) {
    const email = user.email || "";
    if (!email.toLowerCase().endsWith(ALLOWED_DOMAIN)) {
      // 회사 계정이 아니면 세션을 끊고 로그인 화면으로 - 접근 불가 안내는 /login에서 처리
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "domain");
      return NextResponse.redirect(url);
    }

    if (!isDeveloperEmail(email)) {
      const normalizedEmail = email.toLowerCase();
      const { data: appUser } = await supabase
        .from("app_users")
        .select("status")
        .eq("email", normalizedEmail)
        .maybeSingle();

      if (!appUser) {
        // 첫 로그인 - 승인 신청 행을 만들고 대기 화면으로 보냅니다.
        await supabase.from("app_users").insert({ email: normalizedEmail });
        const url = request.nextUrl.clone();
        url.pathname = "/pending";
        return NextResponse.redirect(url);
      }
      if (appUser.status !== "approved") {
        const url = request.nextUrl.clone();
        url.pathname = "/pending";
        return NextResponse.redirect(url);
      }

      const pinCookie = request.cookies.get(pinCookieName())?.value;
      if (!isPinCookieValid(user.id, pinCookie)) {
        const url = request.nextUrl.clone();
        url.pathname = "/pin";
        return NextResponse.redirect(url);
      }
    }
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
