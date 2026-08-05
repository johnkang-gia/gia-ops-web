import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { ROLE_PREVIEW_COOKIE, isValidPreviewPosition } from "@/lib/rolePreview";

// 요청("개발자 계정의 경우 로그아웃 바로위에 드롭다운메뉴로 권한을 변경할 수 있게 해주고,
// 변경하면 그 권한에서만 볼 수 있는 화면으로 나오도록"). 진짜 로그인 계정(email)은 절대
// 바꾸지 않고, 개발자 브라우저에만 쿠키 하나를 심어서 화면 표시 범위만 그 직위처럼 재구성합니다
// - 그래서 이 라우트는 항상 "실제 로그인 이메일이 개발자인지"만 확인합니다(권한 미리보기
// 쿠키가 이미 걸려 있어도 이 확인 자체는 영향받지 않습니다 - getCurrentAppUser()의 position은
// 바뀌어도 email은 그대로라서).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isDeveloperEmail(user.email)) {
    return NextResponse.json({ error: "개발자 계정만 사용할 수 있습니다." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const position = typeof body?.position === "string" ? body.position : "";

  const cookieStore = await cookies();
  if (!position) {
    cookieStore.delete(ROLE_PREVIEW_COOKIE);
    return NextResponse.json({ ok: true, previewOf: null });
  }

  if (!isValidPreviewPosition(position)) {
    return NextResponse.json({ error: "알 수 없는 직위입니다." }, { status: 400 });
  }

  cookieStore.set(ROLE_PREVIEW_COOKIE, position, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 12, // 12시간 - 테스트용이라 길게 남겨두면 잊어버렸을 때 위험하므로 자동 만료
  });
  return NextResponse.json({ ok: true, previewOf: position });
}
