import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifySlack } from "@/lib/slack";

// 요청: "누군가 아이디 등록 신청하면 슬랙을 통해서 알람이 오게해줘" - 온보딩(이름/소속/직위
// 입력) 저장이 끝난 직후 OnboardingForm이 이 라우트를 호출합니다. 클라이언트가 보낸 값을
// 그대로 믿지 않고, 로그인된 본인 이메일로 서버에서 app_users 행을 다시 조회해 실제 저장된
// 값으로 알림을 보냅니다(위조된 이름으로 가짜 알림을 보내는 것을 방지).
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data: appUser } = await supabase
    .from("app_users")
    .select("name, department, position")
    .eq("email", user.email.toLowerCase())
    .maybeSingle();

  await notifySlack(
    `🙋 새 계정 등록 신청\n이름: ${appUser?.name ?? "-"}\n소속: ${appUser?.department ?? "-"}\n직위: ${appUser?.position ?? "-"}\n이메일: ${user.email}\n→ [사용자 관리] 화면에서 승인해주세요.`
  );

  return NextResponse.json({ success: true });
}
