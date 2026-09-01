import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { ROLE_PREVIEW_COOKIE, isValidPreviewPosition } from "@/lib/rolePreview";

export type ShellTheme = "light" | "dark" | "liquid-glass" | "gia-brand";

export type CurrentAppUser = {
  id: string;
  email: string;
  name: string | null;
  // 개발자가 권한 미리보기 중이면 실제 저장된 값 대신 미리보기 직위로 바뀌어 들어옵니다 -
  // position을 보는 모든 화면/로직이 자동으로 미리보기 직위 기준으로 동작하게 하기 위함입니다.
  position: string | null;
  avatar_url: string | null;
  theme: ShellTheme;
  // 실제 저장된 직위입니다(미리보기와 무관) - 미리보기 배지·해제 버튼 등 "진짜 내 직위"를
  // 보여줘야 하는 곳에서 씁니다.
  realPosition: string | null;
  // 미리보기 중이면 그 직위 문자열, 아니면 null입니다. @/lib/roles의 isAdminUser 등이 이 값을
  // 보고 개발자 우회를 끌지 판단합니다.
  previewOf: string | null;
  /**
   * 재무 열쇠. 돈에 관한 화면을 볼 수 있는가(@/lib/roles의 hasFinanceAccess가 씁니다).
   *
   * 직위와 별개입니다 - 관리자라고 자동으로 열리지 않습니다.
   */
  finance_access: boolean;
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

  // ── 신분과 열쇠를 **따로** 읽습니다 ──────────────────────────────────────
  //
  // 예전에는 한 번의 조회에 finance_access까지 함께 넣었습니다. 그런데 그 칸을 만드는
  // 마이그레이션이 아직 안 걸린 동안, PostgREST는 **조회 전체를 400으로 거절**했습니다
  // (`column app_users.finance_access does not exist`). 그러면 appUser가 null이 되고,
  // 직위도 null이 되고, 결국 **모든 행정직원·관리자가 권한 없는 사람**이 됐습니다.
  //
  // 실제로 이 일이 났습니다. 행정직원 화면에서 셔틀과 주간 학생 관찰기록이 통째로
  // 사라졌는데, 화면 어디에도 오류가 없어서 "권한 설정이 잘못됐나" 쪽만 들여다보게
  // 됐습니다. 개발자 계정은 이메일로 우회하므로 저에게만 멀쩡해 보였습니다.
  //
  // 그래서 **없어도 되는 값이 있어야 하는 값을 무너뜨리지 못하게** 나눕니다.
  //   · 이름·직위 = 없으면 아무것도 못 하는 값. 실패하면 소리를 냅니다.
  //   · 재무 열쇠 = 없으면 돈 화면만 안 열리는 값. 칸이 없으면 조용히 false.
  const [idRes, finRes] = await Promise.all([
    supabase.from("app_users").select("name, position, avatar_url, theme").eq("email", email).maybeSingle(),
    supabase.from("app_users").select("finance_access").eq("email", email).maybeSingle(),
  ]);

  const appUser = idRes.data;
  if (idRes.error) {
    // 직위를 못 읽으면 그 사람은 화면 절반을 잃습니다. 조용히 넘기면 안 됩니다.
    console.error(`[currentUser] ${email} 직위 조회 실패 — 메뉴가 비어 보입니다:`, idRes.error.message);
  }

  // 42703 = 칸 없음. 마이그레이션이 아직 안 걸린 것뿐이라 이건 정상 동작으로 넘어갑니다.
  if (finRes.error && finRes.error.code !== "42703") {
    console.error(`[currentUser] ${email} 재무 열쇠 조회 실패:`, finRes.error.message);
  }
  const financeAccess = (finRes.data as { finance_access?: boolean } | null)?.finance_access === true;

  const realPosition = appUser?.position ?? null;

  // 권한 미리보기(요청: "개발자 계정의 경우... 권한을 변경할 수 있게... 완전한 역할 전환
  // 비슷하게라도"). 실제 로그인 계정(email)은 그대로 두고 position만 바꿔치기합니다 - RLS는
  // Supabase JWT(진짜 계정) 기준으로 그대로 걸리므로 미리보기는 화면 표시 범위에만 영향을
  // 주고, 이 값 하나로 화면 전체가 그 직위인 것처럼 자동으로 재구성됩니다.
  let position = realPosition;
  let previewOf: string | null = null;
  if (isDeveloperEmail(email)) {
    const cookieStore = await cookies();
    const preview = cookieStore.get(ROLE_PREVIEW_COOKIE)?.value ?? null;
    if (isValidPreviewPosition(preview)) {
      position = preview;
      previewOf = preview;
    }
  }

  return {
    id: user.id,
    email,
    name: appUser?.name ?? null,
    position,
    avatar_url: appUser?.avatar_url ?? null,
    theme: (appUser?.theme as ShellTheme | undefined) ?? "light",
    realPosition,
    previewOf,
    // 권한 미리보기 중에는 열쇠도 함께 내려놓습니다. 그래야 "그 직위가 실제로 보게 될
    // 화면"이 재현됩니다 - 개발자가 관리자인 척 볼 때 돈 화면이 보이면 시험이 안 됩니다.
    finance_access: previewOf ? false : financeAccess,
  };
});
