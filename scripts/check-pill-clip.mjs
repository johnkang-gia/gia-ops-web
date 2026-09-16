// 가로로 흐르는 **단추 줄**은 안쪽에 여백이 있어야 합니다.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
//
// 켜진 탭·알약은 테두리를 `ring` 으로 그립니다. 링은 상자 **바깥**에 그려지는데, 그 줄이
// `overflow-x-auto` 면 바깥으로 나간 것을 잘라냅니다. 그래서 맨 앞(과 맨 뒤) 알약의 링
// 한 줄이 깎여 **잘린 것처럼** 보입니다 — 재무 화면의 「학비」 알약 왼쪽이 그랬습니다.
//
// 오류가 아니라 모양이 어긋난 것이라 아무도 신고하지 않고, 보는 사람은 화면이 깨진 줄
// 압니다. 같은 실수가 탭줄마다 되풀이되므로 기억이 아니라 검사로 막습니다.
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
//
// `flex` + `overflow-x-auto` 가 함께 있는 className 만 봅니다. 그런 줄은 **가로로 늘어놓은
// 단추 줄**입니다. 표를 감싸는 `overflow-x-auto` 는 flex 가 아니므로 걸리지 않습니다.
//
// 정말 여백을 두면 안 되는 자리라면 그 줄 위에 `// pill-clip-ok: 이유` 를 적습니다.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src"];
/** 가로 여백을 주는 클래스. 하나라도 있으면 링이 안 깎입니다. */
const PAD = /(^|\s)(p|px|pl|pr)-(\[|\d)/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const bad = [];
for (const file of ROOTS.flatMap((r) => walk(r))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!line.includes("overflow-x-auto")) return;
    if (!/\bflex\b/.test(line)) return; // 표를 감싼 자리는 보지 않습니다.
    if (PAD.test(line)) return;
    // 바로 위 두 줄에 면제 표시가 있으면 넘어갑니다.
    const around = [lines[i - 1] ?? "", lines[i - 2] ?? "", line].join(" ");
    if (around.includes("pill-clip-ok")) return;
    bad.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}

if (bad.length > 0) {
  console.error("\n✗ 가로로 흐르는 단추 줄에 안쪽 여백이 없습니다 — 켜진 알약의 링이 깎입니다.\n");
  for (const b of bad) console.error("   " + b);
  console.error(
    "\n  고치는 법: 그 줄의 className 에 px-0.5 (또는 px-2) 를 넣습니다." +
      "\n  정말 여백을 두면 안 되는 자리면 바로 위에 // pill-clip-ok: 이유 를 적습니다.\n",
  );
  process.exit(1);
}

console.log("✓ 가로 단추 줄 여백 검사 통과");
