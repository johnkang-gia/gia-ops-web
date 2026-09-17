#!/usr/bin/env node
/**
 * **모두에게 열린 정책을 찾습니다.**
 *
 * RLS를 켜고 정책도 만들었는데 그 정책이 `using (true)` 이면, 잠근 것이 아니라 **잠근 척**
 * 한 것입니다. 게다가 `to authenticated` 를 빼면 **`anon`(로그인 안 한 열쇠)까지** 들어옵니다 -
 * 포스트그레스에서 역할을 안 적은 정책은 모든 역할에 적용됩니다.
 *
 * 실제로 났습니다. 표 넷에 이렇게 적혀 있었습니다.
 *
 *   create policy ..._all on ... for all using (true) with check (true);
 *
 * 주석에는 「로그인한 사용자는 읽고 쓸 수 있습니다」라고 적혀 있었는데, 실제로는 주소만
 * 알면 누구나 읽혔습니다. **적힌 뜻과 실제가 달랐고 화면에는 아무 차이도 안 났습니다.**
 *
 * 정책을 여럿 붙이면 **OR** 로 묶입니다. 나중에 「교직원만」을 하나 더 붙여도 이 줄이 남아
 * 있으면 결과는 언제나 「누구나」입니다 - 자물쇠 옆에 열린 문이 있는 셈입니다.
 *
 * 그래서 `using (true)` 는 **역할을 적었을 때만** 지나갑니다. 정말 아무나 읽어도 되는
 * 자리라면 그 파일에 `-- open-policy-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
/**
 * 이 마이그레이션이 옛 열린 정책을 전부 지우고 다시 달았습니다. 그 앞의 파일들은 **이미
 * 적용된 기록**이라 고쳐 쓰지 않습니다 - 고쳐도 데이터베이스는 안 바뀌고, 기록만 사실과
 * 달라집니다. 검사는 이 시각 뒤에 새로 만드는 정책을 봅니다.
 */
const SWEEP = "20261025000000";
const bad = [];

for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
  if (f.split("_")[0] <= SWEEP) continue;
  const raw = readFileSync(join(DIR, f), "utf8");
  if (/--\s*open-policy-ok:/.test(raw)) continue;
  // 주석 안의 예시 SQL 을 정책으로 세지 않습니다. 이 파일들은 「이렇게 적으면 안 된다」를
  // 주석으로 설명하는 일이 잦습니다.
  const sql = raw.replace(/--[^\n]*/g, "");

  // `create policy ... ;` 한 덩이씩. 줄바꿈이 섞여 있어 세미콜론까지 모아 봅니다.
  for (const m of sql.matchAll(/create\s+policy\s+([\s\S]*?);/gi)) {
    const body = m[1];
    if (!/using\s*\(\s*true\s*\)/i.test(body)) continue;
    // 역할을 적었으면 anon 은 안 들어옵니다. `to anon` 이라고 적었다면 그건 일부러 연 것이니
    // 이유를 적게 합니다.
    if (/\bto\s+(authenticated|service_role)\b/i.test(body) && !/\bto\s+[^\n]*\banon\b/i.test(body)) continue;
    const name = (body.match(/^\s*(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/i) ?? [])[1] ?? "(이름 못 읽음)";
    bad.push({ f, name });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 모두에게 열린 정책이 있습니다 (로그인 안 한 사람도 들어옵니다).\n");
  for (const b of bad) console.error(`  ${b.name}\t(${b.f})`);
  console.error(`
  \`using (true)\` 에 역할을 안 적으면 **모든 역할**에 적용됩니다 - \`anon\` 까지입니다.
  주소만 알면 로그인 없이 그 표를 통째로 읽어갑니다.

  고치는 법 — 둘 중 하나입니다.

    create policy 이름 on public.표 for all to authenticated
      using (public.is_giamicro_user()) with check (public.is_giamicro_user());

    create policy 이름 on public.표 for select to authenticated using (true);

  정말 아무나 읽어도 되는 자리라면 그 파일에 \`-- open-policy-ok: 이유\` 를 적어주세요.
`);
  process.exit(1);
}

console.log("✓ 열린 정책 검사 통과 (로그인 안 한 사람이 들어오는 정책이 없습니다)");
