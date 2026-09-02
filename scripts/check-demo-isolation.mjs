// 데모 학생이 실제 명부에 섞이지 않게 하는 검사.
//
// 오리엔테이션용 가짜 학생·가짜 반이 실제 표에 함께 들어 있습니다(is_demo 칸으로만 갈립니다).
// 표를 따로 두지 않은 이유는 화면을 두 벌 만들지 않기 위해서였는데, 그 대가로 **읽는 곳마다
// is_demo 를 빠뜨리면 안 된다**는 조건이 생겼습니다.
//
// 사람의 기억으로는 못 지킵니다. 읽는 곳이 이미 일흔 곳이 넘고, 새 화면을 만들 때마다 늘어납니다.
// 그래서 빌드가 대신 봅니다.
//
// 빠뜨린 곳이 정말 괜찮은 자리라면(데모 계정 전용 화면 등) 그 줄 바로 위에
//   // demo-ok: 이유
// 를 적으면 넘어갑니다. 이유를 적게 하는 것이 요점입니다 - 끄는 것은 쉬워야 하지만
// 왜 껐는지는 남아야 합니다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TABLES = ["wr_students", "wr_classes"];
const ROOT = "src";

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
  const text = readFileSync(file, "utf8");
  if (!TABLES.some((t) => text.includes(`from("${t}")`))) continue;
  const lines = text.split("\n");

  for (const table of TABLES) {
    const re = new RegExp(`from\\("${table}"\\)`, "g");
    let m;
    while ((m = re.exec(text)) !== null) {
      // 체인의 끝(세미콜론)까지를 한 덩어리로 봅니다.
      const end = text.indexOf(";", m.index);
      const chain = text.slice(m.index, end > 0 ? end : m.index + 600);
      // 읽기만 봅니다. 쓰기(insert/update/delete)는 대상이 정해져 있고, 넣는 값에 is_demo 를
      // 못박는 것이 맞는 자리라 여기서 볼 것이 아닙니다.
      if (!chain.includes(".select(")) continue;
      if (/\.(insert|update|upsert|delete)\(/.test(chain.slice(0, chain.indexOf(".select(")))) continue;
      if (chain.includes("is_demo")) continue;

      const lineNo = text.slice(0, m.index).split("\n").length;
      // 바로 위 두 줄에 면제 표시가 있는지.
      const above = lines.slice(Math.max(0, lineNo - 3), lineNo - 1).join(" ");
      if (/demo-ok:/.test(above)) continue;

      problems.push({ file, lineNo, table, snippet: chain.split("\n")[0].trim().slice(0, 90) });
    }
  }
}

if (problems.length > 0) {
  console.error(`\n✗ 데모 격리 검사 실패 — is_demo 를 빠뜨린 곳 ${problems.length}곳\n`);
  console.error("  데모 학생이 실제 명부에 섞여 나올 수 있습니다.");
  console.error('  읽는 곳에 .eq("is_demo", false) 를 붙이거나, 정말 괜찮다면 바로 위 줄에');
  console.error("  // demo-ok: 이유  를 적어주세요.\n");
  for (const p of problems) {
    console.error(`  ${p.file}:${p.lineNo}  [${p.table}]`);
    console.error(`     ${p.snippet}`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ 데모 격리 검사 통과 (실제 명부에 데모 학생이 섞이지 않습니다)");
