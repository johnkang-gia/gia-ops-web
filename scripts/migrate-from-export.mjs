#!/usr/bin/env node
// GIA 구글 시트 -> Supabase 데이터 이전 스크립트
//
// 사용법:
//   1) 구글 시트 메뉴 -> [마이그레이션] 사건·행사·회의 전체 데이터 JSON으로 내보내기 실행
//   2) 안내창에 뜬 드라이브 파일(GIA_migration_export_YYYYMMDD_HHmmss.json)을 다운로드
//   3) 이 프로젝트 루트에 .env.local 이 있는지 확인(SUPABASE_SERVICE_ROLE_KEY 포함 필요)
//   4) node scripts/migrate-from-export.mjs ./GIA_migration_export_20260716_090000.json
//
// service_role 키는 RLS를 무시하고 전체 테이블에 쓸 수 있는 강력한 키입니다.
// 절대 커밋하거나 브라우저/클라이언트 코드에 넣지 말고, 이 스크립트를 실행하는 동안만 사용하세요.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadDotEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env.local이 없으면 그냥 무시(환경변수를 다른 방식으로 넣었을 수도 있음)
  }
}
loadDotEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다. .env.local을 확인하세요."
  );
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("사용법: node scripts/migrate-from-export.mjs <내보내기.json 경로>");
  process.exit(1);
}

const raw = readFileSync(inputPath, "utf8");
const exportData = JSON.parse(raw);

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function mapIncident(it) {
  return {
    case_id: it.caseId,
    date: it.date || null,
    title: it.title || "",
    detail: it.detail || null,
    good: it.good || null,
    lack: it.lack || null,
    suggest: it.suggest || null,
    owner: it.owner || null,
    students: it.students || null,
    manual_cat: it.category || null,
    status: it.status || null,
  };
}

function mapMeeting(it) {
  return {
    case_id: it.caseId,
    date: it.date || null,
    attendees: it.attendees || null,
    content: it.content || "",
    status: it.status || null,
    next_agenda: it.nextAgenda || null,
    final_record: it.finalRecord || null,
  };
}

function mapEvent(it) {
  return {
    case_id: it.caseId,
    date: it.date || null,
    name: it.name || "",
    owner: it.owner || null,
    good: it.good || null,
    lack: it.lack || null,
    suggest: it.suggest || null,
    status: it.status || null,
  };
}

async function upsertAll(table, rows) {
  if (!rows.length) {
    console.log(`- ${table}: 내보낸 데이터 없음, 건너뜀`);
    return;
  }
  // case_id가 비어있으면 나중에 중복/충돌 원인이 되므로 미리 걸러내고 경고만 남김
  const withId = rows.filter((r) => r.case_id);
  const skipped = rows.length - withId.length;
  if (skipped > 0) {
    console.warn(`  ! ${table}: 고유코드(case_id)가 없는 ${skipped}건은 건너뜀`);
  }

  const CHUNK = 200;
  let done = 0;
  for (let i = 0; i < withId.length; i += CHUNK) {
    const chunk = withId.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: "case_id" });
    if (error) {
      console.error(`  ! ${table} upsert 오류(${i}~${i + chunk.length}행):`, error.message);
      process.exitCode = 1;
      continue;
    }
    done += chunk.length;
  }
  console.log(`- ${table}: ${done}/${withId.length}건 반영 완료`);
}

async function main() {
  console.log(`내보내기 파일: ${inputPath}`);
  console.log(
    `원본 건수 - 사건 ${exportData.incidents?.length ?? 0} / 행사 ${
      exportData.events?.length ?? 0
    } / 회의 ${exportData.meetings?.length ?? 0}`
  );
  console.log("Supabase로 이전을 시작합니다 (이미 있는 case_id는 덮어씁니다)...\n");

  await upsertAll("incidents", (exportData.incidents ?? []).map(mapIncident));
  await upsertAll("events", (exportData.events ?? []).map(mapEvent));
  await upsertAll("meetings", (exportData.meetings ?? []).map(mapMeeting));

  console.log("\n완료되었습니다. Supabase 대시보드의 Table Editor에서 건수를 한 번 확인해보세요.");
}

main().catch((err) => {
  console.error("마이그레이션 중 예상치 못한 오류:", err);
  process.exit(1);
});
