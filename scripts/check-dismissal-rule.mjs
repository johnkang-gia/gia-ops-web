// 하원수단을 **읽는** 자리는 고르는 규칙을 다시 쓰지 않습니다.
//
// ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
//
// 하원수단 창에는 「오늘 하원 3명(한우영·민노엘·백서아)」인데 업무보드 「오늘 학생」에는
// 한우영 한 명만 떴습니다. 두 곳이 **다른 길로** 답을 냈기 때문입니다.
//
//   · 하원수단 창 — `student_dismissal_plans` 를 직접 읽고, 「매주 / 그 주만」 고르는 규칙을
//                   그 자리에서 손으로 한 번 더 썼습니다.
//   · 오늘 학생   — 그 표를 안 읽고, **아침 크론이 체크표에 만들어 준 줄**만 봤습니다.
//                   그래서 크론이 돈 뒤에 등록한 아이는 하루 종일 안 떴습니다.
//
// 어느 쪽도 오류를 내지 않습니다. 그냥 다른 명단을 냅니다. 픽업은 놓치면 되돌릴 수
// 없으므로, 이 어긋남은 사고로 이어집니다.
//
// ── 무엇을 보나 ─────────────────────────────────────────────────────────────
//
// `student_dismissal_plans` 를 **select 하는** 파일은 공용 규칙(`loadDismissalForDay` ·
// `pickByStudent` · `pickForWeek`) 중 하나를 쓰고 있어야 합니다. 저장만 하는 자리(insert ·
// update · delete)는 보지 않습니다 - 고르는 판단이 없기 때문입니다.
//
// 정말 따로 읽어야 하는 자리라면 그 파일에 `// dismissal-ok: 이유` 를 적습니다.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src"];
const TABLE = "student_dismissal_plans";
/** 고르는 규칙을 담고 있는 이름들. 하나라도 쓰면 통과입니다. */
const SHARED = ["loadDismissalForDay", "pickByStudent", "pickForWeek", "DISMISSAL_SELECT"];
/** 규칙 자체가 사는 파일. 자기 자신을 막을 수는 없습니다. */
const HOME = ["src/lib/dismissalToday.ts", "src/lib/dismissalWeek.ts"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const bad = [];
for (const file of ROOTS.flatMap((r) => walk(r))) {
  if (HOME.includes(file.replace(/\\/g, "/"))) continue;
  const src = readFileSync(file, "utf8");
  if (!src.includes(TABLE)) continue;
  if (src.includes("dismissal-ok")) continue;

  // 그 표에서 **읽는** 자리가 있는가. `.from("…").select(` 가 한 줄에 안 붙어 있을 수
  // 있어서(줄바꿈한 체이닝) 표 이름 뒤 200자 안에 select 가 있는지로 봅니다.
  let reads = false;
  let at = src.indexOf(TABLE);
  while (at >= 0) {
    if (src.slice(at, at + 200).includes(".select(")) {
      reads = true;
      break;
    }
    at = src.indexOf(TABLE, at + 1);
  }
  if (!reads) continue;
  if (SHARED.some((n) => src.includes(n))) continue;
  bad.push(file);
}

if (bad.length > 0) {
  console.error("\n✗ 하원수단을 읽으면서 고르는 규칙을 따로 쓴 파일이 있습니다.\n");
  for (const b of bad) console.error("   " + b);
  console.error(
    "\n  「매주」와 「그 주만」 중 어느 쪽이 답인지를 화면마다 다시 정하면, 화면마다 다른" +
      "\n  명단이 나옵니다. 그건 오류로 안 보이고 픽업은 놓치면 되돌릴 수 없습니다." +
      "\n\n  고치는 법 — loadDismissalForDay(서버) 또는 pickByStudent(값 → 값) 를 씁니다." +
      "\n  정말 따로 읽어야 하면 그 파일에 // dismissal-ok: 이유 를 적습니다.\n",
  );
  process.exit(1);
}

console.log("✓ 하원수단 규칙 검사 통과 (읽는 자리가 모두 같은 규칙을 씁니다)");
