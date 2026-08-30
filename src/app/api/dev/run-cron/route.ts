import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";

// 크론을 지금 바로 한 번 돌립니다 - 개발자 전용.
//
// 담당자: (구글 Chat 앱 설정 저장 후) "크론은 하루 한 번이라 기다리면 내일이 됩니다."
//
// 설정을 바꾸고 그게 먹었는지 확인하려면 다음 예약 시각까지 기다려야 했습니다. 하루 한 번짜리
// 크론이면 하루를 기다립니다. 그 사이에 다른 것을 건드리게 되고, 그러면 무엇 때문에 됐는지
// 안 됐는지도 흐려집니다.
//
// **바꾸고 → 눌러보고 → 결과를 본다.** 이 세 걸음이 붙어 있어야 원인을 알 수 있습니다.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 여기 적힌 것만 돌릴 수 있습니다.
//
// 목록으로 제한하는 이유는, 주소를 그대로 받아 부르면 이 API가 **아무 내부 주소나 CRON_SECRET을
// 달고 호출해 주는 통로**가 되기 때문입니다. 개발자만 쓴다 해도 열어둘 이유가 없습니다.
const ALLOWED: Record<string, string> = {
  "chat-subscription-renew": "구글챗 구독 갱신",
  "poll-chat-messages": "구글챗 메시지 수집",
  "shuttle-auto": "셔틀 도착·출발 자동감지",
  "pickup-schedules": "오늘 픽업 예약 적용",
  "shuttle-learn-stops": "정류장 좌표 학습",
};

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) {
    return NextResponse.json({ error: "개발자만 실행할 수 있습니다." }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  const key = body?.key ?? "";
  if (!ALLOWED[key]) {
    return NextResponse.json({ error: "실행할 수 없는 작업입니다." }, { status: 400 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 500 });

  // 지금 이 요청이 온 주소를 그대로 씁니다. 환경변수에 주소를 또 적어두면 도메인이 바뀔 때
  // 한 곳을 빠뜨리게 됩니다.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return NextResponse.json({ error: "주소를 알 수 없습니다." }, { status: 500 });

  const started = Date.now();
  try {
    const res = await fetch(`${proto}://${host}/api/cron/${key}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* JSON이 아니면 원문 그대로 보여줍니다 */
    }
    return NextResponse.json({
      key,
      label: ALLOWED[key],
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      result: parsed,
    });
  } catch (err) {
    return NextResponse.json(
      { key, label: ALLOWED[key], ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) return NextResponse.json({ error: "개발자 전용" }, { status: 403 });
  return NextResponse.json({ jobs: Object.entries(ALLOWED).map(([key, label]) => ({ key, label })) });
}
