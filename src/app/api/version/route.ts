import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { APP_VERSION } from "@/lib/version";

// 지금 서버에 올라와 있는 버전과, **새로고침을 알린 적이 있는지**.
//
// 브라우저는 한 번 받아둔 자바스크립트를 계속 씁니다. 그래서 새 버전을 배포해도, 탭을 켜둔
// 사람은 어제 코드로 계속 일합니다. 고쳐놓은 버그가 그 사람 화면에서는 그대로 나고, 새로
// 만든 칸은 아예 없습니다.
//
// ── 왜 두 값을 따로 내려주는가 ──
//
// 예전에는 `version` 하나만 내려주고, 화면이 자기 버전보다 높기만 하면 노란 띠를 띄웠습니다.
// 그런데 하루에 배포가 여러 번 나가는 날에는 일하는 중에 계속 안내가 떴습니다. **잦은
// 안내는 읽히지 않습니다** — 그러면 정작 꼭 새로고침해야 하는 배포에도 아무도 안 누릅니다.
//
// 그래서 「서버가 더 새것인가」(version)와 「사람에게 알릴 만한 배포인가」(broadcast)를
// 나눕니다. 띠는 broadcast 가 있을 때만 뜹니다. version 은 아침 자동 최신화가 씁니다.
//
// 로그인 검사를 하지 않습니다. 버전 숫자는 비밀이 아니고, 로그인 화면에 머문 사람도
// 오래된 코드를 쓰고 있을 수 있습니다.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  let broadcast: { version: string; note: string | null; at: string } | null = null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) {
    try {
      const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { data } = await supabase
        .from("version_broadcasts")
        .select("version, note, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) broadcast = { version: data.version, note: data.note, at: data.created_at };
    } catch {
      // 알림을 못 읽어도 버전은 내려줘야 합니다. 여기서 500을 내면 아침 자동 최신화까지
      // 함께 멈추는데, 그건 안내가 안 뜨는 것보다 나쁩니다.
    }
  }

  return NextResponse.json(
    { version: APP_VERSION, broadcast },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
