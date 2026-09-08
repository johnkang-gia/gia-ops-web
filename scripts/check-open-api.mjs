#!/usr/bin/env node
/**
 * 토큰으로 스스로 인증하는 창구가 미들웨어에 열려 있는지 검사합니다.
 *
 * 로그인 세션이 없는 요청은 미들웨어가 /login 으로 넘깁니다. 그런데 보내는 쪽이 스크립트나
 * 기기면 리다이렉트를 그냥 따라가고, 로그인 화면은 **HTTP 200** 으로 돌아옵니다. 그래서
 * 보내는 쪽에는 «성공»으로 보이고 앱은 한 줄도 못 받습니다. 화면 어디에도 오류가 안 뜹니다.
 *
 * 이 저장소에서 이미 세 번 났습니다 — 구글챗 크론(307), Traccar 위치 수신(307),
 * 구글시트 명부 수신. 세 번 같은 실수가 났으면 다음에도 납니다.
 *
 * 판단 기준: 라우트가 `getCurrentAppUser`(로그인 확인)를 쓰지 않으면서 토큰·비밀값으로
 * 스스로 확인하면, 그 주소는 미들웨어 통과 목록에 있어야 합니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_DIR = "src/app/api";
const MIDDLEWARE = "src/lib/supabase/middleware.ts";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/** route.ts 파일 경로 → 실제 주소. [id] 같은 조각은 그대로 둡니다(접두사 비교에는 충분). */
function urlOf(file) {
  return "/" + relative("src/app", file).replace(/\/route\.ts$/, "").replace(/\(([^)]+)\)\//g, "");
}

const mwAll = readFileSync(MIDDLEWARE, "utf8");

// **isAuthRoute 선언 부분만** 읽습니다. 파일 전체에서 긁으면 아래쪽 교사 제한 블록의
// `!path.startsWith("/api/")` 까지 «열린 주소»로 세어버려서, /api 밑이 전부 통과합니다 -
// 실제로 이 검사기를 처음 쓸 때 그렇게 헛통과했습니다.
const block = mwAll.match(/const isAuthRoute\s*=([\s\S]*?);\n/);
if (!block) {
  console.error(`✗ ${MIDDLEWARE} 에서 isAuthRoute 선언을 찾지 못했습니다. 검사기를 고쳐야 합니다.`);
  process.exit(1);
}
// 부정(!)이 붙은 것은 «여는 것»이 아닙니다.
const mw = block[1].replace(/![^|]*/g, "");
const opens = [
  ...[...mw.matchAll(/path\.startsWith\("([^"]+)"\)/g)].map((m) => ({ p: m[1], exact: false })),
  ...[...mw.matchAll(/path === "([^"]+)"/g)].map((m) => ({ p: m[1], exact: true })),
];
if (opens.length === 0) {
  console.error("✗ 미들웨어에서 열린 주소를 하나도 못 읽었습니다. 검사기를 고쳐야 합니다.");
  process.exit(1);
}
const isOpen = (url) => opens.some((o) => (o.exact ? url === o.p : url.startsWith(o.p)));

// 로그인으로 확인하는 라우트의 표시들. 한 가지만 보면 놓칩니다 - 어떤 라우트는
// getCurrentAppUser 를 쓰고 어떤 라우트는 auth.getUser() 를 바로 부릅니다.
const SESSION = [/getCurrentAppUser/, /auth\.getUser\(/, /auth\.getClaims\(/];

// 요청에서 토큰·비밀값을 꺼내 스스로 확인하는 표시들. **요청에서 꺼내는 것**만 셉니다 -
// 표의 칸 이름(device_id 등)까지 세면 로그인 화면까지 걸려서 검사기를 아무도 안 믿게 됩니다.
const SELF_AUTH = [
  /x-gia-token/i,
  /CRON_SECRET/,
  /headers\.get\(\s*["']authorization/i,
  /(searchParams\.get|body\??\.|params\.)\s*\(?\s*["']?(token|code|key|secret|deviceId|device_id)/i,
];

const missing = [];
for (const file of walk(API_DIR)) {
  const src = readFileSync(file, "utf8");
  if (SESSION.some((re) => re.test(src))) continue;
  if (src.includes("open-api-ok")) continue; // 사람이 이유를 적고 면제한 자리
  if (!SELF_AUTH.some((re) => re.test(src))) continue;
  const url = urlOf(file);
  if (!isOpen(url)) missing.push({ file, url });
}

if (missing.length > 0) {
  console.error("\n✗ 로그인 없이 불리는 창구가 미들웨어에 막혀 있습니다.\n");
  console.error("  막히면 /login 으로 넘어가고, 보내는 쪽에는 200(성공)으로 보입니다.");
  console.error("  그래서 화면에는 아무 오류 없이 «아무것도 안 들어옴»만 남습니다.\n");
  for (const m of missing) console.error(`  ${m.url}\n    ${m.file}`);
  console.error(`\n  고치는 법: ${MIDDLEWARE} 의 isAuthRoute 에 이유와 함께 추가하세요.`);
  console.error("  정말 막아야 하는 자리면 라우트 안에 // open-api-ok: 이유 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 열린 창구 검사 통과 (토큰으로 확인하는 라우트가 모두 열려 있습니다)");
