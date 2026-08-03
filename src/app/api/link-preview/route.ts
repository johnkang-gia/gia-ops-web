import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 채팅 메시지에 URL이 있으면 카드 미리보기(제목/설명/이미지)를 보여주기 위한 라우트입니다.
// 브라우저에서 직접 외부 사이트로 fetch하면 대부분 CORS에 막히기 때문에, 서버를 거쳐 대신
// 가져옵니다(구글챗/슬랙의 링크 미리보기와 같은 방식).
//
// 채팅에 붙은 링크는 사용자가 직접 붙여넣은 임의의 주소라, 서버가 그 주소로 요청을 보내는
// 것 자체가 SSRF(서버가 사내망 등 원래 접근 불가능한 곳을 대신 찔러보게 만드는 공격) 통로가
// 될 수 있습니다. http/https만 허용하고, 사설/루프백 대역으로 보이는 호스트는 걸러서
// 기본적인 방어만 해뒀습니다(완벽한 SSRF 방어는 DNS 리바인딩까지 막아야 하지만, 로그인한
// giamicro.com 직원만 쓸 수 있는 내부 도구라는 점을 감안해 이 정도 수준으로 맞췄습니다).
const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^\[::1\]$/,
];

function extractMeta(html: string, key: string): string | null {
  // property="og:title" content="..." 또는 content="..." property="og:title" 순서 모두 대응합니다.
  const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i");
  return html.match(re1)?.[1] ?? html.match(re2)?.[1] ?? null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const target = new URL(request.url).searchParams.get("url") || "";
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "잘못된 URL입니다." }, { status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return NextResponse.json({ error: "http/https만 지원합니다." }, { status: 400 });
  }
  if (BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(parsed.hostname))) {
    return NextResponse.json({ error: "허용되지 않는 주소입니다." }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; GIAOpsBot/1.0; +internal chat link preview)" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`상태 코드 ${res.status}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return NextResponse.json({ title: parsed.hostname, description: null, image: null, siteName: parsed.hostname, url: parsed.toString() });
    }

    // 메타 태그는 보통 문서 앞쪽(<head>)에 있으므로, 응답 전체를 다 받지 않고 앞부분만 읽어서
    // 큰 페이지에서도 시간/메모리를 아낍니다.
    let html = "";
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      while (received < 200_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        received += value.length;
      }
      reader.cancel().catch(() => {});
    } else {
      html = await res.text();
    }

    const title = extractMeta(html, "og:title") || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || null;
    const description = extractMeta(html, "og:description") || extractMeta(html, "description");
    let image = extractMeta(html, "og:image");
    if (image && !/^https?:\/\//i.test(image)) {
      // 상대 경로 이미지는 원본 주소 기준으로 절대경로로 바꿔줍니다.
      try {
        image = new URL(image, parsed).toString();
      } catch {
        image = null;
      }
    }
    const siteName = extractMeta(html, "og:site_name") || parsed.hostname;

    return NextResponse.json({
      title: (title || parsed.hostname).trim().slice(0, 200),
      description: description ? description.trim().slice(0, 300) : null,
      image,
      siteName,
      url: parsed.toString(),
    });
  } catch {
    return NextResponse.json({ error: "미리보기를 가져오지 못했습니다." }, { status: 502 });
  }
}
