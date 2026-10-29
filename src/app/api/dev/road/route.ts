import { NextResponse } from "next/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";

/**
 * **실제 도로 거리·시간 조회** — 셔틀 노선 재편 같은 검토 작업용(화면 없음, 개발자만).
 *
 * 노선을 새로 짜 보려면 «정류장 A → B 가 도로로 얼마인가»를 수백 쌍 알아야 합니다. 직선거리로
 * 어림하면 한강 다리·일방통행·단지 진입로가 빠져서, 지도에서는 가까운데 실제로는 돌아가는
 * 정류장이 같은 노선에 묶입니다. 카카오모빌리티 REST 키는 서버 비밀값이라 브라우저나 분석
 * 작업 환경에 꺼내지 않고, 이 창구가 대신 부릅니다.
 *
 *   mode "matrix": 출발지 1곳 → 목적지 최대 30곳의 도로 거리·시간 (다중 목적지 길찾기)
 *   mode "route" : 지점 순서대로 도는 경로(경유지 최대 30곳)의 구간별 거리·시간과 도로 선
 *
 * 저장하지 않습니다 - 검토용 계산이라 운영 자료(shuttle_*)와 섞이면 안 됩니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Pt = { x: number; y: number; key?: string };

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "개발자만 쓸 수 있습니다." }, { status: 403 });

  const restKey = process.env.KAKAO_REST_API_KEY;
  if (!restKey) return NextResponse.json({ error: "서버에 KAKAO_REST_API_KEY가 없습니다." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as
    | { mode: "matrix"; origin: Pt; destinations: Pt[]; radius?: number }
    | { mode: "route"; points: Pt[]; withPath?: boolean }
    | null;
  if (!body) return NextResponse.json({ error: "요청 본문이 없습니다." }, { status: 400 });

  const headers = { "Content-Type": "application/json", Authorization: `KakaoAK ${restKey}` };

  if (body.mode === "matrix") {
    if (!body.origin || !Array.isArray(body.destinations) || body.destinations.length === 0 || body.destinations.length > 30) {
      return NextResponse.json({ error: "origin 과 destinations(1~30곳)이 필요합니다." }, { status: 400 });
    }
    const res = await fetch("https://apis-navi.kakaomobility.com/v1/destinations/directions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        origin: { x: body.origin.x, y: body.origin.y },
        destinations: body.destinations.map((d, i) => ({ x: d.x, y: d.y, key: d.key ?? String(i) })),
        radius: Math.min(body.radius ?? 10000, 10000),
        priority: "TIME",
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `카카오 오류(${res.status}): ${(await res.text()).slice(0, 300)}` }, { status: 502 });
    const data = (await res.json()) as { routes?: { key: string; result_code: number; summary?: { distance: number; duration: number } }[] };
    return NextResponse.json({
      rows: (data.routes ?? []).map((r) => ({ key: r.key, ok: r.result_code === 0, m: r.summary?.distance ?? null, s: r.summary?.duration ?? null, code: r.result_code })),
    });
  }

  if (body.mode === "route") {
    const pts = body.points ?? [];
    if (pts.length < 2 || pts.length > 32) return NextResponse.json({ error: "points 는 2~32곳이어야 합니다." }, { status: 400 });
    const res = await fetch("https://apis-navi.kakaomobility.com/v1/waypoints/directions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        origin: { x: pts[0].x, y: pts[0].y },
        destination: { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y },
        waypoints: pts.slice(1, -1).map((p, i) => ({ name: `p${i + 1}`, x: p.x, y: p.y })),
        priority: "RECOMMEND",
        summary: false,
      }),
    });
    if (!res.ok) return NextResponse.json({ error: `카카오 오류(${res.status}): ${(await res.text()).slice(0, 300)}` }, { status: 502 });
    const data = (await res.json()) as {
      routes?: { result_code: number; result_msg: string; summary: { distance: number; duration: number }; sections?: { distance: number; duration: number; roads?: { vertexes: number[] }[] }[] }[];
    };
    const r = data.routes?.[0];
    if (!r || r.result_code !== 0) return NextResponse.json({ error: `길찾기 실패: ${r?.result_msg ?? "알 수 없음"}` }, { status: 502 });
    // 도로 선은 지도에 그릴 만큼만 남깁니다 - 점을 다 보내면 노선 하나가 수천 점입니다.
    const path: [number, number][] = [];
    if (body.withPath) {
      for (const s of r.sections ?? []) for (const rd of s.roads ?? []) {
        const v = rd.vertexes ?? [];
        for (let i = 0; i + 1 < v.length; i += 2) path.push([Math.round(v[i] * 1e5) / 1e5, Math.round(v[i + 1] * 1e5) / 1e5]);
      }
    }
    const step = Math.max(1, Math.ceil(path.length / 400));
    return NextResponse.json({
      m: r.summary.distance,
      s: r.summary.duration,
      legs: (r.sections ?? []).map((s) => [s.distance, s.duration]),
      path: path.filter((_, i) => i % step === 0 || i === path.length - 1),
    });
  }

  return NextResponse.json({ error: "mode 는 matrix 또는 route 입니다." }, { status: 400 });
}
