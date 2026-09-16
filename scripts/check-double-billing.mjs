/**
 * **같은 돈을 두 번 청구하지 않게 막는 검사.**
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 학비외 청구서를 만드는 자리가 셋인데(발행 · 이미 받음 · 미납 재청구), **무엇이 이미
 * 나갔는지를 아무도 안 셌습니다.** 그래서 두 가지 사고가 났습니다.
 *
 *   · 교복을 청구한 뒤 교재비를 청구하려고 다시 발행 → 교복이 또 담김
 *   · 「이미 받음」에서 교복만 체크 → 청구서에는 교재비까지 담기고, 입금은 교복 값만
 *     붙어 그 청구서가 일부납으로 남음 → 이미 받은 항목이 미납·연체에 다시 뜸
 *
 * 둘 다 **오류로 안 보입니다.** 학부모 화면에는 그냥 「청구된 금액」으로 뜨고, 우리 화면에는
 * 「아직 안 낸 돈」으로 뜹니다.
 *
 * ── 무엇을 검사하나 ──────────────────────────────────────────────────
 *
 * 청구서를 만드는 창구(`/api/finance/invoices`)를 부르면서 **무엇을 담을지 안 정하는**
 * 자리를 찾습니다. `itemIds` 를 함께 보내거나, 정말 전부 담아야 하는 자리면 이유를
 * 적어야 합니다.
 *
 * 끄는 것은 쉬워야 하지만 왜 껐는지는 남아야 합니다 — `// double-billing-ok: 이유`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
/**
 * 청구서를 만드는 창구. 이 주소를 부르는 자리는 무엇을 담을지 정해야 합니다.
 *
 * **따옴표로 끝나는 것만** 찾습니다. `/api/finance/invoices/cancel` · `/pay` · `/tuition`
 * 은 다른 창구이고, 담을 항목을 정하는 일과 상관이 없습니다 - 이름이 비슷하다고 걸면
 * 검사기가 헛걸리고, 헛걸리는 검사기는 사람이 무시하게 됩니다.
 */
const ENDPOINT = /["'`]\/api\/finance\/invoices["'`]/;

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
for (const file of walk(ROOT)) {
  // 창구 자신은 검사하지 않습니다. 담을 것을 정하는 쪽이 아니라 정해진 것을 받는 쪽입니다.
  if (file.includes("api/finance/invoices")) continue;
  const text = readFileSync(file, "utf8");
  if (!ENDPOINT.test(text)) continue;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!ENDPOINT.test(lines[i])) continue;
    // 부르는 자리 앞뒤 스물다섯 줄 안에서 판단합니다. `fetch` 한 번이 그 안에 들어갑니다.
    const around = lines.slice(Math.max(0, i - 25), i + 25).join("\n");
    if (/double-billing-ok:/.test(around)) continue;
    if (/itemIds/.test(around)) continue;
    bad.push(`${file}:${i + 1}  ${lines[i].trim().slice(0, 90)}`);
  }
}

if (bad.length > 0) {
  console.error("\n✗ 청구서를 만들면서 **무엇을 담을지 안 정하는** 자리가 있습니다.\n");
  for (const b of bad) console.error(`  ${b}`);
  console.error(
    "\n  이 자리는 그 학생의 학비외 항목을 **전부** 담습니다. 이미 나간 항목까지 다시 담기면\n" +
      "  같은 돈이 두 번 청구되고, 학부모 화면에는 오류가 아니라 「청구된 금액」으로 보입니다.\n" +
      "\n  고치는 법: `billedItems` 로 이미 나간 것을 빼고 `itemIds` 를 함께 보내세요.\n" +
      "  정말 전부 담아야 하는 자리라면 그 근처에 `// double-billing-ok: 이유` 를 적으세요.\n",
  );
  process.exit(1);
}

console.log("✓ 중복청구 검사 통과 (청구서를 만드는 자리가 모두 담을 항목을 정합니다)");
