import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authOkCookieMaxAge, authOkCookieName, makeAuthOkCookieValue, readAuthOkCookie } from "@/lib/authCookie";
import { isDeveloperEmail } from "@/lib/roles";
import { ROLE_PREVIEW_COOKIE, isValidPreviewPosition } from "@/lib/rolePreview";
import { isLibraryAccount } from "@/lib/sharedAccounts";

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
    path.startsWith("/api/shuttle/pilot") ||
    // 안내보드(로비/복도 공용 화면)용 - 개인 계정 로그인 없이 링크(토큰) 하나로 접속합니다
    // (요청: "운영앱에서 로그인하지 않고 별도의 페이지로 안내보드는 나오도록").
    path.startsWith("/shuttle-board") ||
    path.startsWith("/api/shuttle/board") ||
    // 교직원용 도착·출발 체크 단독 화면(여름캠프2 등 GPS 트래킹이 필요 없는 임시 셔틀용) -
    // 개인 계정 로그인 없이 링크(토큰) 하나로 접속합니다(요청: "교직원이 모바일로 도착한 차량
    // 누를 수 있는 단독 링크").
    path.startsWith("/shuttle-arrival") ||
    path.startsWith("/api/shuttle/arrival") ||
    // 사무실 대형 모니터용 통합 운영 대시보드(요청: "큰 모니터에 띄워서 전체가 한눈에 보고
    // 파악할 수 있는 통합 대시보드") - 하루 종일 켜두는 화면이라 세션 만료로 로그인이 풀리면
    // 안 되므로, 안내보드와 같은 토큰 링크 방식으로 엽니다.
    path.startsWith("/ops-board") ||
    path.startsWith("/api/ops-board") ||
    // 안내보드 짧은 주소(요청: "주소가 너무 복잡해서... 짧은 주소로 만들어줘") - /b/{코드}로
    // 접속하면 로그인 없이 실제 안내보드 링크로 바로 이동합니다.
    path.startsWith("/b/") ||
    // 운영 대시보드 짧은 주소(요청: "운영안내 대시보드 주소 간결하게 만들어주고, 다른곳에서
    // 바로 주소만쳐서 들어갈 수 있게") - /d/{코드}. 안내보드(/b/)와 같은 방식입니다.
    path.startsWith("/d/") ||
    // 기사님 휴대폰 설정 안내(요청: "웹앱으로 몇호차 기사님께 보내기하면 기사님 카톡이나
    // 문자로 링크가 가서 누르면 웹앱으로 접속되고") - /s/{코드}. 기사님은 학교 계정이 없으시고,
    // 계정을 만들어드리는 것 자체가 이 화면이 없애려는 번거로움입니다. 이 화면은 설정에 필요한
    // 값만 보여주고 위치 기록은 전혀 보여주지 않습니다.
    path.startsWith("/s/") ||
    path.startsWith("/api/shuttle/setup") ||
    // 토들 수집기(크롬 확장) 파일 - 사무실 PC가 여기서 최신 파일을 내려받아 스스로 갱신합니다.
    // 로그인 없이 열려야 합니다(확장은 브라우저 세션이 없는 상태로 받습니다). 확장 코드에는
    // 비밀값이 없습니다 - 수집 키는 담당자가 그 PC에서 직접 넣고 그 PC에만 저장됩니다.
    path.startsWith("/collector");

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

    // 도서관 전용 가계정(gia-library@giamicro.com)은 도서관 앱(gia-lib-web) 전용입니다.
    // 도서관 노트북은 하루 종일 로그인된 채로 열려 있어서, 그 계정으로 운영앱까지 볼 수 있으면
    // 사건기록·학생 개인정보가 그대로 노출됩니다. DB 쪽에서도 is_giamicro_user()가 이 계정을
    // 제외하도록 막아두었고(마이그레이션 99번), 여기서는 화면 진입 자체를 한 번 더 막습니다.
    if (isLibraryAccount(email)) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("error", "library");
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
        !path.startsWith("/my-class") &&
        !path.startsWith("/account") &&
        !path.startsWith("/attendance") &&
        !path.startsWith("/pickup") &&
        !path.startsWith("/inquiries") &&
        !path.startsWith("/api/")
      ) {
        const url = request.nextUrl.clone();
        // 담임 교사는 /my-class가 첫 화면입니다. 담임 배정이 없는 과목 교사는 그 페이지에서
        // 다시 /weekly-report로 넘어갑니다(page.tsx의 가드).
        url.pathname = "/my-class";
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
        !path.startsWith("/my-class") &&
        !path.startsWith("/account") &&
        !path.startsWith("/attendance") &&
        !path.startsWith("/pickup") &&
        !path.startsWith("/inquiries") &&
        !path.startsWith("/api/")
      ) {
        const url = request.nextUrl.clone();
        // 담임 교사는 /my-class가 첫 화면입니다. 담임 배정이 없는 과목 교사는 그 페이지에서
        // 다시 /weekly-report로 넘어갑니다(page.tsx의 가드).
        url.pathname = "/my-class";
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
