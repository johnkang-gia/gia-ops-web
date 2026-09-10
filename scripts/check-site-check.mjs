#!/usr/bin/env node
/**
 * 새로 만든 화면이 **사이트 점검 목록에서 빠지지 않게** 막습니다.
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────
 *
 * 사이트 점검은 `src/lib/siteCheck.ts` 의 목록에 적힌 화면만 열어봅니다. 새 화면을 만들고
 * 목록에 안 넣으면 그 화면만 조용히 점검에서 빠지는데, 결과에는 「모두 정상」으로 나옵니다.
 * 점검이 빠뜨린 것은 점검한 것과 화면에서 구별되지 않습니다 - 그게 이 검사가 있는 이유입니다.
 *
 * 반대로 없어진 화면이 목록에 남아 있으면 매번 「없는 화면」으로 잡혀, 진짜 문제가 그 사이에
 * 묻힙니다. 그것도 함께 봅니다.
 *
 * 정말 점검에서 빼야 하는 화면이면 그 page.tsx 안에 `// site-check-ok: 이유` 를 적습니다.
 * 빼는 것은 쉬워야 하지만 왜 뺐는지는 남아야 합니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/(dashboard)";
const LIB = "src/lib/siteCheck.ts";

function pages(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      // 괄호로 묶은 폴더는 주소에 안 들어갑니다.
      const seg = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
      out.push(...pages(full, prefix + seg));
    } else if (name === "page.tsx") {
      out.push({ path: prefix || "/", file: full });
    }
  }
  return out;
}

const found = pages(ROOT).filter((p) => !p.path.includes("["));
const lib = readFileSync(LIB, "utf8");
// SCREENS 배열 안만 봅니다. 파일에는 값이 들어가는 주소 목록도 함께 있어서, 파일 전체에서
// 따옴표를 긁으면 그것들까지 「화면」으로 세어 매번 헛걸립니다.
const block = lib.match(/export const SCREENS: string\[\] = \[([\s\S]*?)\n\];/);
if (!block) {
  console.error("\n✗ src/lib/siteCheck.ts 에서 SCREENS 목록을 찾지 못했습니다.\n");
  process.exit(1);
}
const listed = new Set([...block[1].matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]));

const missing = found.filter((p) => {
  if (listed.has(p.path)) return false;
  const src = readFileSync(p.file, "utf8");
  return !src.includes("site-check-ok:");
});

// 목록에는 있는데 화면이 없어진 것. 매번 「없는 화면」으로 잡혀 진짜 문제를 가립니다.
const paths = new Set(found.map((p) => p.path));
const stale = [...listed].filter((p) => !p.startsWith("/api") && !paths.has(p));

if (missing.length > 0 || stale.length > 0) {
  console.error("\n✗ 사이트 점검 목록 검사 실패\n");
  if (missing.length > 0) {
    console.error(`  점검 목록에 없는 화면 ${missing.length}개 — src/lib/siteCheck.ts 의 SCREENS 에 넣어주세요:`);
    for (const m of missing) console.error(`    "${m.path}",   (${m.file})`);
    console.error("\n  정말 빼야 하면 그 page.tsx 안에 // site-check-ok: 이유  를 적어주세요.");
  }
  if (stale.length > 0) {
    console.error(`\n  없어진 화면이 목록에 남아 있습니다 ${stale.length}개 — 지워주세요:`);
    for (const s of stale) console.error(`    ${s}`);
  }
  console.error("");
  process.exit(1);
}

console.log(`✓ 사이트 점검 목록 검사 통과 (화면 ${found.length}개가 모두 점검 대상입니다)`);
