#!/usr/bin/env node
/**
 * **같은 값 목록이 여러 곳에 적혀 있으면 반드시 어긋납니다.**
 *
 * 「어느 번호 앞으로 보내는가」를 가리키는 값(mother · father · guardian · direct)이 세 곳에
 * 적혀 있었습니다 - 코드의 타입 하나, 데이터베이스 제약 둘.
 *
 *   src/lib/alltalkpay.ts      GuardianRole                       mother father guardian direct
 *   wr_students                billing_phone_role_check           mother father guardian direct
 *   invoices                   invoices_guardian_role_check       mother father guardian ▲없음
 *
 * 2026-09-26 에 「결제번호」(`direct` — 명부 세 칸 중 아무도 아닌 번호를 따로 등록)를
 * 넣으면서 **학생 쪽 제약만 넓히고 청구서 쪽을 잊었습니다.** 그래서 결제번호를 `direct` 로
 * 정해 둔 학생에게 청구서를 발행하면 데이터베이스가 거부했습니다.
 *
 *   new row for relation "invoices" violates check constraint "invoices_guardian_role_check"
 *
 * 화면에는 「0장 기록 · 1장 실패」로 뜹니다. 코드에도 타입에도 아무 문제가 없어서, 어디를
 * 봐야 하는지 알 수 없습니다 - 2026-09-21 ~ 10-01 사이 열두 번 났고 **그 학생들은 그동안
 * 청구서가 안 나갔습니다.**
 *
 * 값을 한 곳에만 적을 수는 없습니다(하나는 타입스크립트, 둘은 SQL). 그래서 **어긋났는지를
 * 검사합니다.** 코드의 유니온에 값을 더하면 두 제약에 모두 들어 있어야 통과합니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";

/** 코드의 유니온 타입이 기준입니다. 그 값이 아래 제약들에 모두 있어야 합니다. */
const SOURCE = { file: "src/lib/alltalkpay.ts", type: "GuardianRole" };

const CONSTRAINTS = [
  { name: "invoices_guardian_role_check", table: "invoices", column: "guardian_role" },
  { name: "wr_students_billing_phone_role_check", table: "wr_students", column: "billing_phone_role" },
];

/**
 * 제약에만 있고 코드에는 없어도 되는 값. 반대 방향(제약 ⊇ 코드)만 검사하므로 사실 필요
 * 없지만, 왜 남겨두는지를 적어둡니다 - 지우려는 사람이 이 줄을 먼저 봅니다.
 *
 * · manual — 올톡페이로 보낼 때 사람이 번호를 직접 적은 건. 명부에는 없는 개념입니다.
 */

// ── 코드 쪽 ──────────────────────────────────────────────────────────
const ts = readFileSync(SOURCE.file, "utf8");
const m = new RegExp(`type\\s+${SOURCE.type}\\s*=([^;]+);`).exec(ts);
if (!m) {
  console.error(`\n✗ ${SOURCE.file} 에서 ${SOURCE.type} 타입을 찾지 못했습니다.`);
  console.error(`
  이 검사는 그 유니온을 기준으로 데이터베이스 제약을 대조합니다. 타입 이름이 바뀌었으면
  scripts/check-role-values.mjs 의 SOURCE 도 함께 고쳐주세요 - 기준을 못 찾으면 검사가
  조용히 아무것도 안 보게 됩니다.
`);
  process.exit(1);
}
const want = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);

// ── 마이그레이션 쪽 ──────────────────────────────────────────────────
// 같은 제약을 여러 번 고칠 수 있으므로, 시각 순으로 훑어 **마지막 정의**를 씁니다.
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const found = new Map(); // 제약 이름 → { values, file }

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8").replace(/--[^\n]*/g, "");
  for (const c of CONSTRAINTS) {
    let at = 0;
    for (;;) {
      const i = sql.indexOf(c.name, at);
      if (i === -1) break;
      at = i + c.name.length;
      const end = sql.indexOf(";", at);
      const body = sql.slice(at, end === -1 ? undefined : end);
      // `drop constraint if exists ...;` 같은 줄에는 값 목록이 없습니다.
      const list = /\bin\s*\(([^)]*)\)/i.exec(body);
      if (!list) continue;
      found.set(c.name, {
        values: [...list[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
        file: f,
      });
    }
  }
}

const bad = [];
for (const c of CONSTRAINTS) {
  const got = found.get(c.name);
  if (!got) {
    bad.push({ c, missing: want, note: "제약 정의를 마이그레이션에서 찾지 못했습니다" });
    continue;
  }
  const missing = want.filter((v) => !got.values.includes(v));
  if (missing.length > 0) bad.push({ c, missing, file: got.file, has: got.values });
}

if (bad.length > 0) {
  console.error(`\n✗ 값 목록이 어긋났습니다. 코드의 ${SOURCE.type} 에 있는 값이 제약에 없습니다.\n`);
  console.error(`  코드(${SOURCE.file}): ${want.join(" · ")}\n`);
  for (const b of bad) {
    console.error(`  ${b.c.table}.${b.c.column}  (${b.c.name})`);
    if (b.has) console.error(`    제약에 있는 값: ${b.has.join(" · ")}   ← ${b.file}`);
    if (b.note) console.error(`    ${b.note}`);
    console.error(`    빠진 값: ${b.missing.join(" · ")}\n`);
  }
  console.error(`  새 마이그레이션에서 제약을 다시 만들어주세요.

    alter table public.${bad[0].c.table} drop constraint if exists ${bad[0].c.name};
    alter table public.${bad[0].c.table} add constraint ${bad[0].c.name}
      check (${bad[0].c.column} is null or ${bad[0].c.column} in (${[...want, "…"].map((v) => (v === "…" ? "…" : `'${v}'`)).join(", ")}));

  **빠진 값은 오류가 아니라 「저장 실패」로 보입니다.** 코드도 타입도 멀쩡하므로 어디를
  봐야 하는지 알 수 없습니다 - 실제로 청구서가 열두 번 안 나갔습니다.
`);
  process.exit(1);
}

console.log(`✓ 역할 값 — ${SOURCE.type}(${want.length}개)이 제약 ${CONSTRAINTS.length}곳에 모두 있습니다.`);
