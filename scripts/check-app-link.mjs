// 앱 안의 링크는 `@/components/common/AppLink` 로만 겁니다.
//
// `next/link` 는 화면에 보이는 링크를 전부 미리 불러옵니다. 학생 조회 한 화면에서 124번이 나가
// 그 화면의 사진·자료 앞에 줄을 섰고, 사진이 다 뜨는 데 26초가 걸렸습니다. AppLink 는 마우스가
// 올라간 링크만 미리 부릅니다. 정말 `next/link` 가 필요하면 그 줄 위에 `link-ok: 이유` 를 적습니다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const bad = [];
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(p) && !p.endsWith("components/common/AppLink.tsx")) {
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (!/from\s+["']next\/link["']/.test(l)) return;
        if ((lines[i - 1] ?? "").includes("link-ok")) return;
        bad.push(`${p}:${i + 1}`);
      });
    }
  }
}
walk("src");
if (bad.length) {
  console.error("✗ next/link 를 직접 쓰는 자리 (화면에 보이는 링크를 전부 미리 불러옵니다):");
  for (const b of bad) console.error("  " + b);
  console.error('  → import Link from "@/components/common/AppLink"; 로 바꾸거나, 위 줄에 `link-ok: 이유` 를 적으세요.');
  process.exit(1);
}
console.log("✓ check-app-link");
