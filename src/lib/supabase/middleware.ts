import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authOkCookieMaxAge, authOkCookieName, makeAuthOkCookieValue, readAuthOkCookie } from "@/lib/authCookie";
import { isDeveloperEmail } from "@/lib/roles";
import { ROLE_PREVIEW_COOKIE, isValidPreviewPosition } from "@/lib/rolePreview";

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
 * (개발자 계정은 면제). 예전에는 승인 뒤 PIN 2차 확인까지 요구했지만, 이미 (1)회사 구글
 * 계정 로그인 + (2)관리자 승인 두 단계로 충분히 보안이 된다는 판단에 따라 PIN 단계는
 * 제거했습니다(요청: "보안 핀 설정은 없애줘 지금으로도 확실히 보안은 되는것 같아").
 * /login, /auth, /pending 으로 시작하는 경로는 이 검사들 자체를 위한 화면/API이므로 제외합니다.
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
    path.startsWith("/pending") ||
    path.startsWith("/onboarding") ||
    path.startsWith("/api/onboarding") ||
    // 크론(외부 스케줄러/Vercel Cron)이 부르는 라우트입니다. 이 요청들은 로그인 세션 쿠키가
    // 없는 서버-서버 호출이라, 세션이 없다고 여기서 /login으로 리다이렉트해버리면(307) 라우트
    // 자체의 CRON_SECRET Authorization 헤더 검사까지 가지도 못하고 항상 실패합니다(발견 계기:
    // 구글챗 폴링 크론이 cron-job.org에서 "307 Temporary Redirect"로 실패). 인증은 각 라우트가
    // Authorization: Bearer <CRON_SECRET>로 자체적으로 확인하므로 세션 검사만 건너뜁니다.
    path.startsWith("/api/cron") ||
    // 셔틀 실시간 위치(1단계 정식 기능)용 - 동승선생님이 회사 계정 로그인 없이
    // 링크(토큰) 하나로 접속합니다. 인증은 이 페이지/API가 자체적으로 토큰으로 확인합니다.
    path.startsWith("/shuttle-pilot") ||
    path.startsWith("/api/shuttle/pilot");

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

    const isDev = isDeveloperEmail(email);

    if (!isDev && user.id) {
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

      // 교사는 위클리 리포트 화면만 볼 수 있습니다. GIA ops(사건/회의/매뉴얼 등)와 업무
      // 보드는 계약직으로 짧게 근무할 수도 있는 교사에게는 내부 문서나 다름없어서, 관리자/
      // 행정직원/개발자와 달리 아예 접근 자체를 막습니다. 내 계정 설정(/account), 출석부
      // (/attendance, 요청: "학생출석부를 교사가 실시간 체크할 수 있게")는 직위와 무관하게
      // 예외로 둡니다. 실시간 셔틀(/shuttle/live)도 예외입니다(요청: "교직원들이 등원과 하원셔틀의
      // 실시간 위치를 바로 알 수 있고... 탑승확인" - 동승·담임 교사가 핵심 사용자라 교사도 반드시
      // 볼 수 있어야 함). 노선관리·탑승배정 등 편집 화면은 여전히 관리자/행정직원 전용입니다.
      // 행정요청(/requests) 기능은 제거되었습니다(구글챗 미러링으로 대체) - 교사는
      // 계속 구글챗을 그대로 씁니다. /api/로 시작하는 경로도 예외입니다 - 이 블록은 "화면 이동"을
      // 막기 위한 것이지 API 호출까지 페이지로 리다이렉트해버리면(예: 권한 미리보기 드롭다운이
      // 부르는 /api/dev/preview-role) fetch()가 조용히 실패해 원래 하려던 동작 자체가 먹통이
      // 됩니다. 각 API 라우트는 필요하면 자체적으로 권한을 다시 확인합니다.
      if (
        position === "교사" &&
        !path.startsWith("/weekly-report") &&
        !path.startsWith("/account") &&
        !path.startsWith("/attendance") &&
        !path.startsWith("/shuttle/live") &&
        !path.startsWith("/shuttle-board") &&
        !path.startsWith("/api/")
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/weekly-report";
        return NextResponse.redirect(url);
      }
    }

    // 개발자 권한 미리보기(요청: "개발자 계정의 경우... 권한을 변경할 수 있게... 그 권한에서만
    // 볼 수 있는 화면으로 나오도록"). 평소 개발자는 위 승인/직위 제한을 전부 면제받지만,
    // 미리보기 쿠키가 "교사"로 켜져 있으면 실제 교사 계정이 겪는 라우트 단계 제한(위클리
    // 리포트 전용)까지 그대로 재현해서, 화면뿐 아니라 이동 자체도 테스트할 수 있게 합니다.
    // 미리보기가 꺼져 있으면(쿠키 없음) 예전처럼 개발자는 아무 제한도 받지 않습니다.
    if (isDev) {
      const preview = request.cookies.get(ROLE_PREVIEW_COOKIE)?.value ?? null;
      if (
        isValidPreviewPosition(preview) &&
        preview === "교사" &&
        !path.startsWith("/weekly-report") &&
        !path.startsWith("/account") &&
        !path.startsWith("/attendance") &&
        !path.startsWith("/shuttle/live") &&
        !path.startsWith("/shuttle-board") &&
        !path.startsWith("/api/")
      ) {
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
