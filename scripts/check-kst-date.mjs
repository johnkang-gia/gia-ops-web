#!/usr/bin/env node
/**
 * **서버에서 「오늘」을 그 기계의 시간대로 만들지 않았는가.**
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────────────────────
 *
 * 서버는 UTC로 돕니다. 한국 시각 오전 9시 이전에는 UTC로 아직 어제라, 서버가
 * `d.getFullYear()/getMonth()/getDate()` 나 `toISOString().slice(0,10)` 로 만든 날짜는
 * **하루 전**이 됩니다.
 *
 * 실제로 났습니다 - 아침 8시 48분에 운영 대시보드를 열면 제목은 9월 11일인데 픽업 목록은
 * 9월 10일 것이 떠 있었습니다. 어제 픽업이던 아이 여덟 명이 오늘 픽업으로 보였고, 인박스와
 * 숫자가 달랐습니다. 화면에는 오류가 아니라 **그냥 다른 명단**으로 보입니다.
 *
 * 같은 종류의 실수를 이미 네 번 고쳤습니다(출결 등록 · GPS 출발 판정 · 도착체크 · 대시보드
 * 픽업). 네 번 났으면 다섯 번째도 납니다. 그래서 사람의 기억이 아니라 검사로 막습니다.
 *
 * ── 무엇을 보나 ────────────────────────────────────────────────────────────
 *
 * **서버에서 도는 코드만** 봅니다. 브라우저는 학교 컴퓨터라 시간대가 한국이고, 거기서는
 * 로컬 시간이 곧 한국 시간입니다. `"use client"` 가 붙은 파일은 건너뜁니다.
 *
 * 고치는 법: `src/lib/kst.ts` 의 `todayKst()` · `kstDate()` · `kstDateOffset()` 을 씁니다.
 * 정말 로컬 시간이 맞는 자리라면 그 줄 위에 `// kst-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * **좁게 봅니다.** 넓게 잡으면 「90일 전」 같은 기간 자르기까지 걸리는데 그건 시각 비교라
 * 맞는 코드입니다. 헛걸리는 검사는 사람이 무시하게 되고, 무시당하는 검사는 없는 것과
 * 같습니다(CLAUDE.md §1). 그래서 **「지금」을 날짜로 굳히는 두 모양**만 봅니다.
 */
/** `new Date().toISOString().slice(0,10)` — 지금의 UTC 날짜. CLAUDE.md §4가 이미 금지한 모양. */
const UTC_NOW_KEY = /new Date\(\s*\)\s*\.\s*toISOString\(\)\s*\.\s*slice\(\s*0\s*,\s*10\s*\)/;
/**
 * `${d.getFullYear()}-${...getMonth()+1}-${...getDate()}` — 그 기계의 시간대로 **글자 날짜**를
 * 만드는 자리. `new Date(y, m, d)` 처럼 날짜를 계산하는 것은 걸지 않습니다 - 그건 시각을
 * 옮기는 일이지 날짜 열쇠를 굳히는 일이 아닙니다.
 */
const LOCAL_KEY = /\$\{[^\n]{0,40}getFullYear\(\)[^\n]{0,140}getMonth\(\)[^\n]{0,140}getDate\(\)/;

const found = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, "utf8");
  // 브라우저에서 도는 파일은 로컬 시간이 곧 한국 시간입니다.
  if (/^\s*["']use client["']/m.test(text)) continue;
  // 시간대를 다루는 그 파일 자신은 뺍니다.
  if (file.endsWith("src/lib/kst.ts")) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hit = UTC_NOW_KEY.test(line) || LOCAL_KEY.test(line);
    if (!hit) continue;
    // 바로 위 세 줄 안에 면제 주석이 있으면 넘어갑니다.
    const above = lines.slice(Math.max(0, i - 3), i).join("\n");
    if (/kst-ok:/.test(above) || /kst-ok:/.test(line)) continue;
    found.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
  }
}

if (found.length > 0) {
  console.error("✗ 서버에서 「오늘」을 그 기계의 시간대로 만들고 있습니다.\n");
  for (const f of found) console.error(`  ${f}`);
  console.error(
    "\n  서버는 UTC로 돕니다. 한국 시각 오전 9시 이전에는 하루 전 날짜가 나오고," +
      "\n  화면에는 오류가 아니라 «어제 명단»으로 보입니다." +
      "\n\n  고치는 법: src/lib/kst.ts 의 todayKst() · kstDate() · kstDateOffset() 를 쓰세요." +
      "\n  정말 로컬 시간이 맞는 자리라면 그 줄 위에 `// kst-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}

console.log("✓ 한국 날짜 검사 통과 (서버가 「오늘」을 한국 기준으로 셉니다)");
