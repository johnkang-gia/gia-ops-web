#!/usr/bin/env node
/**
 * **백업에서 빠진 표를 찾습니다.**
 *
 * 백업의 가장 나쁜 실패는 «안 되는 것»이 아니라 «되는 줄 알았는데 그 표만 없는 것»입니다.
 * 새 표를 만들 때는 백업 생각이 안 나고, 백업은 사고가 난 다음에야 열어봅니다. 그때
 * 비어 있으면 이미 늦습니다.
 *
 * 그래서 코드가 실제로 쓰는 표(`from("...")`)를 전부 긁어, `src/lib/backupTables.ts` 의
 * 담는 목록에도 없고 안 담는 이유에도 없는 것을 찾아 빌드를 멈춥니다.
 *
 * 고치는 법은 둘 중 하나입니다.
 *   · 담아야 하면  → BACKUP_GROUPS 의 알맞은 묶음에 표 이름을 넣습니다.
 *   · 안 담아도 되면 → BACKUP_SKIP 에 **이유와 함께** 적습니다.
 *
 * 이유를 적게 하는 것이 요점입니다. 빼는 것은 쉬워야 하지만, 왜 뺐는지는 남아야 합니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "src";
const LIST = "src/lib/backupTables.ts";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const listSrc = readFileSync(LIST, "utf8");

// 담는 목록: BACKUP_GROUPS 안의 문자열 전부.
const groupsBlock = listSrc.slice(listSrc.indexOf("BACKUP_GROUPS"), listSrc.indexOf("export const BACKUP_TABLES"));
const covered = new Set([...groupsBlock.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

// 안 담는 목록: BACKUP_SKIP 의 열쇠.
const skipBlock = listSrc.slice(listSrc.indexOf("BACKUP_SKIP"), listSrc.indexOf("export function backupCoverage"));
const skipped = new Set([...skipBlock.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));

// 코드가 쓰는 표.
const used = new Map(); // 표 이름 → 처음 본 파일
for (const file of walk(SRC)) {
  // 목록 파일 자신은 세지 않습니다.
  if (file.replace(/\\/g, "/") === LIST) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\.from\("([a-z_]+)"\)/g)) {
    if (!used.has(m[1])) used.set(m[1], file);
  }
}

const missing = [...used.entries()].filter(([t]) => !covered.has(t) && !skipped.has(t));

if (missing.length > 0) {
  console.error("\n✗ 백업 목록에 없는 표가 있습니다.\n");
  for (const [table, file] of missing) {
    console.error(`  ${table}  (${file})`);
  }
  console.error(`
  고치는 법 — ${LIST} 에서 둘 중 하나를 하세요.

    · 백업에 담아야 하면  → BACKUP_GROUPS 의 알맞은 묶음에 표 이름을 넣습니다.
    · 안 담아도 되면      → BACKUP_SKIP 에 이유와 함께 적습니다.

  백업에서 빠진 표는 빠진 줄도 모르는 채로 몇 달 갑니다. 사고가 난 다음에 열어보면
  이미 늦습니다.
`);
  process.exit(1);
}

// 반대 방향도 봅니다: **어디에도 없는 이름**을 적어둔 경우.
//
// 표 이름을 잘못 적으면 백업은 그 표를 조용히 건너뛰고 아무 오류도 안 냅니다 - 담았다고
// 믿는 표가 사실은 안 담긴 상태가 됩니다.
//
// 「코드가 안 쓴다」만으로는 판단하지 않습니다. 화면에서 안 읽는 표라도 마이그레이션으로
// 만들어져 자료가 들어 있을 수 있고, 그런 표야말로 아무도 안 보는 사이 사라집니다.
// 그래서 **코드에도 없고 마이그레이션에도 없는** 이름만 잘못으로 봅니다.
const migrated = new Set();
for (const f of readdirSync("supabase/migrations")) {
  if (!f.endsWith(".sql")) continue;
  const sql = readFileSync(join("supabase/migrations", f), "utf8");
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) migrated.add(m[1]);
}
const ghosts = [...covered].filter((t) => !used.has(t) && !migrated.has(t));
if (ghosts.length > 0) {
  console.error("\n✗ 백업 목록에 있는데 실제로는 없는 표 이름이 있습니다.\n");
  console.error(`  ${ghosts.join(", ")}\n`);
  console.error(`  코드에도 없고 마이그레이션에도 없는 이름입니다 - 오타일 가능성이 큽니다.
  잘못 적힌 이름은 백업이 조용히 건너뛰고 오류도 안 냅니다.
  이름을 고치거나, 정말 없는 표라면 목록에서 빼주세요.\n`);
  process.exit(1);
}

console.log(`✓ 백업 목록 검사 통과 (담음 ${covered.size}개 · 이유 적고 뺌 ${skipped.size}개)`);
