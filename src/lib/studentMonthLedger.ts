/**
 * **그 달에 누구에게 얼마를 청구했고, 그게 언제 들어왔나.**
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 *
 * 지금까지 재무 화면은 두 가지 물음에만 답했습니다 - 「학교 전체로 이 달에 얼마」(월별)와
 * 「이 학생이 지금까지 통틀어 얼마」(거래명세서). 그 사이가 비어 있었습니다.
 *
 * 실제로 행정실에서 가장 자주 하는 말은 그 사이에 있습니다: **「9월에 김사랑한테 얼마
 * 나갔죠?」** 9월 2일에 30만, 9월 20일에 20만을 따로 보냈으면 답은 50만인데, 지금은
 * 청구서를 하나씩 찾아 더해야 합니다. 더하는 동안 한 장을 빠뜨리면 그 사실이 어디에도
 * 나타나지 않습니다.
 *
 * ── 통장처럼 봅니다 ─────────────────────────────────────────────────────────
 *
 * 은행 거래내역이 이 물음에 잘 답하는 이유는 **한 줄기에 시간순으로 늘어놓고 오른쪽에
 * 잔액을 굴리기** 때문입니다. 여기서는 입금·출금 대신 **청구(+)와 수납(−)**입니다.
 * 마지막 줄의 잔액이 그 달에 아직 못 받은 돈이고, 중간 어느 줄에서든 그때까지의 잔액이
 * 보입니다.
 *
 * ── 어느 달에 속하는가 ──────────────────────────────────────────────────────
 *
 * 청구서는 **청구월**로 담습니다(발행일이 아닙니다 - `financePeriod.ts`). 9월분을 8월 말에
 * 미리 보내도 9월입니다.
 *
 * 그 청구서에 붙은 돈은 **언제 들어왔든 함께 보여줍니다.** 9월분을 10월 5일에 내면 그 줄은
 * 「10월 5일 수납」으로 9월 표에 나타나고 `outsideMonth` 가 참입니다. 그러지 않으면 9월
 * 표에 청구만 남아 영영 미납으로 보입니다 - 실제로는 받은 돈인데요.
 */

import { billingMonthOf, type MonthKey } from "./financePeriod";

export type MonthInvoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name: string;
  student_name_ko?: string | null;
  billing_month?: string | null;
  issue_date: string;
  due_date: string;
  total_amount: number | string;
  status: string;
  stream?: string | null;
  category?: string | null;
  carried_to_invoice_id?: string | null;
  note?: string | null;
};

export type MonthPayment = {
  invoice_id: string | null;
  amount: number | string;
  paid_at: string;
  method_kind?: string | null;
  method?: string | null;
  kind?: string | null;
};

export type EntryKind = "청구" | "수납" | "환불" | "취소" | "이월됨";

export type MonthEntry = {
  date: string;
  kind: EntryKind;
  invoiceId: string;
  invoiceNo: string;
  stream: string;
  label: string;
  /** 청구한 금액(+). 취소·이월 줄은 0입니다. */
  billed: number;
  /** 들어온 금액(+). 환불은 음수로 그대로 둡니다 - 되돌린 돈은 잔액을 다시 늘립니다. */
  received: number;
  /** 그 줄까지의 잔액. 통장의 오른쪽 칸입니다. */
  running: number;
  method?: string | null;
  /** 청구월 밖에서 들어온 돈인가. 9월분을 10월에 낸 경우가 흔합니다. */
  outsideMonth: boolean;
};

export type RowState = "완납" | "부분납부" | "연체" | "미납" | "청구 없음";

export type StudentMonthRow = {
  studentId: string;
  name: string;
  where: string | null;
  invoiceCount: number;
  billed: number;
  received: number;
  balance: number;
  state: RowState;
  /** 그 달 청구서 중 가장 늦은 마감일. 연체 판정의 기준입니다. */
  lastDue: string | null;
  /** 마지막으로 돈이 들어온 날. 「아직 한 번도 안 냄」과 「내다 말았음」이 다릅니다. */
  lastPaidAt: string | null;
  byStream: Record<string, number>;
  entries: MonthEntry[];
};

export type MonthTotals = {
  month: MonthKey;
  people: number;
  invoiceCount: number;
  billed: number;
  received: number;
  balance: number;
  /** 한 푼도 안 들어온 학생 수. 「부분납부」와 섞으면 연락할 사람을 못 고릅니다. */
  untouched: number;
  cancelled: number;
  carried: number;
};

const num = (v: number | string | null | undefined) => {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/** 갈래. 옛 줄은 stream 이 비어 있어 category 로 되짚습니다(settlement.ts 와 같은 규칙). */
function streamOf(inv: MonthInvoice): string {
  if (inv.stream === "학비" || inv.stream === "학비외") return inv.stream;
  return inv.category === "학비" ? "학비" : "학비외";
}

/**
 * 그 달의 학생별 거래내역.
 *
 * **취소와 이월은 금액에서 뺍니다.** 둘 다 줄은 남깁니다 - 없애면 「그때 그 청구서는 어디
 * 갔나」에 답할 수 없고, 학부모가 받은 문자와 우리 표가 달라집니다.
 *
 * 이월된 청구서를 여기서 또 세면 **같은 돈이 두 번 청구된 것으로 보입니다** - 그 돈은 합친
 * 새 청구서에 이미 들어가 있습니다.
 */
export function buildStudentMonth(
  invoices: readonly MonthInvoice[],
  payments: readonly MonthPayment[],
  opts: {
    month: MonthKey;
    today: string;
    nameOf: (id: string) => string | null;
    whereOf?: (id: string) => string | null;
  },
): { rows: StudentMonthRow[]; totals: MonthTotals } {
  const mine = invoices.filter((v) => billingMonthOf(v) === opts.month && v.student_id);
  const idSet = new Set(mine.map((v) => v.id));
  const invById = new Map(mine.map((v) => [v.id, v]));

  const byStudent = new Map<string, StudentMonthRow>();
  const rowOf = (studentId: string, fallbackName: string): StudentMonthRow => {
    const found = byStudent.get(studentId);
    if (found) return found;
    const made: StudentMonthRow = {
      studentId,
      // 명부 이름이 먼저입니다. 청구서에 굳은 이름은 발행 당시 것이라, 개명하거나 오타를
      // 고친 뒤에는 지금 명부와 다릅니다.
      name: opts.nameOf(studentId) ?? fallbackName,
      where: opts.whereOf?.(studentId) ?? null,
      invoiceCount: 0,
      billed: 0,
      received: 0,
      balance: 0,
      state: "미납",
      lastDue: null,
      lastPaidAt: null,
      byStream: {},
      entries: [],
    };
    byStudent.set(studentId, made);
    return made;
  };

  let cancelled = 0;
  let carried = 0;

  for (const v of mine) {
    const row = rowOf(v.student_id as string, v.student_name_ko || v.student_name);
    const stream = streamOf(v);
    const amount = num(v.total_amount);

    if (v.status === "취소") {
      cancelled += 1;
      row.entries.push({
        date: v.issue_date,
        kind: "취소",
        invoiceId: v.id,
        invoiceNo: v.invoice_no,
        stream,
        label: `${v.invoice_no} 청구 취소`,
        billed: 0,
        received: 0,
        running: 0,
        outsideMonth: false,
      });
      continue;
    }

    if (v.carried_to_invoice_id) {
      carried += 1;
      row.entries.push({
        date: v.issue_date,
        kind: "이월됨",
        invoiceId: v.id,
        invoiceNo: v.invoice_no,
        stream,
        label: `${v.invoice_no} — 다른 청구서로 합쳐짐`,
        billed: 0,
        received: 0,
        running: 0,
        outsideMonth: false,
      });
      continue;
    }

    row.invoiceCount += 1;
    row.billed += amount;
    row.byStream[stream] = (row.byStream[stream] ?? 0) + amount;
    if (!row.lastDue || v.due_date > row.lastDue) row.lastDue = v.due_date;
    row.entries.push({
      date: v.issue_date,
      kind: "청구",
      invoiceId: v.id,
      invoiceNo: v.invoice_no,
      stream,
      label: `${v.invoice_no} 청구 (${stream})`,
      billed: amount,
      received: 0,
      running: 0,
      outsideMonth: false,
    });
  }

  for (const p of payments) {
    if (!p.invoice_id || !idSet.has(p.invoice_id)) continue;
    const v = invById.get(p.invoice_id);
    if (!v?.student_id) continue;
    // 취소·이월된 청구서에 붙은 돈은 여기서 세지 않습니다. 청구를 0으로 두고 수납만 세면
    // 잔액이 음수로 내려가고, 화면에는 「더 받았음」으로 보입니다.
    if (v.status === "취소" || v.carried_to_invoice_id) continue;
    const row = rowOf(v.student_id, v.student_name_ko || v.student_name);
    const amount = num(p.amount);
    const refund = amount < 0 || p.kind === "환불";
    row.received += amount;
    if (!refund && (!row.lastPaidAt || p.paid_at > row.lastPaidAt)) row.lastPaidAt = p.paid_at;
    row.entries.push({
      date: p.paid_at,
      kind: refund ? "환불" : "수납",
      invoiceId: v.id,
      invoiceNo: v.invoice_no,
      stream: streamOf(v),
      label: refund ? `${v.invoice_no} 환불` : `${v.invoice_no} 수납`,
      billed: 0,
      received: amount,
      running: 0,
      method: p.method_kind ?? p.method ?? null,
      outsideMonth: (p.paid_at ?? "").slice(0, 7) !== opts.month,
    });
  }

  for (const row of byStudent.values()) {
    // 같은 날이면 **청구가 먼저**입니다. 그날 청구하고 그날 받은 경우에 수납이 먼저 오면
    // 잔액이 음수로 찍혔다가 0이 되어, 잘못 받은 것처럼 보입니다.
    row.entries.sort(
      (a, b) => a.date.localeCompare(b.date) || order(a.kind) - order(b.kind) || a.invoiceNo.localeCompare(b.invoiceNo),
    );
    let running = 0;
    for (const e of row.entries) {
      running += e.billed - e.received;
      e.running = running;
    }
    row.balance = row.billed - row.received;
    row.state =
      row.invoiceCount === 0
        ? "청구 없음"
        : row.balance <= 0
          ? "완납"
          : row.received > 0
            ? "부분납부"
            : row.lastDue && row.lastDue < opts.today
              ? "연체"
              : "미납";
  }

  // 받을 돈이 많은 사람이 위입니다 - 이 화면을 여는 이유가 대개 그것입니다.
  const rows = [...byStudent.values()].sort(
    (a, b) => b.balance - a.balance || b.billed - a.billed || a.name.localeCompare(b.name, "ko"),
  );

  const totals: MonthTotals = {
    month: opts.month,
    people: rows.filter((r) => r.invoiceCount > 0).length,
    invoiceCount: rows.reduce((n, r) => n + r.invoiceCount, 0),
    billed: rows.reduce((n, r) => n + r.billed, 0),
    received: rows.reduce((n, r) => n + r.received, 0),
    balance: rows.reduce((n, r) => n + r.balance, 0),
    untouched: rows.filter((r) => r.invoiceCount > 0 && r.received === 0).length,
    cancelled,
    carried,
  };

  return { rows, totals };
}

/** 같은 날 줄 사이의 순서. 청구 → 수납 → 환불 → 그 밖. */
function order(kind: EntryKind): number {
  return kind === "청구" ? 0 : kind === "수납" ? 1 : kind === "환불" ? 2 : 3;
}

/**
 * 그 달에 청구서가 있는 달 목록. 화면의 달 고르개가 씁니다.
 * 청구가 하나도 없는 달은 넣지 않습니다 - 빈 달을 늘어놓으면 있는 달을 찾기 어렵습니다.
 */
export function monthsWithInvoices(invoices: readonly MonthInvoice[]): MonthKey[] {
  const set = new Set<MonthKey>();
  for (const v of invoices) {
    const m = billingMonthOf(v);
    if (m) set.add(m);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}
