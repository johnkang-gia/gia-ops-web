#!/usr/bin/env node
/**
 * **화면 높이에 가둬 놓고 안쪽에 스크롤을 안 둔 자리.**
 *
 * ── 무엇이 문제였나 ────────────────────────────────────────────────────────
 *
 * `MainArea` 의 `BOUNDED_LIST_PATHS` 에 이름이 오르면 본문이 `overflow-hidden` 이 됩니다.
 * 게시판형 목록은 그래야 화면이 늘어지지 않고 「1 2 3」으로 넘겨 볼 수 있습니다.
 *
 * 그런데 그 화면 **안쪽에 스크롤 칸이 없으면**, 접힌 부분에 아예 손이 닿지 않습니다.
 * 스크롤 막대조차 안 생겨서, 보는 사람은 그 아래에 내용이 더 있다는 것도 모릅니다.
 * 오류가 아니라 **「그게 전부인 화면」**으로 보입니다.
 *
 * 반/담임 화면이 그랬습니다 - 학기 고르개 아래의 반 목록·교실 태블릿·이력이 통째로
 * 잘려 있었고, 아무리 굴려도 내려가지 않았습니다.
 *
 * ── 무엇을 보나 ────────────────────────────────────────────────────────────
 *
 * 목록에 적힌 주소마다 `src/app/(dashboard)<주소>/page.tsx` 를 찾고, 그 파일과 **그 파일이
 * 들여오는 우리 컴포넌트**에 스크롤 칸(`overflow-y-auto` · `overflow-auto` · `overflow-y-scroll`)
 * 이 하나라도 있는지 봅니다.
 *
 * **스크롤을 아래로 넘기는 껍데기는 따라 들어갑니다.** 「나는 높이를 가두고 스크롤은 자식이
 * 한다」고 적어 둔 상자(`overflow-hidden` 과 `min-h-0`/`flex-1`/`h-full` 을 함께 쓴 파일)가
 * 그런 자리입니다. 보고서 모음 화면이 그렇게 되어 있어, 한 겹만 보면 멀쩡한 화면을 잘못
 * 잡아냅니다 - **자꾸 헛걸리는 검사는 사람이 무시하게 되고, 무시당하는 검사는 없는 것과
 * 같습니다**(CLAUDE.md §1).
 *
 * 반대로 그냥 상자를 그리는 파일은 따라가지 않습니다. 아무 데나 깊이 들어가면 엉뚱한 곳의
 * 스크롤을 보고 통과시키게 되는데, 그건 헛걸리는 것보다 나쁩니다 - 버그가 그대로 나갑니다.
 *
 * 정말 가둬도 되는 화면(내용이 늘 한 화면에 들어오는 경우)은 `MainArea.tsx` 안
 * 그 줄 옆에 `// scroll-ok: 이유` 를 적습니다.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const MAIN = "src/components/MainArea.tsx";
const APP = "src/app/(dashboard)";
const SCROLL = /overflow-y-auto|overflow-auto|overflow-y-scroll/;
/** 「높이는 내가 가두고 스크롤은 자식이 한다」고 적어 둔 상자. 여기까지는 따라 들어갑니다. */
const DELEGATES = (src) => /overflow-hidden/.test(src) && /min-h-0|flex-1|h-full/.test(src);
/** 따라 들어가는 깊이의 상한. 끝없이 파고들면 엉뚱한 스크롤을 보고 통과시킵니다. */
const MAX_DEPTH = 3;

const text = readFileSync(MAIN, "utf8");

/** `BOUNDED_LIST_PATHS = [ … ]` 안의 줄만 읽습니다. */
const block = text.match(/const BOUNDED_LIST_PATHS[^=]*=\s*\[([\s\S]*?)\];/);
if (!block) {
  console.error("✗ MainArea.tsx 에서 BOUNDED_LIST_PATHS 를 찾지 못했습니다. 이름이 바뀌었다면 이 검사도 함께 고쳐주세요.");
  process.exit(1);
}

const entries = [];
for (const line of block[1].split("\n")) {
  const m = line.match(/^\s*"([^"]+)"\s*,?/);
  if (!m) continue;
  // 면제는 이유와 함께. 끄는 것은 쉬워야 하지만 왜 껐는지는 남아야 합니다.
  if (/scroll-ok:/.test(line)) continue;
  entries.push(m[1]);
}

/** 그 파일이 들여오는 우리 컴포넌트 파일들(한 겹). */
function localImports(file) {
  const src = readFileSync(file, "utf8");
  const out = [];
  for (const m of src.matchAll(/from\s+"(@\/[^"]+|\.[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join("src", spec.slice(2)) : join(dirname(file), spec);
    for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
      if (existsSync(base + ext)) {
        out.push(base + ext);
        break;
      }
    }
  }
  return out;
}

const missing = [];
for (const route of entries) {
  const page = join(APP, route.replace(/^\//, ""), "page.tsx");
  if (!existsSync(page)) {
    // 화면이 없는 주소가 목록에 남아 있는 것도 그 자체로 알려야 합니다.
    missing.push(`${route}  (화면 파일을 못 찾았습니다: ${page})`);
    continue;
  }
  // 너비 우선으로 훑되, **스크롤을 아래로 넘기는 상자만** 더 따라갑니다.
  const seen = new Set();
  let frontier = [page];
  let hasScroll = false;
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length > 0 && !hasScroll; depth += 1) {
    const next = [];
    for (const f of frontier) {
      if (seen.has(f)) continue;
      seen.add(f);
      let src;
      try {
        src = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      if (SCROLL.test(src)) {
        hasScroll = true;
        break;
      }
      // page.tsx 는 언제나 한 겹 들어갑니다(화면 본체는 대개 클라이언트 컴포넌트에 있습니다).
      if (depth === 0 || DELEGATES(src)) next.push(...localImports(f));
    }
    frontier = next;
  }
  if (!hasScroll) missing.push(`${route}  (${page} 와 그 화면이 쓰는 컴포넌트에 스크롤 칸이 없습니다)`);
}

if (missing.length > 0) {
  console.error("✗ 화면 높이에 가둬 놓고 안쪽에 스크롤을 안 둔 자리가 있습니다.\n");
  for (const m of missing) console.error(`  ${m}`);
  console.error(
    "\n  가둔 화면(BOUNDED_LIST_PATHS)은 본문이 overflow-hidden 이 됩니다. 안쪽에 스크롤 칸이" +
      "\n  없으면 접힌 부분에 손이 닿지 않고, 스크롤 막대도 안 생겨서 «그게 전부인 화면»으로 보입니다." +
      "\n\n  고치는 법 ① 그 화면 안에 스크롤 칸을 둡니다(h-full min-h-0 + overflow-y-auto)." +
      "\n  고치는 법 ② 게시판형이 아니라면 BOUNDED_LIST_PATHS 에서 빼세요 - 가두는 것이 목적이 아닙니다." +
      "\n  정말 가둬도 되면 그 줄 옆에 `// scroll-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}

console.log(`✓ 가둔 화면 검사 통과 (${entries.length}개 화면이 모두 안쪽 스크롤을 갖췄습니다)`);
