/**
 * **미납금 대장** — 아직 안 받은 돈을 따로 모아 관리합니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 미납은 **청구서를 새로 발행할 때 저절로 얹혔습니다**(`planCarryForward`). 학부모가 한 장만
 * 보면 되니 좋아 보였고, 그 코드의 주석은 이렇게 적혀 있었습니다 -
 * 「금액이 눈덩이처럼 불어납니다」. 버그가 아니라 **설계대로 동작한 결과**였습니다.
 *
 * 8~9월 올톡페이 실측:
 *
 *   | 청구 금액   | 건수 | 청구액   | 수납률 |
 *   |------------|-----|---------|-------|
 *   | ~30만      | 15  | 149만    | 57.8% |
 *   | 30~100만   | 14  | 877만    | 19.2% |
 *   | 100~200만  |  2  | 338만    | 44.4% |
 *   | 200~500만  |  5  | 1,135만  |  0%   |
 *   | 500만~     |  2  | 2,055만  |  0%   |
 *
 * **200만원을 넘으면 한 건도 안 걷혔습니다.** 1,081만원짜리 한 장은 아무도 못 냅니다. 그리고
 * 그 한 장에는 「미납인보이스 정산」이라고만 적혀 있어서, 학부모는 무슨 돈인지도 모릅니다.
 *
 * ── 어떻게 바꾸나 ───────────────────────────────────────────────────────────
 *
 * 합치는 것을 **발행이 저절로 하지 않고, 사람이 미납금 화면에서 고릅니다.** 고를 수 있는
 * 것은 둘입니다.
 *
 *   · **따로 다시 보내기** — 원 청구서를 그대로 다시 보냅니다. 금액이 작고 무슨 돈인지
 *     학부모가 알아봅니다. 실측에서 30만 이하가 57.8% 로 가장 잘 걷혔습니다.
 *   · **합쳐서 한 장** — 정말 한 장으로 정리해야 할 때만. 합계가 크면 화면이 말립니다.
 *
 * 이 파일은 **판단만** 합니다. 합치고 잠그는 일은 `carryForward.ts` 가 그대로 합니다.
 */

/**
 * 이 금액을 넘으면 합치기 전에 사람에게 묻습니다.
 *
 * 처음에는 100만원으로 두었는데, **실제 인보이스가 거의 다 그 선을 넘습니다** - 한 학기
 * 교재비와 교복만 합쳐도 30만원대이고 학비가 얹히면 수백만원입니다. 그래서 경고가 거의
 * 모든 줄에 떴고, **늘 뜨는 경고는 아무도 안 읽습니다**(CLAUDE.md §1 — 자꾸 헛걸리는
 * 검사기는 없는 것과 같습니다).
 *
 * 실측에서 수납률이 실제로 무너지는 자리는 **200만원 위**입니다(200만 초과 7건 3,190만원,
 * 수납 0원). 그 아래 두 단계를 두어, 300만원에서 한 번 말리고 200만원 위에서는 강하게
 * 말립니다.
 */
export const BIG_INVOICE_WON = 3_000_000;

export type UnpaidInvoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name: string;
  student_name_ko?: string | null;
  issue_date: string;
  due_date: string;
  total_amount: number | string;
  status: string;
  stream?: string | null;
  category?: string | null;
  /** 이미 다른 청구서로 합쳐진 것. 여기서 또 세면 같은 돈을 두 번 청구합니다. */
  carried_to_invoice_id?: string | null;
  exported_at?: string | null;
};

export type UnpaidPayment = { invoice_id: string | null; amount: number | string };

/** 연체 구간. 90일 넘은 돈은 받는 방법이 다릅니다 - 재발송으로는 안 걷힙니다. */
export type AgingBucket = "기한 전" | "1~30일" | "31~60일" | "61~90일" | "90일 초과";

export const AGING_ORDER: AgingBucket[] = ["90일 초과", "61~90일", "31~60일", "1~30일", "기한 전"];

/** 마감일에서 며칠 지났나. 오늘이 마감일이면 0(아직 안 넘김). */
export function overdueDays(dueDate: string, today: string): number {
  const a = Date.parse(`${dueDate}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function agingOf(days: number): AgingBucket {
  if (days <= 0) return "기한 전";
  if (days <= 30) return "1~30일";
  if (days <= 60) return "31~60일";
  if (days <= 90) return "61~90일";
  return "90일 초과";
}

export type UnpaidRow = {
  invoice: UnpaidInvoice;
  /** 아직 안 받은 금액. 일부만 낸 경우가 있어 청구액과 다릅니다. */
  balance: number;
  paid: number;
  days: number;
  aging: AgingBucket;
  /** 갈래. 학비와 학비외를 섞어 합치면 어느 쪽이 얼마 걷혔는지 셀 수 없습니다. */
  stream: string;
};

export type UnpaidGroup = {
  studentId: string;
  label: string;
  rows: UnpaidRow[];
  total: number;
  /** 이 집에서 가장 오래된 미납의 구간. 목록 순서를 이걸로 정합니다. */
  worst: AgingBucket;
  /** 합계가 커서 한 장으로 보내면 안 걷힐 위험. */
  tooBig: boolean;
};

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 갈래. 옛 줄은 stream 이 비어 있어 category 로 되짚습니다(settlement.ts 와 같은 규칙). */
function streamOf(inv: UnpaidInvoice): string {
  if (inv.stream === "학비" || inv.stream === "학비외") return inv.stream;
  return inv.category === "학비" ? "학비" : "학비외";
}

/**
 * 미납 청구서를 학생별로 묶습니다.
 *
 * **학생 번호로 묶습니다.** 이름으로 묶으면 김재이 셋의 미납이 한 칸에 섞이고, 그 상태로
 * 합쳐 보내면 남의 돈이 청구됩니다(CLAUDE.md 2-4-1). 번호가 없는 옛 줄은 넣지 않고
 * `orphans` 로 따로 돌려줍니다 - 누구 것인지 모르는 채로 청구할 수는 없습니다.
 */
export function buildUnpaidLedger(
  invoices: readonly UnpaidInvoice[],
  payments: readonly UnpaidPayment[],
  opts: { today: string; nameOf: (id: string) => string | null },
): { groups: UnpaidGroup[]; orphans: UnpaidRow[]; total: number } {
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + num(p.amount));
  }

  const rows: UnpaidRow[] = [];
  for (const inv of invoices) {
    // 취소된 것과 이미 합쳐진 것은 미납이 아닙니다. 여기서 또 세면 같은 돈을 두 번 청구합니다.
    if (inv.status !== "발행") continue;
    if (inv.carried_to_invoice_id) continue;
    const paid = paidBy.get(inv.id) ?? 0;
    const balance = num(inv.total_amount) - paid;
    // 더 받은 것(음수)은 미납이 아닙니다. 선입금 화면이 다룰 일입니다.
    if (balance <= 0) continue;
    const days = overdueDays(inv.due_date, opts.today);
    rows.push({ invoice: inv, balance, paid, days, aging: agingOf(days), stream: streamOf(inv) });
  }

  const byStudent = new Map<string, UnpaidRow[]>();
  const orphans: UnpaidRow[] = [];
  for (const r of rows) {
    if (!r.invoice.student_id) {
      orphans.push(r);
      continue;
    }
    const list = byStudent.get(r.invoice.student_id) ?? [];
    list.push(r);
    byStudent.set(r.invoice.student_id, list);
  }

  const rank = (b: AgingBucket) => AGING_ORDER.indexOf(b);
  const groups: UnpaidGroup[] = [];
  for (const [studentId, list] of byStudent) {
    const total = list.reduce((n, r) => n + r.balance, 0);
    groups.push({
      studentId,
      label: opts.nameOf(studentId) ?? list[0].invoice.student_name_ko ?? list[0].invoice.student_name,
      // 오래된 것이 위. 「언제 것부터 밀렸나」가 대응을 정합니다.
      rows: list.sort((a, b) => a.invoice.due_date.localeCompare(b.invoice.due_date)),
      total,
      worst: list.reduce<AgingBucket>((w, r) => (rank(r.aging) < rank(w) ? r.aging : w), "기한 전"),
      tooBig: total > BIG_INVOICE_WON,
    });
  }

  // 오래 밀린 집부터, 같으면 큰 금액부터. 「누구에게 먼저 연락할까」가 목록 순서로 보여야 합니다.
  groups.sort((a, b) => rank(a.worst) - rank(b.worst) || b.total - a.total || a.label.localeCompare(b.label, "ko"));
  return { groups, orphans, total: rows.reduce((n, r) => n + r.balance, 0) };
}

/**
 * 고른 청구서들을 **한 장으로 합쳐도 되는가.**
 *
 * 막지 않고 말합니다 - 정말 한 장으로 정리해야 하는 경우가 있습니다. 다만 그때 어떤 일이
 * 벌어지는지는 알고 눌러야 합니다.
 */
export function mergeWarning(rows: readonly UnpaidRow[]): string | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((n, r) => n + r.balance, 0);
  const streams = new Set(rows.map((r) => r.stream));

  if (streams.size > 1) {
    return "학비와 학비외를 한 장에 섞습니다. 합치면 「학비가 얼마 걷혔나」를 따로 셀 수 없게 됩니다.";
  }
  if (total > 2_000_000) {
    return `합계 ${total.toLocaleString("ko-KR")}원입니다. 8~9월 실측에서 200만원을 넘긴 청구서는 **한 건도 안 걷혔습니다** — 따로 보내는 편이 낫습니다.`;
  }
  if (total > BIG_INVOICE_WON) {
    return `합계 ${total.toLocaleString("ko-KR")}원입니다. 이만큼 커지면 학부모가 한 번에 내기 어렵습니다 — 따로 보내는 것을 먼저 생각해보세요.`;
  }
  return null;
}
