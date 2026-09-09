#!/usr/bin/env node
/**
 * 「오늘 이 차를 타는 아이」를 **요일만 보고 정하는 코드**를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 하원 체크표는 오늘 안 타는 아이도 옅은 회색으로 띄워 두고, 눌러서 「탑승」으로 바꿀 수
 * 있게 만들어져 있습니다. "오늘만 태워 주세요" 연락이 오면 직원이 거기서 바꿉니다.
 *
 * 그런데 명단을 그리는 다른 화면들은 `weekdays.includes(오늘)` 로 **먼저** 거른 다음에야
 * 체크표를 읽었습니다. 요일이 안 맞는 아이는 이미 걸러진 뒤라 체크표를 읽어보지도
 * 않습니다. 그래서 직원이 탑승으로 바꾼 아이가 차량 도착·출발 체크, 안내보드, 기사님
 * 체크인에 **아예 없었습니다.**
 *
 * 빨간 줄이 뜨지 않습니다. 그냥 명단에 없습니다 - 태울 사람이 없다는 사실을 아무도
 * 모른 채 차가 출발합니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 이 판단은 `src/lib/ridesToday.ts` 의 `ridesToday` / `ridingIds` 한 곳에서만 합니다.
 * 정말 요일만 봐야 하는 자리(요일별 배정을 편집하는 화면 같은 곳)라면 그 줄 근처에
 * `// rides-ok: 이유` 를 적습니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ALLOW = "rides-ok:";
const SKIP_FILES = new Set(["src/lib/ridesToday.ts"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  if (SKIP_FILES.has(file)) continue;
  const text = readFileSync(file, "utf8");
  // 체크표(shuttle_boardings)를 함께 다루는 자리만 봅니다. 요일별 배정을 편집만 하는
  // 화면은 오늘 명단을 그리지 않으므로 이 규칙의 대상이 아닙니다.
  if (!text.includes("shuttle_boardings")) continue;
  if (text.includes("ridesToday") || text.includes("ridingIds")) continue; // 한 곳을 지나갑니다

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // `weekdays` 로 오늘 명단을 거르는 자리.
    if (!/weekdays[^\n]*\.includes\(/.test(lines[i])) continue;
    const around = lines.slice(Math.max(0, i - 6), i + 6).join("\n");
    if (around.includes(ALLOW)) continue;
    problems.push(`${file}:${i + 1}`);
  }
}

if (problems.length > 0) {
  console.error("\n✗ 오늘 명단을 요일만 보고 정하는 자리가 있습니다.\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(`
   체크표에서 「탑승」으로 바꾼 아이가 이 화면에 안 나타납니다.
   판단은 src/lib/ridesToday.ts 하나만 씁니다 - 체크표를 **먼저** 읽고 명단을 정합니다.

       import { ridesToday } from "@/lib/ridesToday";
       const relevant = ridesToday(assignments, boardings, todayWeekday);

   정말 요일만 봐야 하면 그 줄 근처에 「// rides-ok: 이유」 를 적어주세요.
   명단에 없는 아이는 오류로 안 보입니다 - 그냥 아무도 안 태웁니다.
`);
  process.exit(1);
}

console.log("✓ 오늘 명단 검사 통과 (체크표에서 바꾼 것이 모든 화면에 반영됩니다)");
