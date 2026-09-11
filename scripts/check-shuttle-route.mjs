#!/usr/bin/env node
/**
 * 「이 아이는 어느 차를 타는가」를 **자기 파일에서 다시 정하는 코드**를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 셔틀 명단에서 이예온을 28호에 넣었는데 하원 체크표에는 다른 호차에 떴습니다. 자료는
 * 멀쩡했습니다 - 두 화면이 **서로 다른 질문에 답하고 있었을 뿐**입니다.
 *
 *   · 체크표 — 오늘만 이동 ?? 계속 이동 ?? 정류장의 노선
 *   · 명단   — 정류장의 노선 (이동 칸을 아예 안 읽음)
 *
 * 규칙 자체는 여덟 군데에 손으로 적혀 있었고, 괄호 위치가 조금씩 달랐습니다. 한 곳을 고치면
 * 나머지 일곱 곳은 그대로 남습니다. 그리고 **잊은 화면은 오류를 내지 않습니다** - 그냥 다른
 * 답을 합니다.
 *
 * 하원 체크표는 인쇄해서 씁니다. 종이에 없는 아이는 아무도 안 찾고, 엉뚱한 줄에 있는 아이는
 * 엉뚱한 차에 탑니다. 되돌릴 수 없습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 판정은 `src/lib/shuttleRoute.ts` 의 `effectiveRouteId` / `routeChoiceOf` 한 곳에서만
 * 합니다. `override_route_id` 를 읽는 파일이 그 함수를 하나도 안 쓰고 있으면 여기서 막습니다.
 *
 * 정말 따로 다뤄야 하는 자리라면(칸을 그냥 저장만 하는 API 등) 그 파일에
 * `// shuttle-route-ok: 이유` 를 적습니다. 끄는 것은 쉬워야 하지만 왜 껐는지는 남아야 합니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ALLOW = "shuttle-route-ok:";
const LIB = "src/lib/shuttleRoute.ts";
/** 공용 판정을 지나갔다고 인정하는 이름들. */
const USES = ["effectiveRouteId", "routeChoiceOf", "isMovedToday", "isMovedPermanently", "moveNote"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const problems = [];
for (const file of walk(ROOT)) {
  if (file === LIB) continue;
  const text = readFileSync(file, "utf8");
  if (!text.includes("override_route_id")) continue;
  if (text.includes(ALLOW)) continue;
  if (USES.some((n) => text.includes(n))) continue;

  const line = text.split("\n").findIndex((l) => l.includes("override_route_id")) + 1;
  problems.push(`${file}:${line}`);
}

if (problems.length > 0) {
  console.error("\n✗ 노선 이동(override_route_id)을 공용 판정 없이 다루는 파일이 있습니다.\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(`
   이 파일은 「어느 차를 타는가」를 자기 방식으로 정하게 됩니다. 다른 화면과 답이 달라져도
   오류는 안 납니다 - 그냥 다른 명단이 나옵니다. 체크표는 인쇄해서 쓰는 종이입니다.

       import { effectiveRouteId, routeChoiceOf } from "@/lib/shuttleRoute";
       const routeId = effectiveRouteId(
         routeChoiceOf(
           { stopRouteId: stop.route_id, assignmentOverride: a.override_route_id, boardingOverride: b?.override_route_id },
           (id) => routeIdSet.has(id),
         ),
       );

   칸을 저장만 하고 판정은 안 하는 자리라면 그 파일에 「// shuttle-route-ok: 이유」 를 적어주세요.
`);
  process.exit(1);
}

console.log("✓ 노선 판정 검사 통과 (명단·체크표가 같은 답을 합니다)");
