#!/usr/bin/env node
/**
 * 남에게 건네는 링크를 «지금 브라우저 주소»로 만들지 않았는지 검사합니다.
 *
 * 이 앱은 정식 주소 말고 미리보기 주소(`...-git-staging-....vercel.app`)로도 열립니다.
 * 담당자가 미리보기에서 화면을 열고 QR·링크·스크립트를 만들면 거기에 미리보기 주소가
 * 박히는데, 그 주소는 배포마다 바뀌고 Vercel 배포 보호에 걸려 로그인 화면을 돌려줍니다.
 * 기사님 휴대폰·교실 태블릿·안내보드·구글시트 스크립트가 그 주소를 붙들고 씁니다.
 *
 * 실제로 구글시트 명부가 이 때문에 몇 주 동안 한 줄도 안 들어왔습니다(2026-09).
 *
 * 그래서 화면 코드에서는 `window.location.origin` 대신 `@/lib/appUrl` 의 APP_ORIGIN·
 * shareUrl 을 씁니다. 화면 안에서만 도는 이동(로그인 콜백 등)은 지금 주소가 맞으므로,
 * 그런 자리에는 바로 윗줄에 `// origin-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/app"];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const bad = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!line.includes("location.origin")) return;
      // 이유는 여러 줄로 적을 수 있어야 합니다. 한 줄로만 찾으면 사람이 이유를 짧게
      // 줄여 쓰게 되고, 그러면 왜 껐는지가 남지 않습니다.
      const near = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
      if (near.includes("origin-ok")) return;
      bad.push({ file, line: i + 1, text: line.trim().slice(0, 90) });
    });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 남에게 건네는 링크를 «지금 브라우저 주소»로 만들고 있습니다.\n");
  console.error("  미리보기 주소로 화면을 열면 그 주소가 그대로 QR·링크·스크립트에 박힙니다.");
  console.error("  그 주소는 배포마다 바뀌고, 로그인 화면을 200으로 돌려줘 «성공»처럼 보입니다.\n");
  for (const b of bad) console.error(`  ${b.file}:${b.line}\n    ${b.text}`);
  console.error("\n  고치는 법: @/lib/appUrl 의 shareUrl(path) 또는 APP_ORIGIN 을 쓰세요.");
  console.error("  화면 안에서만 도는 이동이면 윗줄에 // origin-ok: 이유 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 공유 주소 검사 통과 (남에게 주는 링크가 정식 주소로 만들어집니다)");
