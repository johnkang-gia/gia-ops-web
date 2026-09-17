import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEMA_CHECKS } from "@/lib/schemaChecks";
import { INTEGRITY_VIEWS } from "@/lib/integrityViews";
import { openGaps } from "@/lib/registry/dataKinds";
import type { CheckResult } from "@/lib/inspect";

/**
 * 점검을 실제로 돌립니다. **서버에서만** 돕니다 - 로그인 안 한 열쇠로 물어보는 검사가
 * 들어 있어서, 브라우저에서 돌리면 그 화면의 로그인 상태가 섞입니다.
 */

/**
 * **로그인 없이 무엇이 보이는가.**
 *
 * 공개 열쇠(`anon`)로 PostgREST 에 물어봅니다. 화면에서 안 보여주는 것은 예의이지 자물쇠가
 * 아닙니다 - 주소만 알면 그대로 읽힙니다(CLAUDE.md §2-8).
 *
 * 볼 표 목록을 손으로 적지 않습니다. `/rest/v1/` 는 **그 열쇠로 보이는 것을 전부** 적어
 * 돌려줍니다. 적을 것이 없으면 빠뜨릴 것도 없습니다.
 */
async function probeAnon(): Promise<CheckResult[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return [
      {
        group: "보호",
        name: "로그인 없이 읽히는 표",
        level: "확인",
        detail: "공개 열쇠 설정을 못 읽어 검사하지 못했습니다.",
        impact: "검사가 안 돈 것과 「안전한 것」은 다릅니다. 환경변수를 확인해주세요.",
      },
    ];
  }

  // 목록은 **관리 열쇠로** 받고, 물어보는 것은 **공개 열쇠로** 합니다.
  //
  // 목록 창구(`/rest/v1/`)는 공개 열쇠로는 안 열립니다(「Secret API key required」). 그래서
  // 공개 열쇠만으로 훑으면 목록이 0개가 되고, 그건 「하나도 안 열렸다」가 아니라 **아무것도
  // 안 물어봤다**는 뜻입니다. 둘을 같은 초록불로 적으면 검사가 안 도는 것을 정상으로 읽게
  // 됩니다(§5). 관리 열쇠는 이 파일이 서버에서만 돌기 때문에 브라우저로 나가지 않습니다.
  const admin = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let names: string[] = [];
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: admin ? { apikey: admin, Authorization: `Bearer ${admin}` } : { apikey: key },
      cache: "no-store",
    });
    const doc = (await res.json()) as { paths?: Record<string, unknown> };
    names = Object.keys(doc.paths ?? {})
      .map((p) => p.replace(/^\//, ""))
      .filter((p) => p && !p.startsWith("rpc/"));
  } catch (e) {
    return [
      {
        group: "보호",
        name: "로그인 없이 읽히는 표",
        level: "확인",
        detail: `목록을 받지 못했습니다: ${(e as Error).message}`,
        impact: "검사가 안 돈 것과 「안전한 것」은 다릅니다.",
      },
    ];
  }

  // 한 줄이라도 돌아오면 그 표는 로그인 없이 읽힙니다. `Range: 0-0` 으로 한 줄만 받고,
  // 전체 줄 수는 머리글(`content-range`)에서 읽습니다 - 자료를 끌어오지 않습니다.
  const open: string[] = [];
  await Promise.all(
    names.map(async (n) => {
      try {
        const r = await fetch(`${url}/rest/v1/${n}?select=*`, {
          headers: { apikey: key, Prefer: "count=exact", Range: "0-0" },
          cache: "no-store",
        });
        if (r.status !== 200 && r.status !== 206) return;
        const total = (r.headers.get("content-range") ?? "").split("/")[1];
        if (total && total !== "0") open.push(`${n}(${total}줄)`);
      } catch {
        // 한 표를 못 물어본 것으로 전체를 멈추지 않습니다. 나머지 결과가 더 쓸모 있습니다.
      }
    }),
  );

  // 물어본 것이 없으면 「안 열렸다」가 아니라 **못 물어봤다**입니다.
  if (names.length === 0) {
    return [
      {
        group: "보호",
        name: "로그인 없이 읽히는 표",
        level: "확인",
        detail: "물어볼 표 목록을 못 받아 검사하지 못했습니다.",
        impact: "검사가 안 돈 것과 「안전한 것」은 다릅니다. 관리 열쇠 설정을 확인해주세요.",
      },
    ];
  }

  return [
    {
      group: "보호",
      name: "로그인 없이 읽히는 표",
      level: open.length === 0 ? "정상" : "문제",
      detail: open.length === 0 ? `${names.length}개를 물어봤고 하나도 안 열렸습니다` : `${names.length}개 중 ${open.length}개가 열려 있습니다`,
      impact:
        open.length === 0
          ? undefined
          : "공개 열쇠는 앱 화면 안에 들어 있습니다. 주소만 알면 누구나 그대로 받아갑니다.",
      items: open.sort(),
    },
  ];
}

export async function runInspect(supabase: SupabaseClient): Promise<CheckResult[]> {
  const [anon, rest] = await Promise.all([probeAnon(), runDbChecks(supabase)]);
  return [...anon, ...rest];
}

async function runDbChecks(supabase: SupabaseClient): Promise<CheckResult[]> {
  const out: CheckResult[] = [];

  // ── 보호 — 재무 열쇠 ─────────────────────────────────────────────────────
  //
  // 열쇠를 가진 사람이 하나도 없으면 재무 화면이 통째로 빕니다. 그건 오류로 안 보이고
  // 「자료가 없네」로 보입니다.
  const keys = await supabase.from("finance_key_holders").select("email", { count: "exact", head: true });
  out.push({
    group: "보호",
    name: "재무 열쇠 보유자",
    level: keys.error ? "확인" : (keys.count ?? 0) > 0 ? "정상" : "문제",
    detail: keys.error ? `읽지 못했습니다: ${keys.error.message}` : `${keys.count ?? 0}명`,
    impact: keys.error || (keys.count ?? 0) > 0 ? undefined : "재무 화면이 아무에게도 안 보입니다.",
  });

  // ── 데이터 — 기능별 스키마 ───────────────────────────────────────────────
  //
  // 칸이 있어도 권한이 막으면 기능은 똑같이 안 됩니다. 그래서 앱과 **똑같은 방식**으로
  // 그 칸을 읽어봅니다.
  const schema = await Promise.all(
    SCHEMA_CHECKS.map(async (c) => {
      const { error } = await supabase.from(c.table).select(c.columns.join(", ")).limit(1);
      return { c, ok: !error, why: error?.message ?? "" };
    }),
  );
  const schemaBad = schema.filter((s) => !s.ok);
  out.push({
    group: "코드",
    name: "마이그레이션 반영",
    level: schemaBad.length === 0 ? "정상" : "문제",
    detail: schemaBad.length === 0 ? `${SCHEMA_CHECKS.length}개 기능 모두 정상` : `${schemaBad.length}개 기능이 안 돕니다`,
    impact: schemaBad.length === 0 ? undefined : "그 기능은 화면에서 조용히 아무것도 저장하지 않습니다.",
    items: schemaBad.map((s) => `${s.c.feature} → ${s.c.migration} 실행 필요 (${s.why})`),
  });

  // ── 데이터 — 무결성 뷰 ───────────────────────────────────────────────────
  const integrity = await Promise.all(
    INTEGRITY_VIEWS.filter((v) => v.expect === "비어야_정상").map(async (v) => {
      let q = supabase.from(v.view).select("*", { count: "exact", head: true });
      if (v.onlyWhere) q = q.eq(v.onlyWhere.column, v.onlyWhere.value);
      const { count, error } = await q;
      return { v, count: count ?? 0, err: error?.message ?? null };
    }),
  );
  for (const r of integrity) {
    out.push({
      group: "데이터",
      name: r.v.label,
      // 뷰를 못 읽은 것과 「0건」은 다릅니다. 못 읽었는데 초록불을 켜면 검사가 안 도는 것을
      // 정상으로 읽게 됩니다(§5).
      level: r.err ? "문제" : r.count === 0 ? "정상" : "문제",
      detail: r.err ? `읽지 못했습니다: ${r.err}` : r.count === 0 ? "0건" : `${r.count}건`,
      impact: r.err || r.count > 0 ? r.v.impact : undefined,
    });
  }

  // ── 코드 — 화면에서 난 오류 ──────────────────────────────────────────────
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [errRes, resolvedRes] = await Promise.all([
    supabase.from("error_logs").select("route, message").gte("created_at", since).limit(500),
    supabase.from("error_resolutions").select("fingerprint").limit(500),
  ]);
  if (errRes.error) {
    out.push({
      group: "코드",
      name: "최근 7일 화면 오류",
      level: "확인",
      detail: `읽지 못했습니다: ${errRes.error.message}`,
    });
  } else {
    const rows = (errRes.data as { route: string | null; message: string | null }[] | null) ?? [];
    // 같은 오류가 백 번 나도 고칠 곳은 한 곳입니다. 주소+메시지로 묶어 셉니다.
    const byKind = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.route ?? "?"} — ${(r.message ?? "").slice(0, 90)}`;
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    const top = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
    out.push({
      group: "코드",
      name: "최근 7일 화면 오류",
      level: top.length === 0 ? "정상" : top.length > 5 ? "문제" : "확인",
      detail: top.length === 0 ? "없습니다" : `${top.length}가지 · 모두 ${rows.length}건`,
      items: top.slice(0, 10).map(([k, n]) => `${n}회 · ${k}`),
    });
    void resolvedRes;
  }

  // ── 코드 — 자료 갈래의 짝 없는 자리 ──────────────────────────────────────
  //
  // 넣는 함수는 있는데 내리는 함수가 없는 갈래입니다. 넣을 때 세 표에 자국이 남는데 내릴
  // 때 한 표만 고치면, 남은 두 표를 읽는 화면에서 그 자료가 계속 살아 있습니다(§2-9).
  const gaps = openGaps();
  out.push({
    group: "코드",
    name: "자료 갈래 짝 없음",
    level: gaps.length === 0 ? "정상" : "확인",
    detail: gaps.length === 0 ? "없습니다" : `${gaps.length}갈래`,
    items: gaps.map((g) => `${g.key} — ${g.gap}`),
  });

  return out;
}
