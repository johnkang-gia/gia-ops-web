#!/usr/bin/env node
/**
 * **잠그지 않은 뷰를 찾습니다.**
 *
 * 표에 RLS를 켜는 것은 이미 `check-rls.mjs` 가 봅니다. 그런데 **뷰는 그 검사를 지나갑니다** -
 * 뷰에는 RLS를 켤 수 없고, 대신 포스트그레스가 기본적으로 **뷰를 만든 사람의 권한으로**
 * 돌리기 때문입니다. 즉 밑에 깔린 표가 잠겨 있어도 그 위의 뷰는 열려 있습니다.
 *
 * 실제로 났습니다. 재무 표를 전부 잠근 뒤에도, 그 위에 얹은 뷰 아홉 개가 **로그인 없이**
 * 읽혔습니다 - 그중 하나는 재학생 138명의 보호자 전화번호였습니다. 표를 잠근 마이그레이션은
 * 멀쩡했고, 뷰를 잠그는 일을 기억에 맡긴 것이 원인이었습니다. 몇몇 뷰에는 `revoke ... from
 * anon` 이 적혀 있었고 몇몇에는 없었습니다.
 *
 * 그래서 새로 만드는 뷰는 **같은 파일 안에서** 둘 중 하나를 해야 합니다.
 *
 *   alter view public.뷰이름 set (security_invoker = on);   -- 읽는 사람의 권한으로
 *   revoke all on public.뷰이름 from anon;                  -- 로그인 안 한 사람은 차단
 *
 * 둘 다 하는 것이 맞습니다 - 하나는 표의 정책을 따라가고, 하나는 그것과 무관하게 남습니다.
 *
 * 20261023000000 이전에 만든 뷰는 그 마이그레이션이 public 의 뷰를 통째로 훑어 잠갔으므로
 * 면제합니다. 정말 열어둬야 하는 뷰라면 그 파일에 `-- view-open-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
/** public 의 뷰를 통째로 훑어 잠근 마이그레이션. 이 시각까지의 뷰는 그것이 덮습니다. */
const SWEEP = "20261023000000";

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const bad = [];

for (const f of files) {
  const stamp = f.split("_")[0];
  if (stamp <= SWEEP) continue; // 통째로 훑은 마이그레이션이 덮습니다

  const sql = readFileSync(join(DIR, f), "utf8");
  if (/--\s*view-open-ok:/.test(sql)) continue;

  const made = [...sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)].map(
    (m) => m[1],
  );
  for (const v of new Set(made)) {
    const invoker = new RegExp(`alter\\s+view\\s+(?:public\\.)?"?${v}"?\\s+set\\s*\\(\\s*security_invoker`, "i").test(sql);
    const revoked = new RegExp(`revoke\\s+[^;]*\\son\\s+(?:public\\.)?"?${v}"?\\s+from\\s+[^;]*anon`, "i").test(sql);
    // 이름을 안 적고 public 의 뷰를 통째로 훑는 방식도 인정합니다.
    const sweep = /pg_views/.test(sql) && /security_invoker/.test(sql);
    if (!invoker && !revoked && !sweep) bad.push({ view: v, file: f });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 잠그지 않은 뷰가 있습니다.\n");
  for (const b of bad) console.error(`  ${b.view}\t(${b.file})`);
  console.error(`
  **뷰는 RLS 검사를 지나갑니다.** 뷰에는 RLS를 켤 수 없고, 포스트그레스는 뷰를 만든 사람의
  권한으로 돌립니다 - 밑에 깔린 표가 잠겨 있어도 그 위의 뷰는 열려 있습니다. 게다가 public
  스키마의 뷰는 로그인하지 않은 사람(anon)에게도 열려 있는 것이 기본값입니다.

  같은 파일에 두 줄을 넣어주세요.

    alter view public.뷰이름 set (security_invoker = on);
    revoke all on public.뷰이름 from anon;

  정말 열어둬야 하는 뷰라면 그 파일에 \`-- view-open-ok: 이유\` 를 적어주세요.
`);
  process.exit(1);
}

console.log(`✓ 뷰 권한 — ${SWEEP} 이후 만든 뷰는 모두 잠겨 있습니다.`);
