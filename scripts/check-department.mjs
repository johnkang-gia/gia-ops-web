// 부서(초등부/중고등부) 판정을 화면마다 다시 만들지 않게 하는 검사.
//
// 학교가 기준을 바꿨습니다 - **6학년은 중고등부입니다.** 그런데 판정이 세 곳에 흩어져 있어서
// 한 곳만 고치고 나머지를 잊었고, 학생 조회에서는 6학년이 계속 초등부로 나왔습니다.
// 화면마다 다른 답이 나오면 어느 쪽이 맞는지 아무도 모릅니다.
//
// 규칙은 하나입니다: 판정은 `src/lib/department.ts` 의 `departmentOf` 만 씁니다.
// 여기서는 그 규칙을 스스로 다시 쓴 코드를 찾아냅니다.
//
// 정말 따로 판정해야 하는 자리라면 그 줄 바로 위에
//   // dept-ok: 이유
// 를 적으면 넘어갑니다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const OWNER = join("src", "lib", "department.ts");

// 학년 숫자로 부서를 가르는 모양들. 숫자는 바뀔 수 있으니 느슨하게 봅니다.
const PATTERNS = [
  { re: /(?:>=|>)\s*[5-9]\s*\?\s*"?중고등부/, why: "학년 숫자로 부서를 직접 가르고 있습니다" },
  { re: /"중고등부"\s*:\s*"초등부"/, why: "부서를 직접 고르고 있습니다" },
  { re: /num\s*>=\s*\d+\s*\)?\s*return\s*"중고등부"/, why: "학년 숫자로 부서를 직접 가르고 있습니다" },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  if (file === OWNER) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const above = lines.slice(Math.max(0, i - 2), i).join(" ");
    if (/dept-ok:/.test(above)) return;
    // departmentOf 를 부르면서 결과를 좁히는 것은 규칙을 다시 만든 것이 아닙니다.
    if (/departmentOf\(/.test(line)) return;
    for (const p of PATTERNS) {
      if (p.re.test(line)) problems.push({ file, lineNo: i + 1, why: p.why, snippet: line.trim().slice(0, 90) });
    }
  });
}

if (problems.length > 0) {
  console.error(`\n✗ 부서 판정 검사 실패 — 규칙을 다시 만든 곳 ${problems.length}곳\n`);
  console.error("  부서 판정은 src/lib/department.ts 의 departmentOf 하나만 씁니다.");
  console.error("  화면마다 따로 만들면 기준이 바뀔 때 한 곳만 고치고 나머지를 잊습니다.");
  console.error("  정말 따로 판정해야 한다면 바로 위 줄에  // dept-ok: 이유  를 적어주세요.\n");
  for (const p of problems) {
    console.error(`  ${p.file}:${p.lineNo}  ${p.why}`);
    console.error(`     ${p.snippet}`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ 부서 판정 검사 통과 (판정 규칙이 한 곳에만 있습니다)");
