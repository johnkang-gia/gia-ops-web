// 학생 이름을 «글자로» 담은 칸은 새 파일이 읽지 못하게 합니다 — 줄어들기만 하는 목록(래칫).
//
// 동명이인 사고 여덟 번의 공통점은 «번호가 있는데 이름 글자를 다시 읽은 자리»입니다. 그런 칸
// (student_name_raw · matched_name · ai_student_name)을 읽는 파일이 51개라 한꺼번에 옮기지 못합니다.
// 대신 **늘지 않게** 합니다. 지금 읽는 파일은 scripts/raw-name-baseline.json 에 적혀 있고,
//   · 목록에 없는 파일이 그 칸을 읽으면 → 빌드 실패. 학생 번호(student_id)와 displayStudent·<Who> 를 쓰세요.
//   · 목록에 있는 파일이 더 이상 안 읽으면 → 빌드 실패. 목록에서 지우세요(줄어든 만큼 굳힙니다).
// 정말 새로 읽어야 하는 자리라면(수집기가 원문을 저장하는 자리 등) 그 줄 위에 `raw-name-ok: 이유`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const COLS = /\b(student_name_raw|matched_name|ai_student_name)\b/;
const base = new Set(JSON.parse(readFileSync("scripts/raw-name-baseline.json", "utf8")).files);
const using = new Set();
const fresh = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(p)) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    let hit = false;
    lines.forEach((l, i) => {
      if (!COLS.test(l)) return;
      if (lines.slice(Math.max(0, i - 2), i + 1).join("\n").includes("raw-name-ok")) return;
      hit = true;
    });
    if (!hit) continue;
    using.add(p);
    if (!base.has(p)) fresh.push(p);
  }
}
walk("src");
const gone = [...base].filter((p) => !using.has(p));
if (fresh.length || gone.length) {
  if (fresh.length) {
    console.error("✗ 학생 이름 글자 칸을 새로 읽는 파일 (동명이인 사고의 출발점):");
    for (const p of fresh) console.error("  " + p);
    console.error("  → student_id 와 displayStudent·<Who>·StudentIndex 를 쓰세요. 꼭 필요하면 그 줄 위에 `raw-name-ok: 이유`.");
  }
  if (gone.length) {
    console.error("✗ 더 이상 이름 글자 칸을 안 읽는 파일 — scripts/raw-name-baseline.json 에서 지워 굳히세요:");
    for (const p of gone) console.error("  " + p);
  }
  process.exit(1);
}
console.log(`✓ check-raw-name-ratchet (이름 글자 칸을 읽는 파일 ${using.size}개 · 늘지 않음)`);
