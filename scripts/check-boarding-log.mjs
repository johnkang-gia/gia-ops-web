#!/usr/bin/env node
/**
 * 탑승 상태를 바꾸면서 **누가 바꿨는지 안 남기는 코드**를 찾습니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 「누가 픽업으로 바꿨는지」를 볼 수 있게 활동 기록(shuttle_checklist_log)을 만들어 뒀는데,
 * 정작 **하원 체크표에서 누른 것만** 기록에 남았습니다. 같은 표(shuttle_boardings)를 고치는
 * 자리가 네 곳 더 있었고, 그 자리들에서 바꾸면 표시는 바뀌는데 기록에는 아무것도 안 남습니다.
 *
 * 화면에는 오류가 아니라 **«아무도 안 한 것»처럼** 보입니다. 강서우·김도은이 그렇게 보였고,
 * 「누가 했지?」를 물었을 때 답할 곳이 없었습니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 상태를 바꾸는 일은 `src/lib/boardingWrite.ts` 의 `setBoardingStatus` 한 곳에서만 합니다.
 * 그 함수가 표 고치기와 기록 남기기를 함께 합니다 - 둘을 따로 두면 새 화면을 만들 때마다
 * 한쪽을 잊고, 잊었다는 사실은 몇 주 뒤에야 드러납니다.
 *
 * 정말 따로 써야 하는 자리라면 그 줄 근처에 `// boarding-ok: 이유` 를 적습니다. 끄는 것은
 * 쉬워야 하지만 왜 껐는지는 남아야 합니다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const ALLOW = "boarding-ok:";
/** 이 파일들은 판단의 원본이거나 상태를 바꾸지 않습니다. */
const SKIP_FILES = new Set(["src/lib/boardingWrite.ts"]);

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
  if (SKIP_FILES.has(file)) continue;
  const text = readFileSync(file, "utf8");
  if (!text.includes("shuttle_boardings")) continue;
  if (text.includes("setBoardingStatus")) continue; // 한 곳을 지나갑니다

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("shuttle_boardings")) continue;
    // 읽기만 하는 자리는 봐주지 않습니다 - 상태를 **쓰는** 자리만 찾습니다.
    const near = lines.slice(i, i + 14).join("\n");
    const writes = /\.(upsert|insert|update)\(/.test(near) && /status\s*:/.test(near);
    if (!writes) continue;
    // 면제 표시는 앞뒤 여섯 줄 안에서 찾습니다.
    const around = lines.slice(Math.max(0, i - 6), i + 14).join("\n");
    if (around.includes(ALLOW)) continue;
    problems.push(`${file}:${i + 1}`);
  }
}

if (problems.length > 0) {
  console.error("\n✗ 탑승 상태를 바꾸면서 「누가 바꿨는지」를 안 남기는 자리가 있습니다.\n");
  for (const p of problems) console.error(`   ${p}`);
  console.error(`
   상태 바꾸기는 src/lib/boardingWrite.ts 의 setBoardingStatus 하나만 씁니다.
   그 함수가 표 고치기와 활동 기록을 함께 합니다.

       import { setBoardingStatus } from "@/lib/boardingWrite";
       await setBoardingStatus(supabase, { serviceDate, assignmentId, studentName, status, actor });

   정말 따로 써야 하면 그 줄 근처에 「// boarding-ok: 이유」 를 적어주세요.
   기록이 안 남으면 화면에는 오류가 아니라 «아무도 안 한 것»으로 보입니다.
`);
  process.exit(1);
}

console.log("✓ 탑승 기록 검사 통과 (상태를 바꾸는 자리가 모두 누가 했는지 남깁니다)");
