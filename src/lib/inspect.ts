/**
 * **개발자 점검** — 코드·데이터·보호를 한 화면에서 재고, 결과를 그대로 복사해 전달합니다.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 *
 * 지금까지 이 점검들은 **사람이 요청할 때만** 돌았습니다. 표에 자물쇠가 없는지, 뷰가 로그인
 * 없이 읽히는지, 청구서 합계가 줄 합과 어긋났는지 - 전부 누가 「한번 봐줘」라고 해야 알았고,
 * 그 사이에는 **잘못된 상태가 잘못됐다는 사실 자체를 아무 데도 안 남긴 채** 돌았습니다.
 *
 * 실제로 뷰 아홉 개가 로그인 없이 읽혔고(재학생 138명의 보호자 전화번호 포함), 몇 주 동안
 * 어느 화면에도 그 사실이 안 나타났습니다.
 *
 * ── 왜 목록을 손으로 안 적나 ───────────────────────────────────────────────
 *
 * 열려 있는지 볼 표 목록을 여기 적으면 **새 표가 생길 때마다 여기 적는 것을 잊습니다.**
 * 잊은 표는 검사에 안 걸리고, 안 걸린다는 사실도 화면에 안 나타납니다 - 이 저장소에서
 * 반복된 실패가 정확히 그 모양입니다.
 *
 * 그래서 목록을 **PostgREST 에게 물어봅니다.** `/rest/v1/` 는 그 열쇠로 볼 수 있는 표·뷰를
 * 전부 적어 돌려줍니다. 로그인 안 한 열쇠로 물으면 **「로그인 없이 보이는 것」의 완전한
 * 목록**이 그대로 나옵니다. 적을 것이 없으면 빠뜨릴 것도 없습니다.
 *
 * ── 왜 복사인가 ────────────────────────────────────────────────────────────
 *
 * 문제를 찾아도 옮겨 적는 데서 사라집니다. 화면을 사진 찍어 보내면 글자를 다시 쳐야 하고,
 * 그 과정에서 표 이름이 틀립니다. 결과를 **글자 그대로** 복사할 수 있어야 합니다.
 */

export type CheckLevel = "정상" | "확인" | "문제";
export type InspectGroup = "코드" | "데이터" | "보호";

export type CheckResult = {
  group: InspectGroup;
  /** 사람이 읽는 검사 이름. */
  name: string;
  level: CheckLevel;
  /** 결과 한 줄. 숫자와 이름이 들어가야 합니다 - 「문제 있음」만으로는 아무것도 못 합니다. */
  detail: string;
  /** 어긋났을 때 무엇이 잘못되는지. 고칠지 말지를 여기서 정합니다. */
  impact?: string;
  /** 걸린 이름들. 복사본에 그대로 들어갑니다. */
  items?: string[];
};

export const GROUP_LABEL: Record<InspectGroup, string> = {
  코드: "① 코드 · 디버깅",
  데이터: "② 데이터 검사",
  보호: "③ 데이터 보호",
};

export const GROUP_NOTE: Record<InspectGroup, string> = {
  코드: "마이그레이션이 실제로 걸렸는지, 화면에서 난 오류가 남아 있는지, 짝 없는 자료 갈래가 있는지.",
  데이터: "화면에서는 멀쩡해 보이는데 서로 어긋난 자료. 오류가 아니라 「그냥 다른 숫자」로 보입니다.",
  보호: "로그인하지 않은 사람이 무엇까지 읽을 수 있는지. 실제로 그 열쇠로 물어봐서 확인합니다.",
};

export function levelMark(l: CheckLevel): string {
  return l === "정상" ? "✅" : l === "확인" ? "⚠️" : "❌";
}

/** 가장 나쁜 등급. 묶음 머리줄에 씁니다. */
export function worstOf(rows: readonly CheckResult[]): CheckLevel {
  if (rows.some((r) => r.level === "문제")) return "문제";
  if (rows.some((r) => r.level === "확인")) return "확인";
  return "정상";
}

/**
 * 복사해서 보낼 글. **문제부터 적습니다** - 받는 쪽이 위에서 세 줄만 읽어도 무엇이 급한지
 * 알아야 합니다. 정상인 검사는 이름만 한 줄에 몰아 적습니다.
 */
export function buildReport(rows: readonly CheckResult[], meta: { at: string; version: string }): string {
  const out: string[] = [];
  out.push(`GIA 운영앱 점검 — ${meta.at} (v${meta.version})`);

  const bad = rows.filter((r) => r.level !== "정상");
  out.push(bad.length === 0 ? "\n모든 검사 정상." : `\n손볼 것 ${bad.length}건.`);

  for (const g of ["보호", "데이터", "코드"] as const) {
    const mine = rows.filter((r) => r.group === g);
    if (mine.length === 0) continue;
    out.push(`\n── ${GROUP_LABEL[g]} ──`);
    for (const r of mine.filter((r) => r.level !== "정상")) {
      out.push(`${levelMark(r.level)} ${r.name} — ${r.detail}`);
      if (r.impact) out.push(`   ↳ ${r.impact}`);
      // 이름은 스무 개까지. 그 이상은 세어서 적습니다 - 붙여넣기가 길어지면 아무도 안 읽습니다.
      if (r.items?.length) {
        out.push(`   ↳ ${r.items.slice(0, 20).join(", ")}${r.items.length > 20 ? ` 외 ${r.items.length - 20}건` : ""}`);
      }
    }
    const ok = mine.filter((r) => r.level === "정상").map((r) => r.name);
    if (ok.length) out.push(`✅ 정상: ${ok.join(" · ")}`);
  }
  return out.join("\n");
}
