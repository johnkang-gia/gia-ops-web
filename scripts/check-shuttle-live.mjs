#!/usr/bin/env node
// 하원 세 화면이 **같은 표 목록**을 보는지 검사합니다.
//
// ── 왜 검사기까지 만드는가 ──────────────────────────────────────────────────
//
// 하원 명단은 세 화면이 동시에 봅니다.
//
//   · 하원 체크표          — 실시간 구독
//   · 하원 셔틀명단        — 실시간 구독
//   · 차량 도착·출발 체크  — 로그인 없는 화면이라 「번호가 바뀌었는가」로 갱신
//
// 앞의 둘은 `src/lib/shuttleLive.ts` 의 `SHUTTLE_LIVE_TABLES` 를 듣고, 뒤의 하나는 SQL
// 트리거가 올리는 번호를 봅니다. **두 목록이 어긋나면 한쪽 화면만 안 바뀝니다** - 그리고
// 그건 오류로 보이지 않습니다. 그냥 옛 명단입니다.
//
// 실제로 `shuttle_persistent_notes` 가 트리거 쪽에만 빠져 있었습니다. 표를 새로 만들 때
// 목록 두 곳을 다 고치는 일은 사람의 기억에 맡길 수 없습니다.
//
// 실행: node scripts/check-shuttle-live.mjs   (npm run build 에서 자동)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── ① 코드 쪽 목록 ──────────────────────────────────────────────────────────
const libText = readFileSync(join(root, "src/lib/shuttleLive.ts"), "utf8");
const block = libText.match(/SHUTTLE_LIVE_TABLES\s*=\s*\[([\s\S]*?)\]\s*as const/);
if (!block) {
  console.error("\n✗ src/lib/shuttleLive.ts 에서 SHUTTLE_LIVE_TABLES 를 찾지 못했습니다.\n");
  process.exit(1);
}
const inCode = new Set([...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));

// ── ② SQL 트리거 쪽 목록 ────────────────────────────────────────────────────
//
// 마이그레이션은 쌓입니다. **가장 나중 것이 지금 걸려 있는 것**이므로 파일 이름 순으로
// 마지막에 `shuttle_tables` 를 적은 파일을 봅니다.
const migDir = join(root, "supabase/migrations");
let inSql = null;
let sqlFile = null;
for (const f of readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  const m = readFileSync(join(migDir, f), "utf8").match(/shuttle_tables\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/);
  if (m) {
    inSql = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    sqlFile = f;
  }
}
if (!inSql) {
  console.error("\n✗ 마이그레이션에서 shuttle_tables 목록을 찾지 못했습니다.\n");
  process.exit(1);
}

// ── ③ 맞대어 봅니다 ─────────────────────────────────────────────────────────
const onlyCode = [...inCode].filter((t) => !inSql.has(t));
const onlySql = [...inSql].filter((t) => !inCode.has(t));

if (onlyCode.length === 0 && onlySql.length === 0) {
  console.log(`✓ 하원 실시간 검사 통과 (표 ${inCode.size}개 — 체크표·명단·도착체크가 같은 목록을 봅니다)`);
  process.exit(0);
}

console.error("\n✗ 하원 화면들이 서로 다른 표 목록을 보고 있습니다\n");
console.error("  한쪽에만 있는 표는 그 화면에서만 반영되고, 다른 화면은 옛 명단을 보여줍니다.");
console.error("  오류로 보이지 않습니다 - 하원 시간에 아이가 차에 탄 뒤에야 드러납니다.\n");
if (onlyCode.length > 0) {
  console.error(`  실시간 구독에만 있음 (도착·출발 체크는 못 받습니다): ${onlyCode.join(", ")}`);
  console.error(`      → ${sqlFile} 의 shuttle_tables 에 추가하거나, 새 마이그레이션으로 트리거를 거세요.`);
}
if (onlySql.length > 0) {
  console.error(`  트리거에만 있음 (체크표·셔틀명단은 못 받습니다): ${onlySql.join(", ")}`);
  console.error("      → src/lib/shuttleLive.ts 의 SHUTTLE_LIVE_TABLES 에 추가하세요.");
}
console.error("");
process.exit(1);
