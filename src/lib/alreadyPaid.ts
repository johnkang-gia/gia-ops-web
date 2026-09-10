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
