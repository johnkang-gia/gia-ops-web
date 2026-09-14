/**
 * **몇 년도 · 몇 학기 · 몇 월에 얼마.**
 *
 * ── 왜 월과 학기를 함께 두나 ────────────────────────────────────────────────
 *
 * 돈은 **달 단위로** 움직입니다 - 이번 달에 얼마를 보냈고 얼마가 들어왔나, 그걸 보고 다음
 * 달에 얼마를 보낼지 정합니다.
 *
 * 그런데 학교의 뼈대는 **학기**입니다. 학부모가 서명한 납부 옵션도, 교재·교복도 학기 단위로
 * 정해집니다. 그래서 「9월에 얼마」만으로는 답이 안 되고 「2026-1학기의 9월에 얼마」여야
 * 합니다 - 학기가 바뀌면 같은 9월이라도 다른 이야기입니다.
 *
 * 둘을 따로 계산하면 합이 안 맞는 날이 옵니다(월 합 ≠ 학기 합). 그래서 **월을 세고, 그 월을
 * 학기에 담습니다.** 학기 합계는 언제나 그 학기에 담긴 월들의 합입니다.
 *
 * ── 청구월은 발행일이 아닙니다 ──────────────────────────────────────────────
 *
 * 9월분을 8월 28일에 미리 보내고, 8월분을 9월 5일에 다시 보냅니다. 발행일로 세면 두 번 다
 * 엉뚱한 달에 섭니다 - 오류로는 안 보이고 그냥 그 달 숫자가 다릅니다. 그래서
 * `invoices.billing_month` 를 씁니다.
 */

export type MonthKey = string; // "2026-09"

/** 날짜(YYYY-MM-DD)에서 월. 글자를 자르기만 합니다 - Date 로 바꾸면 시간대가 끼어듭니다. */
export function monthOf(date: string | null | undefined): MonthKey | null {
  const m = String(date ?? "").match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** 청구서의 청구월. 칸이 비어 있는 옛 줄은 발행일로 되짚습니다. */
export function billingMonthOf(inv: { billing_month?: string | null; issue_date?: string | null }): MonthKey | null {
  return monthOf(inv.billing_month) ?? monthOf(inv.issue_date);
}

/** 「2026-09」 → 「9월」. 해가 바뀌는 자리에서는 화면이 연도를 따로 적습니다. */
export function monthLabel(key: MonthKey): string {
  const m = key.match(/^(\d{4})-(\d{2})$/);
  return m ? `${Number(m[2])}월` : key;
}

/**
 * 앞뒤 달. **숫자로만 셉니다** - `Date` 로 하루를 더하고 빼면 그 코드가 도는 기계의 시간대가
 * 끼어들어, 서버(UTC)와 브라우저(한국)에서 다른 달이 나옵니다(CLAUDE.md 4).
 */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export type TermSpan = {
  id: string;
  /** 「2026-1학기」처럼 사람이 부르는 이름. */
  label: string;
  start_date: string | null;
  end_date: string | null;
};

/**
 * 그 월이 어느 학기에 담기나.
 *
 * **월의 첫날이 학기 안에 들면** 그 학기로 봅니다. 학기가 달 중간에 끝나는 일이 흔한데
 * (11월 13일 종료), 그 11월을 반으로 쪼개면 어느 쪽 합계도 실제와 안 맞습니다. 한 달은
 * 통째로 한 학기에 담는 편이 세기도 쉽고 설명하기도 쉽습니다.
 *
 * 겹치는 학기가 둘이면 **먼저 시작한 쪽**입니다. 못 담으면 null - 화면이 「학기 밖」으로
 * 따로 세웁니다. 조용히 아무 학기에나 넣으면 그 학기 합계가 슬쩍 늘어납니다.
 */
export function termOfMonth(month: MonthKey, terms: readonly TermSpan[]): TermSpan | null {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  const hit = terms
    .filter((t) => t.start_date && t.end_date && t.start_date <= last && t.end_date >= first)
    .sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
  return hit[0] ?? null;
}

/** 그 달의 마지막 날(YYYY-MM-DD). 윤년·30일 달을 손으로 세지 않습니다. */
export function lastDayOf(month: MonthKey): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return `${month}-28`;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  // 다음 달 0일 = 이번 달 말일. UTC 로 만들어 기계 시간대가 끼어들지 않게 합니다.
  const d = new Date(Date.UTC(y, mo, 0));
  return `${m[1]}-${m[2]}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type PeriodInvoice = {
  id: string;
  student_id: string | null;
  billing_month?: string | null;
  issue_date?: string | null;
  stream?: string | null;
  category?: string | null;
  status: string;
  total_amount: number | string;
  /** 미납이 다른 청구서로 합쳐졌으면 그 청구서. 여기서 또 세면 같은 돈이 두 번 잡힙니다. */
  carried_to_invoice_id?: string | null;
};

export type PeriodPayment = {
  invoice_id: string | null;
  amount: number | string;
  paid_at: string;
  method_kind?: string | null;
};

export type MonthCell = {
  month: MonthKey;
  /** 발행한 것(취소 뺀 것). */
  issued: number;
  issuedCount: number;
  /** 그 청구서들에 붙은 돈. */
  paid: number;
  /** 아직 안 들어온 돈. 음수가 되면 더 받은 것입니다 - 0으로 눕히지 않습니다. */
  unpaid: number;
  cancelledCount: number;
  /** 다른 청구서로 합쳐진 건수. 금액은 새 청구서 쪽에 있습니다. */
  carriedCount: number;
  /** 학비 / 학비외로 나눈 청구액. 다음 달 산출은 갈래가 달라 따로 봐야 합니다. */
  byStream: Record<string, number>;
  /** 그 달에 **실제로 들어온 날** 기준 수납. 청구월과 다를 수 있습니다. */
  receivedInMonth: number;
};

export type TermBlock = {
  termId: string | null;
  termLabel: string;
  months: MonthCell[];
  issued: number;
  paid: number;
  unpaid: number;
};

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** 갈래. 옛 줄은 stream 이 비어 있어 category 로 되짚습니다(settlement.ts 와 같은 규칙). */
function streamOf(inv: PeriodInvoice): string {
  if (inv.stream === "학비" || inv.stream === "학비외") return inv.stream;
  return inv.category === "학비" ? "학비" : "학비외";
}

/**
 * 월 × 학기 표를 만듭니다.
 *
 * **취소된 청구서는 금액에서 뺍니다.** 다만 몇 건이 취소됐는지는 셉니다 - 취소가 갑자기
 * 늘어난 달은 무슨 일이 있었던 달이고, 그게 안 보이면 다음 달 산출을 그 위에 얹게 됩니다.
 */
export function buildPeriodGrid(
  invoices: readonly PeriodInvoice[],
  payments: readonly PeriodPayment[],
  terms: readonly TermSpan[],
): TermBlock[] {
  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + num(p.amount));
  }

  const cells = new Map<MonthKey, MonthCell>();
  const cellOf = (month: MonthKey) => {
    const found = cells.get(month);
    if (found) return found;
    const made: MonthCell = {
      month,
      issued: 0,
      issuedCount: 0,
      paid: 0,
      unpaid: 0,
      cancelledCount: 0,
      carriedCount: 0,
      byStream: {},
      receivedInMonth: 0,
    };
    cells.set(month, made);
    return made;
  };

  for (const inv of invoices) {
    const month = billingMonthOf(inv);
    if (!month) continue;
    const cell = cellOf(month);
    if (inv.status === "취소") {
      cell.cancelledCount += 1;
      continue;
    }
    // **합쳐진 청구서는 금액을 세지 않습니다.** 그 돈은 새 청구서에 이미 들어가 있어서,
    // 여기서 또 세면 학교 전체 청구액이 실제보다 커집니다 - 오류로는 안 보이고 그냥
    // 큰 숫자로 보입니다(settlement.ts 의 「이월됨」과 같은 규칙).
    if (inv.carried_to_invoice_id) {
      cell.carriedCount += 1;
      continue;
    }
    const amount = num(inv.total_amount);
    cell.issued += amount;
    cell.issuedCount += 1;
    const s = streamOf(inv);
    cell.byStream[s] = (cell.byStream[s] ?? 0) + amount;
    cell.paid += paidByInvoice.get(inv.id) ?? 0;
  }
  for (const cell of cells.values()) cell.unpaid = cell.issued - cell.paid;

  // **들어온 날 기준**도 따로 셉니다. 「9월분을 10월에 냈다」가 흔해서, 청구월 수납만 보면
  // 10월에 통장으로 들어온 돈이 어느 칸에도 안 보입니다.
  for (const p of payments) {
    const m = monthOf(p.paid_at);
    if (!m) continue;
    cellOf(m).receivedInMonth += num(p.amount);
  }

  const byTerm = new Map<string, TermBlock>();
  for (const cell of [...cells.values()].sort((a, b) => a.month.localeCompare(b.month))) {
    const term = termOfMonth(cell.month, terms);
    const key = term?.id ?? "";
    const block =
      byTerm.get(key) ??
      byTerm.set(key, { termId: term?.id ?? null, termLabel: term?.label ?? "학기 밖", months: [], issued: 0, paid: 0, unpaid: 0 }).get(key)!;
    block.months.push(cell);
    block.issued += cell.issued;
    block.paid += cell.paid;
    block.unpaid += cell.unpaid;
  }

  // 최근 학기가 위입니다 - 지금 일하는 학기를 먼저 봅니다.
  return [...byTerm.values()].sort((a, b) => (b.months[0]?.month ?? "").localeCompare(a.months[0]?.month ?? ""));
}

/**
 * 다음 달 청구 예상.
 *
 * **지난 달을 그대로 베끼지 않습니다.** 교재·교복처럼 한 학기에 한 번인 항목이 섞여 있어서,
 * 그대로 베끼면 다음 달이 두 배로 잡힙니다. 대신 **가장 최근 달의 학비(정기분)만** 가져오고
 * 학비외는 0으로 둡니다 - 학비외는 그 달에 무엇을 사는지에 따라 사람이 정할 일입니다.
 */
export function nextMonthEstimate(blocks: readonly TermBlock[]): { base: MonthKey; tuition: number } | null {
  const months = blocks.flatMap((b) => b.months).sort((a, b) => b.month.localeCompare(a.month));
  const recent = months.find((m) => (m.byStream["학비"] ?? 0) > 0);
  return recent ? { base: recent.month, tuition: recent.byStream["학비"] ?? 0 } : null;
}
