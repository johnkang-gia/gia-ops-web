#!/usr/bin/env node
/**
 * 동명이인을 가르는 코드를 쓰는 화면이 **가를 재료를 실제로 읽는지** 검사합니다.
 *
 * 김재이가 셋(G2C·G2A·G3JA)인 학교입니다. 목록에 그냥 「김재이」로만 뜨면 보는 사람은
 * 이미 정해진 이름이라 믿고 엉뚱한 아이를 찾습니다.
 *
 * 이걸 세 번 고쳤는데 세 번 다 다시 났습니다. 가르는 **로직**은 멀쩡했고, 매번 화면이
 * `class_name` · `birth_date` 를 **안 읽어왔던** 것이 원인이었습니다. 없는 값으로는 아무것도
 * 가를 수 없는데, 화면에는 오류가 아니라 그냥 「김재이」로 보입니다.
 *
 * 그래서 검사합니다: `matchStudent` · `studentLabel` · `markIfAmbiguous` · `toKoreanDisplayName`
 * 중 하나라도 쓰는 파일이 `wr_students` 를 읽는다면, 그 select 에 두 칸이 들어 있어야 합니다.
 *
 * ── 네 번째에 알게 된 것 ──────────────────────────────────────────────
 *
 * 네 번째로 또 났습니다. 이번에는 **select 가 멀쩡했습니다.** 조회에는 birth_date 가 있었고,
 * 바로 아래 손으로 쓴 `map` 에서 그 줄이 빠져 있었습니다.
 *
 *     .select("id, name, name_en, grade, birth_date, class_name")   ← 있음
 *     ...map((s) => ({ id, name, name_en: …, grade: … }))            ← 없음
 *
 * 검사기는 통과했고 화면은 그냥 「김재이」였습니다. **헛통과하는 검사기는 없는 것보다
 * 나쁩니다** - 사람이 「검사를 통과했으니 맞겠지」라고 믿게 만들기 때문입니다.
 *
 * 그래서 옮기는 자리도 봅니다. 명부 줄을 손으로 만들지 말고 `toRosterEntries()` 를 쓰게
 * 하고, 그걸 안 쓰고 `name_en:` 이 든 객체를 손으로 만들면 두 칸이 함께 있는지 봅니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NEEDS = ["class_name", "birth_date"];
const USERS = /matchStudent|studentLabel|markIfAmbiguous|toKoreanDisplayName/;

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
for (const file of walk("src")) {
  const src = readFileSync(file, "utf8");
  if (!USERS.test(src)) continue;
  if (src.includes("roster-columns-ok")) continue;

  // `from("wr_students")` 뒤에 이어지는 `.select("…")` 를 찾습니다.
  for (const m of src.matchAll(/from\(\s*["']wr_students["']\s*\)([\s\S]{0,400}?)\.select\(\s*["']([^"']*)["']/g)) {
    const cols = m[2];
    // 학생 한 명만 집어오는 조회(class_id 같은 한두 칸)는 명부가 아닙니다.
    if (!cols.includes("name")) continue;
    const missing = NEEDS.filter((c) => !cols.includes(c));
    if (missing.length > 0) {
      const line = src.slice(0, m.index).split("\n").length;
      bad.push({ file, line, what: `읽는 칸: ${cols}`, missing });
    }
  }

  // 읽어온 줄을 **손으로 옮기는 자리**. `name_en:` 이 들어간 객체는 명부 줄입니다.
  // 여기서 두 칸이 빠지면 조회가 아무리 멀쩡해도 가를 재료가 사라집니다.
  for (const m of src.matchAll(/\{([\s\S]{0,500}?)\bname_en\s*:([\s\S]{0,500}?)\}/g)) {
    const body = `${m[1]} name_en:${m[2]}`;
    // 타입 선언(`name_en: string | null`)은 값을 옮기는 자리가 아닙니다.
    if (/name_en\s*:\s*(string|number|boolean)\b/.test(body)) continue;
    const missing = NEEDS.filter((c) => !new RegExp(`\\b${c}\\s*:`).test(body));
    if (missing.length === 0) continue;
    const line = src.slice(0, m.index).split("\n").length;
    bad.push({ file, line, what: "명부 줄을 손으로 옮기는 자리", missing });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 동명이인을 가르는 화면이 가를 재료를 안 읽고 있습니다.\n");
  console.error("  반(class_name)과 생일(birth_date)이 없으면 김재이 셋을 구별할 수 없고,");
  console.error("  화면에는 오류가 아니라 그냥 «김재이» 로 보입니다.\n");
  for (const b of bad) {
    console.error(`  ${b.file}:${b.line}\n    ${b.what}\n    빠진 칸: ${b.missing.join(", ")}`);
  }
  console.error("\n  고치는 법: @/lib/pickupParse 의 ROSTER_SELECT 와 toRosterEntries() 를 쓰세요.");
  console.error("    .select(ROSTER_SELECT) … → toRosterEntries(data)");
  console.error("  정말 필요 없는 자리면 파일에 // roster-columns-ok: 이유 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 명부 칸 검사 통과 (동명이인을 가를 재료를 읽고 있습니다)");
