#!/usr/bin/env node
/**
 * 재무 화면의 **말 통일** 검사.
 *
 * 같은 것을 화면마다 다르게 불렀습니다 - 「미발행 / 남은 항목 발행 / 미청구」, 「미수금 / 미수 / 잔액」,
 * 「인보이스 / 청구서」, 「부분납 / 일부 받음 / 일부수납」, 「미신청 / 등록 안 함」. 실무자는 말이 다르면 다른
 * 상태로 읽고, 가이드 검색은 한 말로만 찾습니다. 그래서 재무 화면에 **보이는 글자**는 아래 한 벌만 씁니다.
 *
 *   미청구 · 청구됨 · 일부수납 · 완납 · 연체 · 보류 / 청구서 · 발행 · 수납 · 잔액 · 추가 · 직접 기입 · 청구 주기 · 등록 안 함
 *
 * 주석·식별자·DB 값(`settlement.ts` 의 "부분납부" 같은 상태 글자)은 검사하지 않습니다 - 글자 리터럴과 JSX
 * 본문만 봅니다. 정말 써야 하면 그 줄 위에 `// term-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components/finance", "src/app/(dashboard)/finance"];
const BANNED = [
  [/인보이스/, "청구서"],
  [/미발행/, "미청구"],
  [/미수금/, "잔액"],
  [/(?<![가-힣])미수(?![가-힣])/, "잔액"],
  [/부분납(?!부")/, "일부수납"],
  [/일부 ?받음/, "일부수납"],
  [/입금완료|납부완료/, "완납"],
  [/미신청/, "등록 안 함"],
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
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inBlock = false;
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const t = raw.trim();
      // 블록 주석·줄 주석·JSX 주석은 건너뜁니다. 설명 글에는 옛 말이 «왜 바꿨는지» 적혀 있어야 합니다.
      if (inBlock) { if (t.includes("*/")) inBlock = false; continue; }
      if (t.startsWith("/*") || t.startsWith("{/*")) { if (!t.includes("*/")) inBlock = true; continue; }
      if (t.startsWith("//") || t.startsWith("*")) continue;
      if (i > 0 && /term-ok:/.test(lines[i - 1])) continue;
      // 글자 리터럴과 JSX 본문만. 식별자(변수·칸 이름)는 한글이 아니라 걸리지 않습니다.
      const code = raw.replace(/\/\/.*$/, "");
      for (const [re, use] of BANNED) {
        if (re.test(code)) bad.push(`${file}:${i + 1}  「${code.match(re)[0]}」 → 「${use}」`);
      }
    }
  }
}

if (bad.length) {
  console.error("\n✗ 재무 화면에 통일하지 않은 말이 있습니다.\n");
  for (const b of bad) console.error("  " + b);
  console.error("\n  미청구·청구됨·일부수납·완납 / 청구서·발행·수납·잔액 / 등록 안 함 으로 적으세요. 정말 써야 하면 윗줄에 // term-ok: 이유\n");
  process.exit(1);
}
console.log("✓ 재무 말 통일 검사 통과");
