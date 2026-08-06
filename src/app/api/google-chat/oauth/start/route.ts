import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import { buildOAuthClient, GOOGLE_CHAT_SCOPES } from "@/lib/googleChat";

// 구글챗 미러링 최초 설정 - 개발자(강경원님) 본인 계정으로 구글 로그인 동의 화면으로
// 보냅니다(요청: 관리자 권한 없이, 본인 계정 인증만으로 설정 완료). 이 링크를 브라우저에서
// 직접 열면 됩니다: https://<도메인>/api/google-chat/oauth/start
// access_type=offline + prompt=consent를 둘 다 줘야 refresh_token이 응답에 포함됩니다(prompt
// 없이 재동의하면 구글이 이미 승인된 앱으로 보고 refresh_token을 생략하는 경우가 있어서, 매번
// 강제로 동의 화면을 다시 띄웁니다).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isDeveloperEmail(user.email)) {
    return new Response("접근 권한이 없습니다.", { status: 403 });
  }

  const client = buildOAuthClient();
  if (!client) {
    return new Response(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI 환경변수가 설정되지 않았습니다.",
      { status: 500 }
    );
  }

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_CHAT_SCOPES,
  });

  return Response.redirect(url, 302);
}
