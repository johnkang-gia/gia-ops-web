#!/usr/bin/env node
/**
 * **읽어놓고 안 쓰는 조회**를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 중앙 대시보드가 구글챗 메시지 14일치 300건의 **본문을 통째로** 읽고 있었습니다.
 * 그런데 그걸 파싱하던 코드는 이미 다른 곳으로 옮겨져서, **읽어놓고 아무 데도 안 쓰고
 * 버렸습니다.**
 *
 * 이 화면은 30초마다 스스로 다시 물어봅니다. 하루 1,500번 넘게 쓰지도 않을 메시지를
 * 실어 날랐고, 그게 Supabase 무료 한도(월 5GB)를 거의 통째로 먹었습니다.
 *
 * **안 쓰는 조회는 느려지는 것으로도 안 보이고 오류로도 안 보입니다.** 화면은 멀쩡하게
 * 뜹니다. 청구서에만 보이고, 청구서는 한 달에 한 번 봅니다.
 *
 * ── 무엇을 보나 ──────────────────────────────────────────────────────
 *
 * `const { data: 이름 } = await supabase...` 로 받아놓고 그 이름을 **한 번도 안 쓰는**
 * 자리를 찾습니다. 코드를 옮기다 조회만 남는 것이 이 실수의 모양입니다.
 *
 * 정말 부작용만 노린 조회라면(있는지 확인만 하는 등) `// query-ok: 이유` 를 적습니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/app/api", "src/lib"];
const ALLOW = "query-ok:";

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("supabase")) continue;
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      // `const { data: 이름 }` · `const { data: 이름, error: ... }`
      const m = lines[i].match(/const\s*\{\s*data:\s*([A-Za-z_$][\w$]*)/);
      if (!m) continue;
      const name = m[1];
      // 밑줄로 시작하면 「일부러 안 쓴다」는 표시입니다.
      if (name.startsWith("_")) continue;

      const around = lines.slice(Math.max(0, i - 4), i + 2).join("\n");
      if (around.includes(ALLOW)) continue;

      // 이름이 이 파일에서 몇 번 나오는가. 선언 한 번뿐이면 안 쓰는 것입니다.
      const uses = text.match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
      if (uses <= 1) problems.push(`${file}:${i + 1}  ${name}`);
    }
  }
}

if (problems.length > 0) {
  console.error("\n✗ 읽어놓고 안 쓰는 조회가 있습니다.\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(`
   조회는 돈이 듭니다. 30초마다 도는 화면이라면 하루 1,500번입니다.
   안 쓰는 조회는 화면이 느려지는 것으로도 오류로도 안 보이고, 청구서에만 보입니다.

   · 안 쓰면 → 지웁니다.
   · 부작용만 노린 것이면 → 그 줄 근처에 「// query-ok: 이유」 를 적습니다.
   · 일부러 안 받는 것이면 → 이름 앞에 밑줄을 붙입니다(_unused).
`);
  process.exit(1);
}

console.log("✓ 조회 사용 검사 통과 (읽은 것을 모두 씁니다)");
