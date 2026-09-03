// 상단 탭줄이 없는 화면을 찾습니다.
//
// 상단 탭줄은 SectionTabs 하나가 전 화면에 그립니다. 그런데 어느 대분류에도 등록되지 않은
// 화면을 새로 만들면, 그 화면에서만 탭줄이 통째로 사라집니다. 그러면 그 페이지를 만든 사람은
// 자기 본문 안에 탭줄을 따로 그리게 되고, 모양도 자리도 다른 줄이 하나 더 생깁니다.
// (재무 화면 다섯 개가 정확히 그렇게 되어 있었습니다 — 탭이 페이지마다 달라 보이던 이유입니다.)
//
// 그래서 "새 화면을 만들었는데 탭에 안 걸었다"를 빌드가 잡습니다.
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TABS_FILE = path.join(ROOT, "src/components/common/SectionTabs.tsx");
const APP_DIR = path.join(ROOT, "src/app/(dashboard)");

// 탭줄이 없어도 되는 화면. 늘리려면 **이유를 함께** 적습니다.
const ALLOW = [
  ["/home", "첫 화면 - 대분류에 속하지 않습니다."],
  ["/dashboard", "로그인 없는 전용 링크(전광판)라 탭줄이 없습니다."],
  ["/onboarding", "가입 절차 - 메뉴가 아직 없습니다."],
  ["/pending", "승인 대기 - 메뉴가 아직 없습니다."],
  ["/account", "내 계정 - 오른쪽 위 메뉴에서 들어옵니다."],
  ["/admin", "관리자 도구 - 개발자 탭의 children 으로만 일부가 걸립니다."],
  ["/ops-board", "사무실 대형 모니터에 띄우는 화면 - 조작하지 않으므로 탭줄을 두지 않습니다."],
  ["/my-class", "교사 화면 - 교사 전용 탭 세트를 씁니다."],
  ["/weekly-report", "교사·행정이 나눠 쓰는 화면이라 상위 탭이 갈립니다."],
];

function collectRoutes(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    // (그룹) 은 URL 에 안 나오고, [동적] 칸은 앞 경로로 이미 걸립니다.
    if (e.name.startsWith("(") || e.name.startsWith("[") || e.name.startsWith("_")) {
      out.push(...collectRoutes(path.join(dir, e.name), e.name.startsWith("(") ? prefix : null));
      continue;
    }
    const here = prefix === null ? null : `${prefix}/${e.name}`;
    const full = path.join(dir, e.name);
    if (here && fs.existsSync(path.join(full, "page.tsx"))) out.push(here);
    out.push(...collectRoutes(full, here));
  }
  return out;
}

const src = fs.readFileSync(TABS_FILE, "utf8");
// match: ["/a", "/b"] 와 href: "/c" 를 모두 긁습니다.
const covered = new Set();
for (const m of src.matchAll(/(?:href|match)\s*:\s*(\[[^\]]*\]|"[^"]+")/g)) {
  for (const p of m[1].matchAll(/"(\/[^"?]*)/g)) covered.add(p[1]);
}

const routes = [...new Set(collectRoutes(APP_DIR, ""))].sort();
const bad = routes.filter((r) => {
  if (covered.has(r)) return false;
  if ([...covered].some((c) => r === c || r.startsWith(c + "/"))) return false;
  return !ALLOW.some(([p]) => r === p || r.startsWith(p + "/"));
});

if (bad.length > 0) {
  console.error("상단 탭줄에 걸리지 않은 화면이 있습니다:\n");
  for (const r of bad) console.error(`  ${r}`);
  console.error(
    "\nsrc/components/common/SectionTabs.tsx 의 대분류 중 한 곳에 넣으세요(탭 또는 children).",
    "\n탭줄이 없는 것이 맞는 화면이라면 같은 파일의 ALLOW 목록에 **이유와 함께** 적으세요.",
    "\n본문 안에 탭줄을 따로 그리지는 마세요 — 화면마다 탭 위치가 달라지는 원인이 그것입니다.\n",
  );
  process.exit(1);
}
console.log(`상단 탭줄 검사 통과 (화면 ${routes.length}개)`);
