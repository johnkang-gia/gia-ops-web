#!/usr/bin/env node
/**
 * **저장된 시각(timestamptz)의 앞 열 글자를 날짜로 쓰지 않았는가.**
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────────────────────
 *
 * `received_at` · `created_at` 같은 시각은 세계표준시로 저장됩니다. 한국 아침 9시 전에 온
 * 연락은 저장된 글자가 **어제 날짜로 시작**합니다(2026-09-30T23:39:57Z = 10월 1일 08:39).
 * `.slice(0, 10)` 으로 날짜를 뽑으면 그 연락은 어제 것이 되고, 화면은 「오늘 온 연락이
 * 아닙니다」라고 틀린 말을 합니다. 오류가 아니라 **그럴듯한 다른 날짜**라 아무도 의심하지
 * 않습니다. 하원 체크표에서 실제로 났고, 같은 꼴이 열세 파일에 더 있었습니다.
 *
 * `check-kst-date` 가 「지금」을 만드는 자리를 보는 것이라면, 이 검사는 **저장된 시각을
 * 날짜로 바꾸는 자리**를 봅니다. 브라우저에서도 똑같이 틀립니다 - 글자를 자르는 데는
 * 시간대가 끼어들 틈이 없습니다.
 *
 * 고치는 법: `kstDate(value)` 를 씁니다. 글자 자체가 날짜(YYYY-MM-DD)인 칸(`service_date` ·
 * `date` · `due_date`)은 해당 없고, 이 검사도 `_at` · `At` 로 끝나는 이름만 봅니다.
 * 정말 자르는 것이 맞는 자리라면 그 줄 위에 `// utc-slice-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const RE = /\b[\w.?]*(?:_at|At)\??\.slice\(\s*0\s*,\s*10\s*\)/;
const bad = [];
for (const f of walk("src")) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!RE.test(line)) return;
    if (/utc-slice-ok:/.test(line) || /utc-slice-ok:/.test(lines[i - 1] ?? "")) return;
    bad.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}

if (bad.length) {
  console.error("\n✗ 저장된 시각의 앞 열 글자를 날짜로 쓰는 자리가 있습니다 — 아침 9시 전 시각은 어제 날짜가 됩니다.\n");
  for (const b of bad) console.error("   " + b);
  console.error("\n  고치는 법: kstDate(값) 을 씁니다(src/lib/kst.ts). 정말 자르는 것이 맞으면 그 줄 위에 // utc-slice-ok: 이유 를 적습니다.\n");
  process.exit(1);
}
console.log("✓ 시각→날짜 검사 통과 (저장된 시각을 한국 날짜로 바꿔 씁니다)");
