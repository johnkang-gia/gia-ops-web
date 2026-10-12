#!/usr/bin/env node
/**
 * **이름으로 만든 표에서 꺼내는 자리**를 막습니다(CLAUDE.md 2-4-6).
 *
 * ── 왜 ───────────────────────────────────────────────────────────────────
 *
 * 동명이인 사고가 여섯 번 났습니다. 가르는 규칙은 매번 멀쩡했고, 사고는 언제나 화면이
 * `Map<이름, 무엇>` 을 스스로 만들고 `.get(이름)` 으로 꺼낸 자리에서 났습니다. 김재이가 셋이라
 * 그 표의 한 칸을 셋이 나눠 쓰고, 결과는 오류가 아니라 «적혀 있는 값»으로 보입니다.
 *
 * 앞의 검사(check-homonym)는 «가릴 재료를 하나도 안 들고 있는 파일»을 찾았습니다. 그런데 이번
 * 하원 체크표는 학생 번호를 들고 있었습니다 - 번호로 찾고, **못 찾으면 이름으로** 찾았습니다.
 * 재료를 들고 있어도 이름 길이 열려 있으면 같은 사고가 납니다. 그래서 이제 모양 자체를 봅니다.
 *
 * ── 무엇을 보나 ──────────────────────────────────────────────────────────
 *
 * 이름이 `…ByName` · `…byName` · `…NameMap` · `…ByNorm` 인 것에서 `.get(` 으로 꺼내는 줄.
 * 학생을 짝짓는 일은 `src/lib/studentKey.ts` 의 `StudentIndex` 로 합니다(번호 먼저, 이름은 명부에
 * 한 명뿐일 때만). 학생이 아닌 것(항목 이름 등)이거나 후보 목록을 꺼내 따로 좁히는 자리라면
 * 그 줄이나 바로 위 줄에 `// name-lookup-ok: 이유` 를 적습니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HOME = "src/lib/studentKey.ts";
const PATTERN = /\b\w*(?:ByName|byName|NameMap|ByNorm|byNorm)\w*\.get\(/;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const bad = [];
for (const file of walk("src")) {
  if (file.replace(/\\/g, "/") === HOME) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!PATTERN.test(line)) return;
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const near = [lines[i - 2] ?? "", lines[i - 1] ?? "", line].join("\n");
    if (/name-lookup-ok:/.test(near)) return;
    bad.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}

if (bad.length > 0) {
  console.error("\n✗ 이름으로 만든 표에서 학생을 꺼내는 자리가 있습니다.\n");
  for (const b of bad) console.error("   " + b);
  console.error(
    "\n  김재이가 셋입니다. 이름 표의 한 칸을 셋이 나눠 쓰고, 그 결과는 오류가 아니라 «적힌 값»으로 보입니다." +
      "\n\n  고치는 법 — src/lib/studentKey.ts 의 StudentIndex 로 짝짓습니다(add(번호, 이름, 값) → find(번호, 이름))." +
      "\n  학생이 아니거나 후보 목록을 꺼내 따로 좁히는 자리라면 `// name-lookup-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}
console.log("✓ 이름 표 검사 통과 (학생 짝짓기는 모두 번호 우선 규칙을 지납니다)");
