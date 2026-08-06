import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { isDeveloperEmail } from "@/lib/roles";
import { buildOAuthClient, saveRefreshToken } from "@/lib/googleChat";
import { logApiError } from "@/lib/logging";

function htmlPage(title: string, message: string) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
      `<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#334155;">` +
      `<h2>${title}</h2><p>${message}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

// STEP 1(/api/google-chat/oauth/start)에서 구글 동의 화면으로 보낸 뒤, 구글이 결과를 이 라우트로
// 돌려줍니다. 받은 code를 refresh_token으로 교환해 DB(google_chat_oauth_tokens)에 저장하면
// 최초 설정이 끝납니다 - 이후 구독 생성/갱신은 저장된 refresh_token만으로 자동 동작합니다.
export async function GET(request: Request) {
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user || !isDeveloperEmail(user.email)) {
    return new Response("접근 권한이 없습니다.", { status: 403 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return htmlPage("인증이 취소되었습니다", `구글 쪽에서 다음 오류를 돌려줬습니다: ${errorParam}. 다시 시도해주세요.`);
  }
  if (!code) {
    return htmlPage("잘못된 요청입니다", "인증 코드가 없습니다. /api/google-chat/oauth/start에서 다시 시작해주세요.");
  }

  const client = buildOAuthClient();
  if (!client) {
    return htmlPage(
      "환경변수 누락",
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI 환경변수가 설정되지 않았습니다."
    );
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    return htmlPage("서버 설정 오류", "SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.");
  }
  const supabase = createServiceClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      // 이미 한 번 동의한 앱을 다시 승인하면 구글이 refresh_token을 생략하는 경우가 있습니다
      // (계정 설정 > 보안 > 타사 앱 액세스에서 이 앱의 연결을 끊고 /start부터 다시 시도하면
      // 항상 새 refresh_token을 받을 수 있습니다).
      return htmlPage(
        "refresh_token을 받지 못했습니다",
        "구글 계정 설정에서 이 앱(gia-ops-web)의 연결을 끊은 뒤 /api/google-chat/oauth/start에서 다시 시도해주세요."
      );
    }
    await saveRefreshToken(supabase, tokens.refresh_token, user.email!);
    return htmlPage("연동 완료", "구글챗 계정 인증이 저장되었습니다. 이 창은 닫으셔도 됩니다.");
  } catch (err) {
    await logApiError(supabase, "google-chat/oauth/callback", err, user.email);
    return htmlPage("오류가 발생했습니다", "인증 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
  }
}
