import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// 기사님 설정 페이지(/s/[코드])가 "정말 위치가 들어오고 있는지"를 확인하는 곳입니다.
//
// 설정을 다 하셨는데 실제로는 작동하지 않는 상황이 제일 나쁩니다 - 그날 하원 때가 되어서야
// 알게 되고, 그때는 기사님이 운전 중이라 고칠 수도 없습니다. 그래서 설정 직후에 서버가
// 위치를 받았는지 눈으로 확인시켜 드립니다.
//
// 로그인이 없는 화면이 부르므로, 돌려주는 값은 "연결됐다/아니다"와 마지막 수신 시각뿐입니다.
// 좌표는 절대 내보내지 않습니다 - 링크를 가진 사람이 차량 위치를 들여다볼 수 있으면 안 됩니다.
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "code가 필요합니다." }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: device } = await supabase
    .from("shuttle_tracker_devices")
    .select("last_seen_at")
    .eq("setup_code", code)
    .maybeSingle();

  if (!device) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });

  // last_seen_at은 하원 시간대 밖에서 받은 요청에도 갱신됩니다(/api/shuttle/track). 좌표는
  // 버리더라도 "앱이 살아서 우리 서버를 부르고 있다"는 사실 자체가 설정 확인에 필요하기
  // 때문입니다 - 그래서 기사님이 아무 시간에나 설정하셔도 확인이 됩니다.
  //
  // 10분을 기준으로 삼습니다. 전송 간격이 30초이므로 정상이면 훨씬 자주 들어오고, 잠깐
  // 터널을 지나는 정도로는 끊기지 않을 만큼 넉넉합니다.
  const lastSeen = device.last_seen_at ? new Date(device.last_seen_at) : null;
  const fresh = !!lastSeen && Date.now() - lastSeen.getTime() < 10 * 60 * 1000;

  return NextResponse.json({ connected: fresh, everConnected: !!lastSeen, lastSeenAt: device.last_seen_at ?? null });
}
