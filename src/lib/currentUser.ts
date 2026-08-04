import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type ShellTheme = "light" | "dark" | "liquid-glass" | "gia-brand";

export type CurrentAppUser = {
  id: string;
  email: string;
  name: string | null;
  position: string | null;
  avatar_url: string | null;
  theme: ShellTheme;
} | null;

// 사이드바(layout.tsx)와 각 페이지가 매 요청(탭 전환)마다 "로그인 확인 + app_users에서
// name/position 조회"를 각자 따로 하고 있었습니다 - 같은 사람 정보를 같은 요청 안에서 두 번
// 묻는 셈이라 탭을 옮길 때마다 불필요한 DB 왕복이 하나씩 더 붙어 있었습니다.
//
// React의 cache()로 감싸면, 같은 서버 요청(같은 페이지 렌더링 1회) 안에서는 이 함수가 몇 번
// 호출되든 실제 조회는 딱 한 번만 일어나고 이후 호출은 그 결과를 즉시 재사용합니다. 요청이
// 끝나면 캐시도 함께 사라지므로 다른 사용자의 정보가 섞일 위험은 없습니다(요청 스코프 캐시).
//
// 로그인하지 않았으면 null을 반환합니다(리다이렉트는 호출하는 쪽에서 각자의 상황에 맞게 처리).
export const getCurrentAppUser = cache(async (): Promise<CurrentAppUser> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  const email = user.email.toLowerCase();
  const { data: appUser } = await supabase
    .from("app_users")
    .select("name, position, avatar_url, theme")
    .eq("email", email)
    .maybeSingle();

  return {
    id: user.id,
    email,
    name: appUser?.name ?? null,
    position: appUser?.position ?? null,
    avatar_url: appUser?.avatar_url ?? null,
    theme: (appUser?.theme as ShellTheme | undefined) ?? "light",
  };
});
