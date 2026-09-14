#!/usr/bin/env node
/**
 * **돈을 보여주는 화면인데 실시간으로 안 바뀌는 것**을 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 재무는 화면이 여덟 개이고, 한 사람이 고치면 여러 사람이 봅니다. 그런데 고친 사람 화면만
 * 바뀌었습니다. 옆자리에서 열어둔 화면은 **옛 금액을 그대로 보여줍니다.**
 *
 * 그건 오류로 안 보입니다 - 그냥 다른 숫자입니다. 그 숫자로 학부모에게 안내하거나 청구를
 * 돌리면, 어느 쪽이 맞는지는 돈이 두 번 청구된 뒤에야 드러납니다.
 *
 * 화면을 새로 만들 때 실시간 붙이는 것을 기억하는 방법은 없습니다. **기억이 아니라 검사로**
 * 지킵니다(CLAUDE.md 머리말).
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * `/finance/*` 아래 화면은 `useFinanceLive` 나 `<FinanceLive />` 중 하나를 지나가야 합니다.
 * 화면이 서버 컴포넌트면 `<FinanceLive />` 를, 클라이언트면 훅을 씁니다.
 *
 * 정말 실시간이 필요 없는 화면이면(인쇄본처럼 그 순간을 찍는 자리) 그 page.tsx 안에
 * `// finance-live-ok: 이유` 를 적습니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const ROOT = "src/app/(dashboard)/finance";
const ALLOW = "finance-live-ok:";
const USES = ["useFinanceLive", "FinanceLive"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

/**
 * 그 화면이 실시간을 지나가는가. **화면이 불러 쓰는 클라이언트까지 따라 들어갑니다** -
 * 대부분의 재무 화면은 서버가 자료만 읽어 클라이언트에 넘기고, 훅은 그 클라이언트에 있습니다.
 */
function reaches(file) {
  const src = readFileSync(file, "utf8");
  if (src.includes(ALLOW)) return true;
  if (USES.some((n) => src.includes(n))) return true;

  // `import XxxClient from "@/components/finance/XxxClient"` 를 따라갑니다.
  for (const m of src.matchAll(/from\s+"@\/components\/([^"]+)"/g)) {
    for (const ext of [".tsx", ".ts"]) {
      const dep = join("src/components", m[1] + ext);
      try {
        const depSrc = readFileSync(dep, "utf8");
        if (USES.some((n) => depSrc.includes(n))) return true;
      } catch {
        // 그런 파일이 없으면 그냥 다음 후보로 넘어갑니다.
      }
    }
  }
  return false;
}

let problems = [];
try {
  problems = walk(ROOT).filter((f) => !reaches(f));
} catch {
  // 재무 폴더가 없는 저장소에서도 빌드는 되어야 합니다.
  console.log("✓ 재무 실시간 검사 건너뜀 (재무 화면이 없습니다)");
  process.exit(0);
}

if (problems.length > 0) {
  console.error("\n✗ 돈을 보여주는데 실시간으로 안 바뀌는 화면이 있습니다.\n");
  for (const p of problems) console.error(`   ${p}   (${dirname(p)})`);
  console.error(`
   옆자리에서 열어둔 이 화면은 누가 금액을 고쳐도 옛 숫자를 그대로 보여줍니다.
   오류로 안 보이고 **그냥 다른 금액**이라, 그 숫자로 청구를 돌린 뒤에야 드러납니다.

       // 클라이언트 컴포넌트라면
       import { useFinanceLive } from "@/lib/useFinanceLive";
       useFinanceLive();

       // 서버 컴포넌트라면
       import FinanceLive from "@/components/finance/FinanceLive";
       <FinanceLive />

   그 순간을 찍는 화면(인쇄본 등)이면 page.tsx 안에 「// finance-live-ok: 이유」 를 적어주세요.
`);
  process.exit(1);
}

console.log("✓ 재무 실시간 검사 통과 (금액이 바뀌면 모든 재무 화면이 함께 바뀝니다)");
