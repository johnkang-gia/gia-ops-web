#!/usr/bin/env node
/**
 * **재무 화면이 청구서·입금을 잘라 읽는지** 봅니다.
 *
 * ── 왜 막나 ────────────────────────────────────────────────────────────────
 *
 * 학생 139명 × (학비 + 학비외) ≒ 월 278장입니다. `limit(500)` 은 두 달, `limit(1000)` 은
 * 넉 달이면 넘습니다.
 *
 * 넘어도 **오류가 나지 않습니다.** 개요의 「발행한 금액」이 조용히 줄고, 상습 미납에서
 * 오래된 사람이 빠지고, 수납 화면의 미대사 입금이 안 보입니다. 화면에는 그냥 다른
 * 숫자로 보이고, 그 숫자가 틀렸다는 사실은 어디에도 안 나타납니다.
 *
 * 한도를 올리는 것으로는 안 끝납니다 - 올린 한도도 언젠가 넘고, 넘는 날은 또 조용합니다.
 * `src/lib/financeFetch.ts` 의 `readAll()` 로 **끝까지** 읽습니다.
 *
 * ── 면제 ───────────────────────────────────────────────────────────────────
 *
 * 합계를 내지 않고 「최근 것 몇 개」만 보여주는 목록은 잘라도 됩니다. 그 줄 뒤에
 * `// finance-limit-ok: 이유` 를 적습니다. 빼는 것은 쉬워야 하지만 왜 뺐는지는 남아야
 * 합니다.
 */

import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** 잘라 읽으면 합계가 어긋나는 표. 여기 없는 표는 이 검사와 상관없습니다. */
const MONEY_TABLES = ["invoices", "payments", "invoice_lines"];

const files = globSync("src/app/(dashboard)/finance/**/*.tsx", { cwd: ROOT })
  .concat(globSync("src/app/api/finance/**/*.ts", { cwd: ROOT }));

const problems = [];

for (const rel of files) {
  const text = readFileSync(path.join(ROOT, rel), "utf8");
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes(".limit(")) continue;
    // 면제는 **같은 줄**에 적습니다. 윗줄에 두면 주석이 코드와 떨어져 옮겨 다닙니다.
    if (line.includes("finance-limit-ok:")) continue;

    // 그 `.limit(` 이 어느 표에 걸린 것인지 봅니다. 한 줄에 다 있는 경우와 여러 줄에
    // 걸쳐 이어 쓴 경우가 모두 있어, 앞쪽 여섯 줄까지 거슬러 올라가 `.from("…")` 을 찾습니다.
    let table = null;
    for (let j = i; j >= Math.max(0, i - 6); j -= 1) {
      const hit = lines[j].match(/\.from\("([a-z_]+)"\)/);
      if (hit) {
        table = hit[1];
        break;
      }
    }
    if (!table || !MONEY_TABLES.includes(table)) continue;

    problems.push({ file: rel, line: i + 1, table, text: line.trim() });
  }
}

if (problems.length > 0) {
  console.error("\n❌ 재무 화면이 돈에 관한 표를 잘라 읽고 있습니다.\n");
  for (const p of problems) {
    console.error(`   ${p.file}:${p.line}  (${p.table})`);
    console.error(`      ${p.text}`);
  }
  console.error(
    [
      "",
      "   한도를 넘는 순간 합계가 조용히 줄어듭니다 - 오류가 아니라 «다른 숫자»로 보입니다.",
      "",
      "   고치는 법: src/lib/financeFetch.ts 의 readAll() 로 끝까지 읽습니다.",
      "",
      '     const invRes = await readAll<Invoice>((from, to) =>',
      '       supabase.from("invoices").select("*").order("issue_date").order("id").range(from, to),',
      "     );",
      "",
      "   합계를 내지 않는 목록이라면 그 줄 뒤에 이유를 적으세요:",
      "     // finance-limit-ok: 최근 것만 보여주는 목록입니다. 합계를 내지 않습니다.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`✓ 재무 화면 ${files.length}개 — 돈에 관한 표를 잘라 읽는 곳이 없습니다.`);
