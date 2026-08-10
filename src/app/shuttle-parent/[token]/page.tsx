import { createClient } from "@supabase/supabase-js";
import ParentTrackClient from "@/components/shuttle/ParentTrackClient";

export const dynamic = "force-dynamic";

// 학부모 테스트 조회 화면 - 실제 학부모에게 배포하지 않고, 관리자가 만든 테스트 링크로만
// 접속합니다(요청: "학부모는 실질적으로 연결하지는 말고 기능만 구현해서 학부모계정도 테스트할
// 수 있도록"). 로그인이 필요 없고, 링크(토큰)를 아는 사람만 볼 수 있습니다.
export default async function ShuttleParentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return <ParentMessage text="서버 설정 오류입니다. 담당자에게 문의해주세요." />;
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: link } = await supabase.from("shuttle_parent_links").select("enabled").eq("token", token).maybeSingle();

  if (!link || !link.enabled) {
    return <ParentMessage text="유효하지 않거나 종료된 링크입니다. 담당자에게 문의해주세요." />;
  }

  return <ParentTrackClient token={token} />;
}

function ParentMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
        fontFamily: "sans-serif",
        color: "#334155",
        fontSize: 18,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}
