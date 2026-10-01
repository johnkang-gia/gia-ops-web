#!/usr/bin/env node
/**
 * 출결 등록표(attendance_entries)의 upsert 열쇠를 글자로 적은 자리를 찾습니다.
 *
 * 열쇠는 `src/lib/attendanceEntries.ts` 의 ATTENDANCE_ENTRY_KEY 하나입니다. 데이터베이스 유일
 * 인덱스에 날짜가 더해졌을 때(20261022) 일곱 군데 중 한 곳만 따라 바뀌었고, 나머지 여섯은 2주
 * 동안 42P10 으로 실패했습니다. 화면에는 「저장 실패」로만 보였습니다.
 *
 * 글자로 적으면 다음에 또 한 곳만 바뀝니다. 상수를 쓰면 바꿀 곳이 한 곳뿐입니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const bad = [];
for (const file of walk("src")) {
  if (file.endsWith("src/lib/attendanceEntries.ts")) continue;
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/onConflict:\s*["']source,\s*source_message_id[^"']*["']/g)) {
    const line = src.slice(0, m.index).split("\n").length;
    bad.push(`${file}:${line}  ${m[0]}`);
  }
}

if (bad.length) {
  console.error("\n✗ 출결 등록표의 upsert 열쇠를 글자로 적은 자리가 있습니다.\n");
  for (const b of bad) console.error("  " + b);
  console.error("\n  @/lib/attendanceEntries 의 ATTENDANCE_ENTRY_KEY 를 쓰세요. 열쇠가 바뀌면 한 곳만 고칩니다.\n");
  process.exit(1);
}
console.log("✓ 출결 열쇠 검사 통과 (upsert 열쇠가 한 곳에만 있습니다)");
