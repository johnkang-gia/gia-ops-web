#!/usr/bin/env node
/**
 * 명부(wr_students)를 **직접 읽는** 자리를 찾습니다.
 *
 * 명부를 읽는 함수는 `src/lib/students.ts` 하나입니다(CLAUDE.md 2-4-5). 화면이 직접
 * `from("wr_students").select(...)` 를 쓰면 칸 조합이 다시 늘어나고, 동명이인을 가르는 칸이나
 * `is_demo` 를 빠뜨리는 사고가 다시 납니다. 그 사고는 오류로 안 보입니다 - 그냥 「김재이」로 뜨거나
 * 연습용 학생이 명단에 섞입니다.
 *
 * 허용하는 것:
 *   · 넣기·고치기(insert/update/upsert/delete) - 읽는 자리가 아닙니다
 *   · 세기(`{ count: "exact", head: true }`) - 줄을 돌려받지 않습니다
 *   · 바로 위 줄 또는 같은 줄에 `// students-ok: 이유` 가 있는 자리
 *   · src/lib/students.ts 자신, 주석 안의 예시
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
  if (file.endsWith("src/lib/students.ts")) continue;
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  for (const m of src.matchAll(/from\(\s*["']wr_students["']\s*\)/g)) {
    const lineNo = src.slice(0, m.index).split("\n").length;
    const line = lines[lineNo - 1] ?? "";
    const prev = lines[lineNo - 2] ?? "";
    // 주석 안의 예시(`* const { data } = ...`)는 코드가 아닙니다.
    if (/^\s*(\*|\/\/)/.test(line)) continue;
    if (/students-ok:/.test(line) || /students-ok:/.test(prev)) continue;
    // 그 호출 체인에서 무엇을 하는지 봅니다. 400자면 체인 하나를 넉넉히 덮습니다.
    const chain = src.slice(m.index, m.index + 400);
    if (/\.(insert|update|upsert|delete)\(/.test(chain.split(/\n\s*\n/)[0])) continue;
    if (/head:\s*true/.test(chain)) continue;
    bad.push({ file, line: lineNo, what: line.trim().slice(0, 90) });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 명부를 직접 읽는 자리가 있습니다.\n");
  console.error("  명부는 @/lib/students 의 loadStudents · loadStudentsWithPhones · loadStudentsFull · loadStudent 로 읽습니다.");
  console.error("  직접 읽으면 동명이인을 가르는 칸(class_name · birth_date)이나 is_demo 를 빠뜨리는 사고가 다시 납니다.\n");
  for (const b of bad) console.error(`  ${b.file}:${b.line}\n    ${b.what}`);
  console.error("\n  정말 직접 읽어야 하면 그 줄 위에 // students-ok: 이유 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 명부 읽기 검사 통과 (명부는 loadStudents 로만 읽습니다)");
