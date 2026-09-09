#!/usr/bin/env node
/**
 * 시스템 카탈로그를 뒤지는 SQL에서 **`name` 타입을 글자와 견주는** 자리를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * `pg_attribute.attname` 은 `text` 가 아니라 `name` 타입입니다. 그래서
 *
 *     array_agg(att.attname) = array['template_id', 'term_id']
 *
 * 는 `operator does not exist: name[] = text[]` 로 **실패합니다.** 문법은 멀쩡해서
 * 파서도 통과하고, 로컬에서는 데이터베이스가 없어 돌려볼 수도 없습니다.
 *
 * 이 한 줄 때문에 마이그레이션이 **일곱 판 연속으로 실패**했고, 그동안 뒤에 줄 서 있던
 * 재무 자물쇠·백업·학사일정·하원수단이 하나도 반영되지 않았습니다. 앞 파일이 막히면
 * 뒤는 시도조차 안 되기 때문입니다. 그런데 앱 화면에는 아무 표시도 안 났습니다 -
 * 배포는 성공했고, 코드는 새 칸을 쓰는데 칸이 없는 상태로 몇 판을 갔습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 카탈로그의 `name` 칸을 쓰면 `::text` 를 붙이게 합니다. 붙여서 손해 볼 일은 없고,
 * 안 붙이면 언젠가 같은 자리에서 또 막힙니다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
/** 포스트그레스 카탈로그에서 `name` 타입인 칸들. 글자와 견주려면 캐스팅이 필요합니다. */
const NAME_COLUMNS = ["attname", "relname", "nspname", "conname", "proname", "typname"];
const ALLOW = "sql-ok:";

const problems = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const path = join(DIR, file);
  const lines = readFileSync(path, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 주석 줄은 봅니다만, 설명에 적힌 예시까지 잡으면 헛걸립니다.
    if (line.trim().startsWith("--")) continue;
    for (const col of NAME_COLUMNS) {
      // `array_agg(x.attname` 처럼 모아서 배열로 견주는 자리만 봅니다. 낱개 비교
      // (`relname = 'tasks'`)는 포스트그레스가 알아서 맞춰주므로 문제가 없습니다.
      const re = new RegExp(`array_agg\\s*\\(\\s*(?:distinct\\s+)?[\\w.]*\\b${col}\\b(?!\\s*::)`, "i");
      if (!re.test(line)) continue;

      // **견주는 자리만** 잡습니다.
      //
      // `select array_agg(a.attname) into ukey` 처럼 변수에 담는 것은 문제가 없습니다 -
      // plpgsql 이 대입할 때 알아서 맞춰줍니다. 터지는 것은 `= array['a','b']` 로 글자
      // 배열과 **견줄 때**뿐입니다. 안 터지는 것까지 잡으면 검사기가 헛걸리고, 헛걸리는
      // 검사기는 사람이 무시하게 되고, 무시당하는 검사기는 없는 것과 같습니다.
      const ahead = lines.slice(i, i + 8).join("\n");
      if (!/=\s*array\s*\[/i.test(ahead)) continue;

      const around = lines.slice(Math.max(0, i - 4), i + 8).join("\n");
      if (around.includes(ALLOW)) continue;
      problems.push({ where: `${path}:${i + 1}`, col });
    }
  }
}

if (problems.length > 0) {
  console.error("\n✗ 카탈로그의 name 칸을 글자 배열과 견주고 있습니다. 실행하면 실패합니다.\n");
  for (const p of problems) console.error(`   ${p.where}  (${p.col})`);
  console.error(`
   array_agg(att.attname) 는 name[] 이고 array['a','b'] 는 text[] 라서,
   포스트그레스에 그 둘을 견주는 연산자가 없습니다:

       ERROR: operator does not exist: name[] = text[]

   ::text 를 붙여주세요.

       array_agg(att.attname::text order by att.attname::text) = array['a', 'b']

   정말 그대로 둬야 하면 그 줄 근처에 「-- sql-ok: 이유」 를 적어주세요.
   앞 파일이 막히면 뒤 마이그레이션은 시도조차 안 됩니다.
`);
  process.exit(1);
}

console.log("✓ 카탈로그 SQL 검사 통과 (name 칸을 글자와 견주는 자리가 없습니다)");
