#!/usr/bin/env node
/**
 * **이름으로 학생을 골라 손대는 코드**가 「그 이름이 한 명인지」를 확인하는지 검사합니다.
 *
 * ── 왜 또 만드나 ─────────────────────────────────────────────────────
 *
 * 김재이·심재이·유재이 셋이 한꺼번에 픽업으로 들어가는 일이 **네 번** 났습니다. 그때마다
 * 가르는 규칙(`pickupParse` · `studentMatch`)은 멀쩡했습니다. 매번 **다른 자리**가 그 규칙을
 * 거치지 않고 이름으로 곧장 골랐던 것이 원인이었습니다.
 *
 *   1회차  화면이 `class_name` · `birth_date` 를 안 읽어옴      → check-roster-columns
 *   2회차  `Map<이름, 반>` 을 만들어 셋이 한 칸을 나눠 씀       → check-roster-columns
 *   3회차  옮기는 자리에서 두 칸이 빠짐                          → check-roster-columns
 *   4회차  `othersMentioned` 가 「재이」로 셋을 다 찾아 줄 3개 만듦
 *          `attendance-action` 이 이름으로 배정을 골라 셋을 다 결석 처리
 *
 * 앞의 세 번을 막은 검사기(`check-roster-columns`)는 **가르는 함수를 쓰는 파일**만 봅니다.
 * 4회차의 두 자리는 그 함수를 아예 안 씁니다 - 이름 글자만 맞대고 끝냈으니 검사기의
 * 그물에 애초에 안 걸렸습니다. **안 쓰는 코드는 안 걸리는 검사기**는 같은 사고를 또
 * 놓칩니다.
 *
 * 그래서 이 검사기는 반대로 봅니다. **이름으로 고르는 행동 자체**를 찾고, 그 파일이 「이 이름이
 * 한 명인가」를 확인하는 재료를 들고 있는지 봅니다.
 *
 * ── 면제 ─────────────────────────────────────────────────────────────
 *
 * 정말 이름만으로 해야 하는 자리라면 그 줄 위에 `// homonym-ok: 이유` 를 적습니다. 끄는 것은
 * 쉬워야 하지만 왜 껐는지는 남아야 합니다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 이름으로 학생을 고르는 행동. 여기 걸리면 「그 이름이 한 명인가」를 물어야 합니다.
 *
 * **좁게 찾습니다.** `.eq("name", …)` 은 교실 색·정류장·본교 위치에도 쓰여서, 그냥 찾으면
 * 학생과 상관없는 파일이 다섯 개 걸립니다. 헛걸리는 검사기는 사람이 곧 무시하게 되고,
 * 무시당하는 검사기는 없는 것과 같습니다.
 */
const NAME_KEYED = [
  // 명부 전체에서 이름 표기를 훑는 자리. 「재이」가 김재이·심재이·유재이 셋 모두의 표기입니다.
  { re: /\bnameSurfaces\s*\(/, what: "nameSurfaces() 로 명부를 훑습니다" },
  // **명부 표**를 이름 칸으로 조회하는 자리. 같은 조회 안에 있는 것만 봅니다.
  { re: /from\(\s*"wr_students"\s*\)(?:[^;]{0,400}?)\.eq\(\s*"name"\s*,/s, what: 'wr_students 를 .eq("name", …) 으로 찾습니다' },
  // 배정 줄의 이름을 맞대는 자리.
  { re: /student_name_raw[^\n]*===|===[^\n]*student_name_raw/, what: "student_name_raw 를 이름으로 맞댑니다" },
];

/** `nameSurfaces` 를 만들어 내보내는 파일 자신은 대상이 아닙니다. */
const DEFINES = /export function nameSurfaces/;

/**
 * 「그 이름이 한 명인가」를 확인하는 재료. 하나라도 있으면 통과입니다.
 *
 * 있다고 해서 반드시 제대로 쓴다는 뜻은 아닙니다. 다만 **없으면 확실히 못 가릅니다** -
 * 검사기가 할 수 있는 일은 여기까지이고, 이 문턱만으로 4회차의 두 자리는 둘 다 걸립니다.
 */
const GUARDS = /student_id|studentId|homonym|needsCheck|whereOf|markIfAmbiguous|surfaceOwners|ambiguousNote|birthFits/;

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
  if (src.includes("homonym-ok:")) continue;
  if (DEFINES.test(src)) continue;
  if (GUARDS.test(src)) continue;
  for (const { re, what } of NAME_KEYED) {
    if (re.test(src)) bad.push({ file, what });
  }
}

if (bad.length > 0) {
  console.error("\n✗ 이름으로 학생을 고르는데 동명이인을 가릴 재료가 없습니다.\n");
  console.error("  김재이가 셋인 학교입니다. 이름만으로 고르면 셋이 함께 걸리고,");
  console.error("  화면에는 오류가 아니라 «처리됨»으로 보입니다.\n");
  for (const b of bad) console.error(`  ${b.file}\n    ${b.what}`);
  console.error("\n  고치는 법: 학생 번호(student_id)로 고르세요. 번호가 없으면");
  console.error("  buildHomonymSet/needsCheck 로 겹치는 이름인지 먼저 보고, 겹치면");
  console.error("  처리하지 말고 사람에게 물으세요.");
  console.error("  정말 이름만으로 해야 하면 그 줄 위에 `// homonym-ok: 이유` 를 적으세요.\n");
  process.exit(1);
}

console.log("✓ 이름으로 고르는 자리가 모두 동명이인을 가릴 재료를 들고 있습니다");
