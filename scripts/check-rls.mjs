#!/usr/bin/env node
/**
 * **자물쇠 없는 표를 찾습니다.**
 *
 * 표를 만들 때는 RLS 생각이 안 납니다. 만들고 화면이 잘 뜨면 다 된 것처럼 보이고,
 * 실제로 잘 뜹니다 - 자물쇠가 없으면 누구에게나 잘 뜨니까요. **안 잠긴 표는 잠기지
 * 않았다는 사실 자체가 화면에 안 나타납니다.**
 *
 * 이 저장소에서 실제로 났습니다. 청구서·수납·요금 등 열여덟 개 표가 RLS 없이 몇 주를
 * 돌았고, Supabase 가 메일로 알려주고서야 알았습니다.
 *
 * 그래서 마이그레이션이 만드는 표는 **같은 저장소 안 어딘가에서** RLS를 켜야 합니다.
 * 정말 켜면 안 되는 자리라면 그 파일에 `-- rls-ok: 이유` 를 적습니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

const created = new Map(); // 표 → 만든 파일
const locked = new Set();
const excused = new Map(); // 표 → 이유

for (const f of files) {
  const sql = readFileSync(join(DIR, f), "utf8");
  for (const m of sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) {
    if (!created.has(m[1])) created.set(m[1], f);
  }
  // 직접 켠 것
  for (const m of sql.matchAll(/alter table (?:public\.)?([a-z_]+)\s+enable row level security/g)) locked.add(m[1]);
  // 목록을 돌며 켜는 것(do 블록)도 셉니다 - 표 이름이 배열에 적혀 있습니다.
  if (/enable row level security/.test(sql) && /foreach/.test(sql)) {
    for (const m of sql.matchAll(/'([a-z_]+)'/g)) locked.add(m[1]);
  }
  for (const m of sql.matchAll(/--\s*rls-ok:\s*([^\n]+)/g)) {
    // 바로 위/아래의 표 이름을 찾기보다, 그 파일이 만든 표 전부를 면제합니다.
    for (const [t, file] of created) if (file === f) excused.set(t, m[1].trim());
  }
}

const missing = [...created.entries()].filter(([t]) => !locked.has(t) && !excused.has(t));

if (missing.length > 0) {
  console.error("\n✗ RLS(행 수준 보안)를 안 켠 표가 있습니다.\n");
  for (const [t, f] of missing) console.error(`  ${t}\t(${f})`);
  console.error(`
  안 잠긴 표는 **로그인한 누구나 통째로 읽고 고칠 수 있습니다.** 화면에서 안 보여주는 것은
  예의이지 자물쇠가 아닙니다 - 주소만 알면 그대로 받아갈 수 있습니다.

  고치는 법 — 마이그레이션에 두 줄을 함께 넣으세요. **켜기만 하고 정책을 안 만들면
  아무도 못 읽는데, 그건 오류로 안 보이고 「자료가 없습니다」로 보입니다.**

    alter table public.표이름 enable row level security;
    create policy 표이름_read on public.표이름 for select using (public.is_giamicro_user());

  정말 열어둬야 하는 자리라면 그 파일에 \`-- rls-ok: 이유\` 를 적어주세요.
`);
  process.exit(1);
}

console.log(`✓ RLS 검사 통과 (표 ${created.size}개 · 면제 ${excused.size}개)`);
