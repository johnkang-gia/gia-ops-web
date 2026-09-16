/**
 * **이미 받은 돈을 적는 규칙** — 항목별 체크와 금액을 함께 다룹니다.
 *
 * ── 왜 두 가지를 다 받아야 하나 ──────────────────────────────────────
 *
 * 실제로 돈이 들어오는 모양이 두 가지입니다.
 *
 * **① 항목별로 들어옵니다.** 올톡페이는 항목마다 따로 결제 문자가 나갑니다. 그래서
 *    교복은 결제했는데 교재는 안 한 집이 생깁니다. 금액만 적으면 「23만원 받음」으로만
 *    남고, **무엇이 남았는지**를 아무도 모릅니다.
 *
 * **② 금액만 들어옵니다.** 미납이 쌓인 집은 「이번엔 30만원만」처럼 나눠 냅니다. 그 돈이
 *    어느 항목의 것인지 학부모도 정하지 않았고, 우리가 임의로 나누면 틀린 장부가 됩니다.
 *
 * 하나만 받게 만들면 나머지 절반은 늘 손으로 메모해야 하고, 메모는 장부가 아닙니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 항목을 체크하면 **금액이 저절로 채워집니다.** 그 금액을 고치면 고친 값이 이깁니다 -
 * 「교복·교재 체크했지만 실제로는 20만원만 들어옴」이 그대로 적힙니다.
 *
 * 무엇을 체크했는지는 **메모가 아니라 값으로** 남깁니다. 나중에 「교재는 아직 안 냈다」를
 * 셀 수 있어야 하기 때문입니다.
 */

export type PayableLine = {
  /** 요금 항목 id(학비) 또는 학비외 항목 id. 무엇을 체크했는지 남기는 열쇠입니다. */
  id: string;
  label: string;
  amount: number;
  /**
   * 이미 청구서에 담겨 있으면 그 상태를 적습니다(「받음」·「청구됨」). 있으면 화면이 그
   * 줄을 회색으로 잠급니다 - 다시 고를 수 있게 두면 같은 항목이 두 장에 담깁니다.
   */
  lockedNote?: string | null;
};

export type AlreadyPaidInput = {
  /** 체크한 항목 id. 비어 있으면 「항목은 안 고르고 금액만」입니다. */
  pickedIds: string[];
  /** 사람이 손으로 적은 금액. 비어 있으면 체크한 항목의 합을 씁니다. */
  typedAmount: string;
};

/** 체크한 항목의 합. 항목을 안 고르면 0입니다. */
export function sumPicked(lines: PayableLine[], pickedIds: readonly string[]): number {
  const picked = new Set(pickedIds);
  return lines.filter((l) => picked.has(l.id)).reduce((n, l) => n + (Number(l.amount) || 0), 0);
}

/**
 * 실제로 적을 금액.
 *
 * **손으로 적은 값이 언제나 이깁니다.** 체크는 「무엇에 대한 돈인가」를 말하고, 금액은
 * 「얼마가 들어왔는가」를 말합니다. 둘이 어긋나는 것은 오류가 아니라 흔한 일입니다 -
 * 항목 두 개를 체크했는데 반만 보낸 집이 있습니다.
 */
export function resolveAmount(lines: PayableLine[], input: AlreadyPaidInput): number {
  const typed = Number(String(input.typedAmount ?? "").replace(/[^\d.-]/g, ""));
  if (Number.isFinite(typed) && typed > 0) return Math.round(typed);
  return Math.round(sumPicked(lines, input.pickedIds));
}

/** 적힌 금액과 체크한 합이 다른가. 다르면 화면이 그 사실을 그대로 적습니다. */
export function mismatch(lines: PayableLine[], input: AlreadyPaidInput): { picked: number; actual: number; differs: boolean } {
  const picked = sumPicked(lines, input.pickedIds);
  const actual = resolveAmount(lines, input);
  return { picked, actual, differs: input.pickedIds.length > 0 && picked !== actual };
}

/**
 * 입금 기록에 남길 한 줄.
 *
 * 체크한 항목 이름을 그대로 적습니다 - **이름이 없으면 나중에 아무 뜻이 없습니다.**
 * 「id 3개」로 남기면 항목이 바뀌거나 꺼졌을 때 무슨 돈이었는지 설명할 수 없습니다.
 */
export function paidMemo(lines: PayableLine[], input: AlreadyPaidInput, note = ""): string {
  const picked = new Set(input.pickedIds);
  const names = lines.filter((l) => picked.has(l.id)).map((l) => l.label);
  const m = mismatch(lines, input);

  const parts: string[] = [];
  if (names.length > 0) parts.push(`받은 항목: ${names.join(" · ")}`);
  else parts.push("항목 없이 금액만 받음");
  // 어긋나면 **그 사실을 적습니다.** 안 적으면 며칠 뒤에 「왜 금액이 안 맞지」가 됩니다.
  if (m.differs) parts.push(`체크한 합 ${m.picked.toLocaleString()}원 중 ${m.actual.toLocaleString()}원 받음`);
  const extra = String(note ?? "").trim();
  if (extra) parts.push(extra);
  return parts.join(" / ").slice(0, 300);
}

/** 남은 항목(체크 안 한 것). 화면이 「아직 안 받은 것」으로 보여줍니다. */
export function remaining(lines: PayableLine[], pickedIds: readonly string[]): PayableLine[] {
  const picked = new Set(pickedIds);
  return lines.filter((l) => !picked.has(l.id));
}

/** 화면에 적는 금액. 천 단위 쉼표. */
export function won(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString()}원`;
}

// ── 항목마다 받은 날이 다를 때 ───────────────────────────────────────────────

/**
 * **교복은 8월 24일, 교재비는 8월 28일에 받았습니다.**
 *
 * 올톡페이는 항목마다 결제 문자가 따로 나가므로, 한 집에서 며칠 간격으로 나눠 들어오는
 * 일이 흔합니다. 그런데 이 창은 받은 날을 **하나만** 받았습니다. 그래서 둘 다 적으려면
 * 창을 두 번 열어야 했고, 두 번째는 대개 안 열었습니다 - 안 적힌 돈은 미납으로 남습니다.
 *
 * ── 왜 날짜별로 청구서를 나누나 ─────────────────────────────────────────────
 *
 * 청구서 날짜가 곧 **그 돈이 잡히는 달**입니다(`billing_month`). 8월 24일과 28일을 한 장에
 * 묶으면 둘 다 한 날짜로 눕고, 월 마감에서 숫자가 어긋납니다. 며칠 차이는 같은 달이라
 * 괜찮아 보이지만, 8월 31일과 9월 1일이 섞이는 날이 반드시 옵니다.
 *
 * 순수 함수입니다 — 화면 없이 시험할 수 있습니다.
 */
export type DatedPick = {
  id: string;
  /** 'YYYY-MM-DD'. 비어 있으면 부르는 쪽이 공통 날짜를 넣어 줍니다. */
  paidAt: string;
};

export type PaidBatch = {
  paidAt: string;
  itemIds: string[];
  /** 그 날 받은 금액. 체크한 항목의 합입니다. */
  amount: number;
  /** 그 날 받은 항목 이름. 입금 메모에 그대로 들어갑니다. */
  labels: string[];
};

/**
 * 고른 항목을 **받은 날로 묶습니다.** 날짜가 하나면 묶음도 하나입니다.
 *
 * 날짜 순으로 돌려줍니다 - 만들어지는 청구서 번호가 받은 순서를 따라가야 나중에 장부를
 * 훑을 때 읽힙니다.
 */
export function batchByDate(lines: PayableLine[], picks: readonly DatedPick[], fallbackDate: string): PaidBatch[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const groups = new Map<string, PaidBatch>();
  for (const p of picks) {
    const line = byId.get(p.id);
    if (!line) continue; // 표에 없는 항목. 조용히 버리지 않고 부르는 쪽이 셀 수 있게 아래에서 세어 줍니다.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paidAt) ? p.paidAt : fallbackDate;
    const g = groups.get(day) ?? { paidAt: day, itemIds: [], amount: 0, labels: [] };
    g.itemIds.push(line.id);
    g.labels.push(line.label);
    g.amount += Number(line.amount) || 0;
    groups.set(day, g);
  }
  return [...groups.values()].sort((a, b) => a.paidAt.localeCompare(b.paidAt));
}

/** 묶음이 여럿인가. 화면이 「청구서 2장으로 나눠 만듭니다」라고 미리 말해 줍니다. */
export function batchNote(batches: readonly PaidBatch[]): string {
  if (batches.length <= 1) return "";
  return `받은 날이 ${batches.length}가지라 청구서를 ${batches.length}장으로 나눠 만듭니다 — ${batches
    .map((b) => `${b.paidAt.slice(5).replace("-", "/")} ${won(b.amount)}`)
    .join(" · ")}`;
}
