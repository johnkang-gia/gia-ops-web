import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { SCREENS, collectLinks, deadLinks, verdictOf, type CheckResult } from "@/lib/siteCheck";

/**
 * **사이트 점검 창구** — 화면 몇 개를 실제로 열어보고 결과를 돌려줍니다.
 *
 * ── 왜 한 번에 다 안 하나 ────────────────────────────────────────────
 *
 * 화면이 90개가 넘습니다. 한 요청에서 전부 열면 창구가 시간을 넘겨 **통째로 실패**하고,
 * 그러면 어디까지 멀쩡했는지도 모릅니다. 그래서 화면 쪽에서 여덟 개씩 나눠 부릅니다 -
 * 중간에 하나가 오래 걸려도 그 묶음만 늦고, 진행 상황이 사람 눈에 보입니다.
 *
 * ── 왜 자기 자신을 부르나 ────────────────────────────────────────────
 *
 * 「화면이 뜨는가」는 서버 안에서 함수를 불러서는 알 수 없습니다. 실제로 HTTP 로 열어봐야
 * 로그인 리다이렉트·오류 경계·느린 조회가 그대로 드러납니다. 부르는 사람의 쿠키를 그대로
 * 붙여 보내므로, **그 사람이 지금 브라우저에서 열었을 때와 같은 화면**을 봅니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 화면 하나에 이만큼 넘게 걸리면 끊습니다. 안 끊으면 묶음 전체가 매달립니다. */
const TIMEOUT_MS = 15_000;
/** 본문을 이만큼만 읽습니다. 오류 표시와 링크는 앞쪽에 다 나옵니다. */
const MAX_BODY = 300_000;

export async function POST(req: Request) {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body?.paths) ? body.paths.filter((p: unknown) => typeof p === "string").slice(0, 12) : [];
  if (paths.length === 0) return NextResponse.json({ error: "점검할 주소가 없습니다." }, { status: 400 });

  const h = await headers();
  // **지금 열려 있는 주소**로 부릅니다. 정식 주소를 박아두면 미리보기 배포를 점검할 때
  // 엉뚱하게 운영 화면을 열어보고 「정상」이라고 답합니다.
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (!host) return NextResponse.json({ error: "주소를 알 수 없어 점검하지 못했습니다." }, { status: 500 });
  const origin = `${proto}://${host}`;
  const cookie = h.get("cookie") ?? "";

  const known = SCREENS;

  const results = await Promise.all(
    paths.map(async (path): Promise<CheckResult> => {
      const started = Date.now();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(origin + path, {
          headers: { cookie, "user-agent": "gia-site-check" },
          redirect: "follow",
          cache: "no-store",
          signal: ctl.signal,
        });
        const text = (await res.text()).slice(0, MAX_BODY);
        const ms = Date.now() - started;
        const v = verdictOf({ status: res.status, ms, finalUrl: res.url, body: text });
        // 창구(/api)는 화면이 아니라 자료를 돌려줍니다. 링크를 찾을 것이 없습니다.
        const dead = path.startsWith("/api") ? [] : deadLinks(collectLinks(text), known);
        return { path, status: res.status, ms, verdict: v.verdict, note: v.note, deadLinks: dead };
      } catch (err) {
        const ms = Date.now() - started;
        const why = err instanceof Error && err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 안 열렸습니다` : String(err);
        const v = verdictOf({ status: null, ms, finalUrl: null, body: "", failed: why });
        return { path, status: null, ms, verdict: v.verdict, note: v.note, deadLinks: [] };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return NextResponse.json({ results });
}
