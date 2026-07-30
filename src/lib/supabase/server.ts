import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

/**
 * 서버 컴포넌트/라우트 핸들러에서 쓰는 Supabase 클라이언트.
 * Next.js의 cookies()를 통해 로그인 세션을 읽고 갱신합니다.
 * 서버 컴포넌트 안에서 세션 쿠키를 새로 쓰려고 하면 Next.js가 에러를 던지는데,
 * 이는 middleware.ts에서 세션을 이미 갱신해주기 때문에 무시해도 안전합니다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없음 - middleware가 세션 갱신을 담당하므로 무시해도 됨
          }
        },
      },
    }
  );
}
