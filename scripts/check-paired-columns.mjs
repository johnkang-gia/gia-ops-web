#!/usr/bin/env node
/**
 * **짝지어 저장해야 하는 칸**을 한쪽만 쓰고 있지 않은지 검사합니다.
 *
 * 같은 사실이 두 칸에 나뉘어 있는 자리가 있습니다. 학생의 반이 그렇습니다.
 *
 *   · `class_name` — 반 이름(글자). 화면 대부분이 이걸 읽어 보여줍니다
 *   · `class_id`   — 반 연결. 반 배정·시간표·교실 태블릿·담임 판정이 이걸 읽습니다
 *
 * 쓰는 곳에서 **한쪽만** 채우면 화면에는 반 이름이 잘 보이는데 배정은 안 됩니다. 오류가
 * 아니라 «되어 보이는 것»이라 아무도 못 찾습니다 - 반 배정 화면에 가서야 「이 아이가
 * 미배정에 있네」를 발견합니다. 실제로 학생 추가와 구글시트 반영 두 곳이 그랬습니다.
 *
 * 두 칸을 하나로 합치지 않는 이유: 이름은 화면에 그대로 쓰이고(조인 없이 목록을 그립니다),
 * 연결은 반이 바뀌어도 따라갑니다. 둘 다 쓸모가 있어서 남겨두되, **함께 쓰기**를 강제합니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 짝. 왼쪽을 쓰면 오른쪽도 같은 객체 안에 있어야 합니다.
 *
 * **표까지 함께 적습니다.** `wr_classes` 에서는 `class_name` 이 주인공이라 연결이 없는 게
 * 맞습니다 - 표를 안 보면 그런 자리까지 걸려서, 자꾸 헛걸리는 검사기는 사람이 무시하게
 * 되고 무시당하는 검사기는 없는 것과 같습니다.
 */
const PAIRS = [
  { table: "wr_students", a: "class_name", b: "class_id", why: "반 이름만 쓰면 반 배정이 안 됩니다" },
];

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
  const src = readFileSync(file, "utf8");
  if (src.includes("paired-ok")) continue;

  // `.insert({...})` · `.update({...})` 의 중괄호 안만 봅니다. 읽기(select)는 상관없습니다.
  for (const m of src.matchAll(/from\(\s*["'`]([a-z_]+)["'`]\s*\)([\s\S]{0,300}?)\.(insert|update|upsert)\(\s*\{([\s\S]{0,900}?)\}\s*\)/g)) {
    const table = m[1];
    const body = m[4];
    for (const p of PAIRS) {
      if (table !== p.table) continue;
      // `class_name:` 처럼 **값을 넣는 자리**만 셉니다. 타입 선언은 여기 안 걸립니다.
      if (!new RegExp(`\\b${p.a}\\s*:`).test(body)) continue;
      if (new RegExp(`\\b${p.b}\\s*:`).test(body)) continue;
      // `...assignClass(...)` 처럼 펼쳐 넣은 경우는 짝이 함께 들어갑니다.
      if (/\.\.\./.test(body)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      bad.push({ file, line, pair: p });
    }
  }
}

if (bad.length > 0) {
  console.error("\n✗ 짝지어 써야 하는 칸을 한쪽만 쓰고 있습니다.\n");
  for (const b of bad) {
    console.error(`  ${b.file}:${b.line}`);
    console.error(`    ${b.pair.a} 만 있고 ${b.pair.b} 가 없습니다 — ${b.pair.why}`);
  }
  console.error("\n  고치는 법: @/lib/classAssign 의 assignClass() 결과를 펼쳐 넣으세요.");
  console.error("    .insert({ name, ...assignClass(className, classes, grade) })");
  console.error("  정말 한쪽만 써야 하는 자리면 파일에 // paired-ok: 이유 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 짝 칸 검사 통과 (반 이름과 반 연결이 함께 저장됩니다)");
