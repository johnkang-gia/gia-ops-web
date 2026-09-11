import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { DATA_KINDS, LOG_TABLES, UNFILED, openGaps } from "@/lib/registry/dataKinds";

/**
 * **자료 등기소 점검** — 적어 둔 규칙이 **실제 자료에서도 지켜지는가**.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 등기소는 지금까지 **적어 둔 것을 보여주기만** 했습니다. 「중복은 (service_date,
 * assignment_id)로 막습니다」라고 적혀 있어도, 그 표에 유일 색인이 없으면 실제로는 안 막힙니다 -
 * 두 사람이 동시에 누르면 두 줄이 생기고, 화면에는 오류가 아니라 **같은 아이가 두 번** 뜹니다.
 *
 * 그래서 여기서 세 가지를 **자료에 대고** 확인합니다.
 *
 *   ① 등기소에 적힌 표를 실제로 읽을 수 있는가 (이름 오타·지워진 표·자물쇠)
 *   ② 중복 열쇠가 실제로 지켜지는가 (같은 열쇠의 줄이 둘 이상 있는가)
 *   ③ 넣기·내리기 짝이 없는 자리 (이건 코드 이야기라 그대로 옮깁니다)
 *
 * ── 왜 세는 방식이 이런가 ───────────────────────────────────────────────────
 *
 * Supabase 창구로는 `group by` 를 직접 못 씁니다. 그래서 **열쇠 칸만** 읽어 와서 여기서
 * 셉니다. 열쇠 칸만 읽으므로 줄이 만 개여도 가볍고, 표가 그보다 크면 세지 않고 「너무 커서
 * 못 셌습니다」라고 적습니다 - 조용히 「이상 없음」으로 두면 그게 가장 나쁜 답입니다.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 이 줄 수를 넘으면 세지 않습니다. 열쇠 칸만 읽어도 너무 무거워집니다. */
const MAX_ROWS = 20_000;

type KindReport = {
  kind: string;
  canonical: string;
  /** 읽을 수 없는 표. 이름이 틀렸거나 지워졌거나 자물쇠에 막힌 것입니다. */
  unreadable: { table: string; why: string }[];
  dedupe: {
    by: string[] | null;
    /** 같은 열쇠를 나눠 쓰는 줄 묶음. 비어 있으면 규칙이 실제로 지켜지고 있습니다. */
    duplicates: { key: string; count: number }[];
    rows: number | null;
    note: string | null;
  };
  gap: string | null;
};

export async function GET() {
  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isDeveloperEmail(me.email)) return NextResponse.json({ error: "개발자만 볼 수 있습니다." }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "service role key not configured" }, { status: 500 });
  // 자물쇠(RLS) 때문에 「없는 표」로 잘못 읽지 않도록 서비스 키로 봅니다. 여기서 보려는 것은
  // 「권한이 있나」가 아니라 「표와 자료가 등기소와 맞나」입니다.
  const db = createServiceClient(url, key, { auth: { persistSession: false } });

  /** 표 하나를 읽어봅니다. 못 읽으면 그 이유를 그대로 돌려줍니다. */
  async function probe(table: string): Promise<string | null> {
    const { error } = await db.from(table).select("*", { head: true, count: "exact" }).limit(1);
    return error ? error.message : null;
  }

  const reports: KindReport[] = [];

  for (const kind of DATA_KINDS) {
    const unreadable: { table: string; why: string }[] = [];
    for (const table of [kind.canonical, ...kind.satellites]) {
      const why = await probe(table);
      if (why) unreadable.push({ table, why });
    }

    const by = "by" in kind.dedupe ? kind.dedupe.by : null;
    let duplicates: { key: string; count: number }[] = [];
    let rows: number | null = null;
    let note: string | null = "by" in kind.dedupe ? null : kind.dedupe.none;

    // 열쇠가 `id` 하나뿐이면 셀 것이 없습니다 - 기본키라 데이터베이스가 이미 막습니다.
    const worthCounting = by && !(by.length === 1 && by[0] === "id") && !unreadable.some((u) => u.table === kind.canonical);

    if (worthCounting && by) {
      const { count } = await db.from(kind.canonical).select("id", { head: true, count: "exact" });
      rows = count ?? null;
      if ((rows ?? 0) > MAX_ROWS) {
        note = `줄이 ${rows?.toLocaleString()}개라 세지 않았습니다(${MAX_ROWS.toLocaleString()}개까지만 셉니다).`;
      } else {
        const { data, error } = await db.from(kind.canonical).select(by.join(", ")).limit(MAX_ROWS);
        if (error) {
          note = `열쇠 칸을 읽지 못했습니다: ${error.message}`;
        } else {
          const seen = new Map<string, number>();
          for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
            // **비어 있는 열쇠는 세지 않습니다.** null 은 서로 다른 값으로 치는 것이 SQL의
            // 규칙이고, 그걸 여기서 뒤집으면 실제로는 중복이 아닌 것을 중복으로 셉니다.
            if (by.some((c) => row[c] === null || row[c] === undefined)) continue;
            const k = by.map((c) => String(row[c])).join(" ∕ ");
            seen.set(k, (seen.get(k) ?? 0) + 1);
          }
          duplicates = [...seen.entries()]
            .filter(([, n]) => n > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([k, n]) => ({ key: k, count: n }));
        }
      }
    }

    reports.push({ kind: kind.key, canonical: kind.canonical, unreadable, dedupe: { by, duplicates, rows, note }, gap: kind.gap });
  }

  // 기록 표와 어디에도 안 붙인 표도 **읽히는지만** 봅니다. 중복은 원래 안 막는 표들입니다.
  const otherUnreadable: { table: string; why: string }[] = [];
  for (const table of [...LOG_TABLES, ...Object.keys(UNFILED)]) {
    const why = await probe(table);
    if (why) otherUnreadable.push({ table, why });
  }

  const dupTotal = reports.reduce((n, r) => n + r.dedupe.duplicates.length, 0);
  const unreadableTotal = reports.reduce((n, r) => n + r.unreadable.length, 0) + otherUnreadable.length;

  return NextResponse.json({
    ok: dupTotal === 0 && unreadableTotal === 0,
    checkedAt: new Date().toISOString(),
    kinds: reports,
    otherUnreadable,
    gaps: openGaps(),
    summary: { 갈래: reports.length, 못읽은표: unreadableTotal, 중복묶음: dupTotal, 짝없는자리: openGaps().length },
  });
}
