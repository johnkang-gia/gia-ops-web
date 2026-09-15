import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { fingerprintOf, groupErrors, type ErrorResolution, type RawErrorLog } from "@/lib/errorGroup";
import { verdictOf } from "@/lib/siteCheck";

/**
 * **아직 안 고친 오류를 전부 다시 확인합니다.**
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────────────────────
 *
 * 화면의 「다시 확인」은 목록을 다시 세어올 뿐이라, 눌러도 **아무 일도 안 일어나 보였습니다.**
 * 그리고 오류마다 하나씩 눌러야 했습니다. 고친 뒤 스무 가지를 하나씩 눌러 확인하는 사람은
 * 없습니다 - 그래서 「해결됨」으로 넘어가는 줄이 없고, 목록은 영영 스무 가지로 남습니다.
 *
 * ── 무엇으로 「고쳐졌다」고 보나 ───────────────────────────────────────────
 *
 * 두 가지를 씁니다. 자리마다 할 수 있는 확인이 다르기 때문입니다.
 *
 *   ① **열어볼 수 있는 화면** — 실제로 한 번 엽니다(`/api/dev/site-check` 와 같은 방식).
 *      열어본 뒤에 **같은 오류가 새로 찍혔는지**를 봅니다. 안 찍혔고 화면도 멀쩡하면
 *      고쳐진 것입니다. 이게 가장 확실한 증거입니다.
 *
 *   ② **열어볼 수 없는 자리**(크론·POST 창구) — 부르면 진짜 자료가 바뀝니다. 확인하려다
 *      사고를 내는 것은 안 고친 것보다 나쁩니다. 그래서 **조용한 시간**으로 봅니다 -
 *      마지막으로 난 지 하루가 지났으면 고쳐진 것으로 보고 넘깁니다.
 *
 * **잘못 넘어가도 괜찮습니다.** 또 나면 화면이 저절로 「다시 났습니다」를 달고 미해결로
 * 되돌립니다(`groupErrors` 의 regressed). 그래서 이 판단은 되돌릴 수 없는 종류가 아닙니다.
 *
 * 열어보지 못한 자리는 **그 사실을 그대로 돌려줍니다** - 「확인했다」와 「확인할 수 없었다」가
 * 화면에서 구별돼야 합니다.
 *
 * open-api-ok: 세션으로 사람을 확인하는 라우트입니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 며칠치를 보고 판단하나. 오류 화면과 같은 창입니다. */
const WINDOW_DAYS = 30;
const MAX_ROWS = 3000;
/** 열어볼 수 없는 자리는 이만큼 조용하면 고쳐진 것으로 봅니다. */
const QUIET_MS = 24 * 3600_000;
/** 화면 하나에 이만큼 넘게 걸리면 끊습니다. 안 끊으면 묶음 전체가 매달립니다. */
const TIMEOUT_MS = 12_000;
/** 한 번에 이만큼만 열어봅니다. 전부 열면 창구가 시간을 넘겨 통째로 실패합니다. */
const MAX_PROBES = 10;
/** 연 뒤 오류가 찍히기까지의 틈. 기록은 요청이 끝난 뒤에 들어갑니다. */
const SETTLE_MS = 1200;

type Outcome = {
  fingerprint: string;
  route: string;
  /** 해결로 넘겼는가. */
  resolved: boolean;
  /** 왜 그렇게 판단했는가. 화면이 그대로 보여줍니다. */
  why: string;
};

export async function POST() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "개발자만 쓸 수 있습니다." }, { status: 403 });

  const supabase = await createClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000).toISOString();

  const [logsRes, resRes] = await Promise.all([
    supabase
      .from("error_logs")
      .select("id, route, message, stack, user_email, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase.from("error_resolutions").select("fingerprint, resolved_at, resolved_by, note"),
  ]);
  if (logsRes.error) {
    return NextResponse.json({ error: `오류 기록을 읽지 못했습니다: ${logsRes.error.message}` }, { status: 500 });
  }
  if (resRes.error) {
    // 해결 표시를 못 읽으면 전부 미해결로 보입니다. 그 상태로 자동 판정하면 이미 표시해 둔
    // 것까지 다시 씁니다 - 덮어쓰기라 해는 없지만, 왜 그랬는지 모르게 됩니다.
    console.error("[dev/error-recheck] 해결 표시를 읽지 못했습니다:", resRes.error.message);
  }

  const groups = groupErrors(
    (logsRes.data as RawErrorLog[] | null) ?? [],
    (resRes.data as ErrorResolution[] | null) ?? [],
  ).filter((g) => !g.resolved);

  if (groups.length === 0) return NextResponse.json({ ok: true, checked: 0, outcomes: [] as Outcome[] });

  // ── ① 열어볼 수 있는 화면 고르기 ─────────────────────────────────────────
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const cookie = h.get("cookie") ?? "";
  const origin = host ? `${proto}://${host}` : null;

  const probeTargets = groups.filter((g) => canProbe(g.route)).slice(0, MAX_PROBES);
  const probedAt = new Date().toISOString();
  const probeVerdict = new Map<string, { ok: boolean; note: string }>();

  if (origin) {
    await Promise.all(
      probeTargets.map(async (g) => {
        const started = Date.now();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(origin + g.route, {
            headers: { cookie, "user-agent": "gia-error-recheck" },
            redirect: "follow",
            cache: "no-store",
            signal: ctl.signal,
          });
          const body = (await res.text()).slice(0, 300_000);
          const v = verdictOf({ status: res.status, ms: Date.now() - started, finalUrl: res.url, body });
          // 「느림」은 오류가 아닙니다. 「권한 막힘」·「로그인으로 튕김」도 그 화면이 고장 났다는
          // 뜻이 아니라 부르는 쪽 사정입니다 - 그때는 열어본 것으로 치지 않습니다.
          const ok = v.verdict === "정상" || v.verdict === "느림";
          probeVerdict.set(g.fingerprint, {
            ok,
            note: ok ? "열어보니 멀쩡했습니다" : `열어보니 ${v.verdict}${v.note ? ` (${v.note})` : ""}`,
          });
        } catch (err) {
          const why = err instanceof Error && err.name === "AbortError" ? `${TIMEOUT_MS / 1000}초 안에 안 열렸습니다` : String(err);
          probeVerdict.set(g.fingerprint, { ok: false, note: `열어보지 못했습니다: ${why}` });
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    // 기록은 요청이 끝난 뒤에 들어갑니다. 바로 세면 방금 난 오류를 못 보고 「고쳐졌다」고
    // 답합니다.
    if (probeTargets.length > 0) await new Promise((r) => setTimeout(r, SETTLE_MS));
  }

  // ── ② 열어본 뒤 같은 오류가 새로 찍혔는가 ────────────────────────────────
  const freshPrints = new Set<string>();
  if (probeTargets.length > 0) {
    const { data: fresh, error: freshErr } = await supabase
      .from("error_logs")
      .select("route, message")
      .gte("created_at", probedAt)
      .limit(500);
    if (freshErr) {
      // 못 읽었으면 **아무것도 넘기지 않습니다.** 확인하지 못한 것을 해결로 넘기면, 그 오류는
      // 다시 날 때까지 목록에서 사라집니다.
      return NextResponse.json(
        { error: `열어본 뒤 결과를 읽지 못해 아무것도 넘기지 않았습니다: ${freshErr.message}` },
        { status: 500 },
      );
    }
    for (const r of ((fresh as { route: string; message: string }[] | null) ?? [])) {
      freshPrints.add(fingerprintOf(r.route, r.message));
    }
  }

  // ── ③ 판정하고, 고쳐진 것만 해결로 넘깁니다 ──────────────────────────────
  const now = Date.now();
  const outcomes: Outcome[] = [];
  const toResolve: { fingerprint: string; route: string; message: string; note: string }[] = [];

  for (const g of groups) {
    const probe = probeVerdict.get(g.fingerprint);
    if (probe) {
      if (freshPrints.has(g.fingerprint)) {
        outcomes.push({ fingerprint: g.fingerprint, route: g.route, resolved: false, why: "열어보니 같은 오류가 또 났습니다" });
        continue;
      }
      if (!probe.ok) {
        outcomes.push({ fingerprint: g.fingerprint, route: g.route, resolved: false, why: probe.note });
        continue;
      }
      outcomes.push({ fingerprint: g.fingerprint, route: g.route, resolved: true, why: probe.note });
      toResolve.push({ fingerprint: g.fingerprint, route: g.route, message: g.message, note: "다시 확인: 열어보니 멀쩡했고 같은 오류가 다시 안 났습니다." });
      continue;
    }

    const quietMs = now - new Date(g.lastAt).getTime();
    if (quietMs >= QUIET_MS) {
      const hours = Math.floor(quietMs / 3600_000);
      outcomes.push({ fingerprint: g.fingerprint, route: g.route, resolved: true, why: `열어볼 수 없는 자리 · ${Math.floor(hours / 24)}일째 다시 안 났습니다` });
      toResolve.push({
        fingerprint: g.fingerprint,
        route: g.route,
        message: g.message,
        note: `다시 확인: 열어볼 수 없는 자리라 조용한 시간으로 봤습니다(${hours}시간).`,
      });
      continue;
    }
    outcomes.push({
      fingerprint: g.fingerprint,
      route: g.route,
      resolved: false,
      why: `아직 ${Math.max(1, Math.floor(quietMs / 3600_000))}시간 전에 났습니다 (열어볼 수 없는 자리)`,
    });
  }

  if (toResolve.length > 0) {
    const resolvedAt = new Date().toISOString();
    const { error } = await supabase.from("error_resolutions").upsert(
      toResolve.map((t) => ({
        fingerprint: t.fingerprint,
        route: t.route.slice(0, 200) || null,
        sample_message: t.message.slice(0, 2000) || null,
        resolved_at: resolvedAt,
        resolved_by: `${me.name || me.email} (다시 확인)`,
        note: t.note.slice(0, 500),
      })),
      { onConflict: "fingerprint" },
    );
    // 조용히 성공한 척하지 않습니다. 표시가 안 됐는데 「N가지 해결」이라고 답하면, 사람은
    // 고친 줄 알고 화면을 닫습니다.
    if (error) return NextResponse.json({ error: `해결로 넘기지 못했습니다: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    checked: groups.length,
    probed: probeTargets.length,
    resolved: toResolve.length,
    outcomes,
  });
}

/**
 * **열어봐도 되는 자리인가.**
 *
 * 화면(GET)만 엽니다. 창구(`/api/…`)는 부르는 순간 자료가 바뀌는 자리가 섞여 있고
 * (크론·픽업 확정·출결 처리), 어느 것이 안전한지 이름만으로는 가를 수 없습니다.
 * **가를 수 없으면 열지 않습니다** - 확인하려다 진짜 자료를 건드리는 것이 가장 나쁩니다.
 */
function canProbe(route: string): boolean {
  if (!route.startsWith("/")) return false; // "cron:shuttle-auto" 같은 이름표
  if (route.startsWith("/api")) return false;
  if (route.includes("..")) return false;
  // 주소에 값이 박힌 자리(/students/«번호»)는 그 값이 지금도 유효한지 알 수 없습니다.
  if (route.includes("«")) return false;
  return true;
}
