// 연락 한 건의 학생 이름은 `displayStudent` 하나로만 정합니다(src/lib/pickupParse.ts).
//
// 학부모 문의·하원수단·중앙 대시보드가 `toKoreanDisplayName` + `markIfAmbiguous` 를 직접 불러
// 이름 글자만 명부와 다시 대조했습니다. 연락에 학생 번호가 이미 붙어 있어도(이어 둔 방에서
// 정해졌거나 사람이 고름) 그 번호를 안 읽으니, 이준서(G3JA) 문의가 「누구?」로 떴습니다.
// 화면 위에는 「학생 바꾸기」(= 연결됨)가 떠 있는데 이름은 «누구?» — 같은 화면이 두 말을 했습니다.
//
// 두 함수를 화면이 직접 부르면 막습니다. 번호가 정말 없는 자리라면 그 줄 위에
// `display-ok: 이유` 를 적습니다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const HOME = "src/lib/pickupParse.ts";
const pat = /\b(toKoreanDisplayName|markIfAmbiguous)\s*\(/;
const bad = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(ts|tsx)$/.test(p) || p === HOME) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (!pat.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
      if (lines.slice(Math.max(0, i - 3), i + 1).join("\n").includes("display-ok")) return;
      bad.push(`${p}:${i + 1}: ${l.trim().slice(0, 100)}`);
    });
  }
}
walk("src");
if (bad.length) {
  console.error("✗ 학생 번호를 건너뛰고 이름만으로 학생을 적는 자리:");
  for (const b of bad) console.error("  " + b);
  console.error("  → displayStudent(줄, 명부) 를 쓰세요. 번호가 정말 없는 자리면 위 줄에 `display-ok: 이유`.");
  process.exit(1);
}
console.log("✓ check-display-student");
