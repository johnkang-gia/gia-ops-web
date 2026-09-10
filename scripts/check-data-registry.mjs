#!/usr/bin/env node
/**
 * **새로 만든 표가 등기소에 등록됐는지** 검사합니다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 지금까지 규칙은 «문제가 난 다음에» 하나씩 붙였습니다 - 데모 학생, 부서 판정, 동명이인,
 * 짝 칸, 백업, RLS. 전부 사고가 먼저 나고 검사기가 뒤따라왔습니다.
 *
 * 그래서 **새로 만드는 표는 언제나 규칙 밖에서 시작합니다.** 만드는 사람은 그 순간
 * 「이 자료는 어느 종류이고, 중복은 무엇으로 막고, 내리는 함수는 어디에 있나」를 생각하지
 * 않습니다. 몇 주 뒤 다른 화면이 그 표를 읽기 시작할 때 비로소 어긋남이 드러납니다.
 *
 * 이 검사기는 순서를 뒤집습니다. **표를 만드는 그 자리에서** 종류를 정하게 합니다.
 * 등기소(`src/lib/registry/dataKinds.ts`)에 없는 표가 마이그레이션에 나타나면 빌드가
 * 멈추고, 어디에 적어야 하는지 알려줍니다.
 *
 * ── 무엇을 검사하지 않나 ────────────────────────────────────────────────────
 *
 * 등록만 봅니다. 「중복 열쇠가 정말 맞는가」까지는 글자로 알 수 없습니다. 대신 **비워둘 때
 * 이유를 적게** 해서, 비운 사실이 눈에 남게 합니다. 검사기가 할 수 있는 일과 사람이 해야
 * 하는 일을 섞지 않습니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG = "supabase/migrations";
const REGISTRY = "src/lib/registry/dataKinds.ts";

// ── 마이그레이션이 만든 표 ────────────────────────────────────────────────
const made = new Set();
for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql"))) {
  const sql = readFileSync(join(MIG, f), "utf8");
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)/gi)) {
    made.add(m[1]);
  }
}

// ── 등기소에 적힌 표 ──────────────────────────────────────────────────────
//
// 등기소는 TypeScript 라 여기서 실행할 수 없습니다(빌드 전이라 컴파일본이 없습니다).
// 글자로 뽑습니다 - 표 이름은 전부 큰따옴표 안의 소문자 낱말이라 이 방법으로 충분합니다.
const reg = readFileSync(REGISTRY, "utf8");
const registered = new Set([...reg.matchAll(/"([a-z][a-z0-9_]{2,})"/g)].map((m) => m[1]));

const missing = [...made].filter((t) => !registered.has(t)).sort();

// ── 이유 없이 비워 둔 자리 ────────────────────────────────────────────────
//
// `gap: null` 은 「짝이 맞다」는 뜻이라 괜찮습니다. 문제는 중복 열쇠를 `{ none: "" }` 로
// 비워 두는 것입니다 - 빈 이유는 이유가 아닙니다.
const emptyReason = [...reg.matchAll(/none:\s*"(\s*)"/g)].length;

const problems = [];
if (missing.length > 0) problems.push({ what: "등기소에 없는 표", list: missing });
if (emptyReason > 0) problems.push({ what: "이유 없이 중복 검사를 끈 자리", list: [`${emptyReason}곳`] });

if (problems.length > 0) {
  console.error("\n✗ 자료 등기소가 실제 표와 어긋납니다.\n");
  console.error("  표를 만들 때 «이 자료는 어느 종류인가»를 그 자리에서 정해야 합니다.");
  console.error("  나중에 정하면, 그 사이에 다른 화면이 제각각 해석해서 씁니다.\n");
  for (const p of problems) {
    console.error(`  ${p.what} (${p.list.length}):`);
    for (const t of p.list) console.error(`    · ${t}`);
  }
  console.error(`\n  고치는 법: ${REGISTRY} 를 열고`);
  console.error("    · 다섯 갈래 중 하나의 canonical 이나 satellites 에 넣거나");
  console.error("    · 쌓이는 기록이면 LOG_TABLES 에 넣거나");
  console.error("    · 어디에도 안 붙으면 UNFILED 에 **이유와 함께** 적으세요.\n");
  process.exit(1);
}

console.log(`✓ 자료 등기소 검사 통과 (표 ${made.size}개가 모두 등록되어 있습니다)`);
