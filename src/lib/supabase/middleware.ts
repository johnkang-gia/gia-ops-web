import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPinCookieValid, pinCookieName } from "@/lib/pinCookie";
import { authOkCookieMaxAge, authOkCookieName, makeAuthOkCookieValue, readAuthOkCookie } from "@/lib/authCookie";
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

  // getUser()는 매 요청마다 Supabase Auth 서버로 네트워크 요청을 보내 검증합니다.
  // getClaims()는 프로젝트가 비대칭 서명키(JWKS)를 쓰는 경우 로컬에서(캐시된 공개키로) 검증하므로
  // 더 빠르고, 그렇지 않은 프로젝트에서도 getUser()와 동일하게 동작해 손해가 없습니다.
  const {
    data: claimsData,
  } = await supabase.auth.getClaims();
  const user = claimsData ? { id: claimsData.claims.sub, email: claimsData.claims.email as string | undefined } : null;

  const path = request.nextUrl.pathname;
  const isAuthRoute =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/pin") ||
    path.startsWith("/api/pin") ||
    path.startsWith("/pending") ||
    path.startsWith("/onboarding") ||
    path.startsWith("/api/onboarding");

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

    if (!isDeveloperEmail(email) && user.id) {
      // 승인 여부를 매 요청마다 DB에서 조회하면 페이지 이동마다 네트워크 왕복이 늘어나 체감
      // 속도가 떨어집니다. 한 번 승인 확인이 끝나면 짧은 시간(5분) 동안은 서명된 쿠키만으로
      // 통과시키고, 쿠키가 없거나 만료됐을 때만 실제로 DB를 조회합니다. 이 쿠키에는 직위
      // (position)도 함께 캐싱해서, 교사 전용 화면 제한도 DB 재조회 없이 판단합니다.
      const authOkCookie = request.cookies.get(authOkCookieName())?.value;
      const cached = readAuthOkCookie(user.id, authOkCookie);
      let position: string | null = cached?.position ?? null;

      if (!cached) {
        const normalizedEmail = email.toLowerCase();
        const { data: appUser } = await supabase
          .from("app_users")
          .select("status, name, position")
          .eq("email", normalizedEmail)
          .maybeSingle();

        if (!appUser) {
          // 첫 로그인 - 승인 신청 행을 만들고 온보딩(이름/소속/직위 입력) 화면으로 보냅니다.
          await supabase.from("app_users").insert({ email: normalizedEmail });
          const url = request.nextUrl.clone();
          url.pathname = "/onboarding";
          return NextResponse.redirect(url);
        }
        if (!appUser.name) {
          // 이름/소속/직위를 아직 입력하지 않음 - 승인 여부와 무관하게 온보딩부터 완료해야 함
          // (기존에 이미 승인된 계정이라도 이 정보가 없으면 채우도록 함).
          const url = request.nextUrl.clone();
          url.pathname = "/onboarding";
          return NextResponse.redirect(url);
        }
        if (appUser.status !== "approved") {
          const url = request.nextUrl.clone();
          url.pathname = "/pending";
          return NextResponse.redirect(url);
        }

        position = appUser.position;
        supabaseResponse.cookies.set(authOkCookieName(), makeAuthOkCookieValue(user.id, position), {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: authOkCookieMaxAge(),
        });
      }

      const pinCookie = request.cookies.get(pinCookieName())?.value;
      if (!isPinCookieValid(user.id, pinCookie)) {
        const url = request.nextUrl.clone();
        url.pathname = "/pin";
        return NextResponse.redirect(url);
      }

      // 교사는 위클리 리포트 화면만 볼 수 있습니다. GIA ops(사건/회의/매뉴얼 등)와 업무
      // 보드는 계약직으로 짧게 근무할 수도 있는 교사에게는 내부 문서나 다름없어서, 관리자/
      // 교직원/개발자와 달리 아예 접근 자체를 막습니다.
      if (position === "교사" && !path.startsWith("/weekly-report")) {
        const url = request.nextUrl.clone();
        url.pathname = "/weekly-report";
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
