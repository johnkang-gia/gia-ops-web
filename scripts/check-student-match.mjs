#!/usr/bin/env node
/**
 * 이름을 명부에 이으면서 **가르쳐 둔 별칭을 안 보는 코드**를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 출결 인박스에는 🔎 「가르치기」가 있습니다. 「마야 = 김마야」를 한 번 알려주면 표에
 * 남습니다. 그런데 픽업 쪽은 그 표를 읽지 않았습니다 - 같은 아이를 같은 표기로 몇 번을
 * 가르쳐도 픽업에서는 매번 처음 보는 이름이었습니다.
 *
 * 가르치는 사람 입장에서는 «가르쳐도 안 되는 기능»이고, 그런 기능은 곧 안 쓰게 됩니다.
 * 그러면 자동으로 붙는 이름은 영영 안 늘어납니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 서버에서 이름을 잇는 일은 `src/lib/studentMatch.ts` 의 `resolveStudent` 를 씁니다.
 * 별칭·성 뺀 이름·못 붙인 이유를 그 함수가 함께 다룹니다.
 *
 * 화면(클라이언트)에서 이미 붙은 이름을 다시 보여주기만 하는 자리처럼 정말 예외라면
 * `// match-ok: 이유` 를 적습니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ALLOW = "match-ok:";
const SKIP_FILES = new Set(["src/lib/studentMatch.ts", "src/lib/pickupParse.ts"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(file)) continue;
  const text = readFileSync(file, "utf8");
  // `pickupParse` 의 `matchStudent` 를 쓰는 파일만 봅니다. 사진 파일 이름을 아이에게
  // 잇는 `passportPhoto.ts` 에도 같은 이름의 함수가 있는데, 그건 전혀 다른 일입니다 -
  // 이름이 같다고 같은 규칙을 씌우면 검사기가 헛걸리고, 헛걸리는 검사기는 무시당합니다.
  if (!/from "@\/lib\/pickupParse"/.test(text)) continue;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/\bmatchStudent\s*\(/.test(lines[i])) continue;
    const around = lines.slice(Math.max(0, i - 8), i + 4).join("\n");
    if (around.includes(ALLOW)) continue;
    problems.push(`${file}:${i + 1}`);
  }
}

if (problems.length > 0) {
  console.error("\n✗ 가르쳐 둔 별칭을 보지 않고 이름을 잇는 자리가 있습니다.\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(`
   이름 잇기는 src/lib/studentMatch.ts 의 resolveStudent 를 씁니다.
   별칭·성 뺀 이름(「예온이」→ 이예온)·못 붙인 이유를 함께 다룹니다.

       import { resolveStudent } from "@/lib/studentMatch";
       import { loadAliasIndex } from "@/lib/aliasIndex";
       const aliases = await loadAliasIndex(supabase, roster);
       const { student, why, note, candidates } = resolveStudent(name, roster, { context: text, aliases });

   정말 예외라면 그 줄 근처에 「// match-ok: 이유」 를 적어주세요.
   가르쳐도 안 붙으면, 사람은 가르치기를 그만둡니다.
`);
  process.exit(1);
}

console.log("✓ 이름 잇기 검사 통과 (가르친 별칭이 모든 자리에 적용됩니다)");
