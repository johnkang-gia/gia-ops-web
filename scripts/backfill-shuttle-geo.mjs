#!/usr/bin/env node
// 정류장 gu(구)/dong(동)/좌표 일괄 백필 스크립트
//
// 지역별 현황 대시보드는 정류장 주소를 지오코딩해 받은 구/동을 기준으로 분류합니다. 지금까지는
// 스태프가 각 노선의 "노선도" 탭을 열어야만 그 노선 정류장들이 채워졌는데, 이 스크립트는 주소가
// 있는데 아직 구/동이 비어 있는 정류장을 한 번에 전부 채웁니다(카카오 로컬 API 주소 검색을
// 서버에서 직접 호출하므로 브라우저/지도 탭을 열 필요가 없습니다).
//
// 사용법:
//   1) supabase/schema.sql의 77-c/77-d 항목(gu/dong 컬럼 + 캐시 무효화 트리거)을 Supabase SQL
//      에디터에서 먼저 실행해 컬럼이 있어야 합니다.
//   2) .env.local에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / KAKAO_REST_API_KEY 필요.
//   3) node scripts/backfill-shuttle-geo.mjs
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
const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !KAKAO_REST_API_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / KAKAO_REST_API_KEY가 필요합니다. .env.local을 확인하세요."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocode(address) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const doc = data.documents?.[0];
  if (!doc) return null;
  const region = doc.address ?? doc.road_address ?? null;
  return {
    lat: parseFloat(doc.y),
    lng: parseFloat(doc.x),
    gu: region?.region_2depth_name ?? null,
    dong: region?.region_3depth_name ?? null,
  };
}

async function main() {
  const { data: stops, error } = await supabase
    .from("shuttle_stops")
    .select("id, address, gu, dong")
    .not("address", "is", null)
    .neq("address", "");
  if (error) {
    console.error("정류장 조회 실패:", error.message);
    process.exit(1);
  }

  const targets = stops.filter((s) => !s.gu || !s.dong);
  console.log(`주소가 있는 정류장 ${stops.length}곳 중 구/동이 비어있는 ${targets.length}곳을 채웁니다.`);

  let ok = 0;
  let fail = 0;
  const failed = [];
  for (const s of targets) {
    const geo = await geocode(s.address);
    if (!geo) {
      fail++;
      failed.push(s);
      console.log(`  실패: [${s.id}] "${s.address}" - 좌표를 찾지 못했습니다.`);
    } else {
      const { error: upErr } = await supabase
        .from("shuttle_stops")
        .update({
          lat: geo.lat,
          lng: geo.lng,
          gu: geo.gu,
          dong: geo.dong,
          geocoded_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (upErr) {
        fail++;
        failed.push(s);
        console.log(`  실패: [${s.id}] "${s.address}" - DB 갱신 오류: ${upErr.message}`);
      } else {
        ok++;
      }
    }
    await sleep(80); // 카카오 API 호출 속도 제한 여유
  }

  console.log(`\n완료: 성공 ${ok}곳, 실패 ${fail}곳.`);
  if (failed.length > 0) {
    console.log("실패한 정류장은 주소 표기를 다듬은 뒤 노선 관리 화면에서 주소를 다시 저장하면 자동으로 재시도됩니다:");
    for (const s of failed) console.log(`  - [${s.id}] ${s.address}`);
  }
}

main();
