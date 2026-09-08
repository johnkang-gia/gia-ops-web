/**
 * 청구서 한 장의 상태를 정하는 곳. **여기 한 곳뿐입니다.**
 *
 * 「완납인가 미납인가 연체인가」를 화면마다 다시 계산하면, 인보이스 명단과 수납 화면과
 * 대시보드가 서로 다른 답을 냅니다. 돈 이야기에서 답이 갈리면 그 숫자는 아무도 안 믿습니다.
 *
 * 상태는 **저장하지 않습니다.** 청구액 · 입금 합 · 마감일 · 이월 여부에서 그때그때 냅니다.
 * 상태를 칸에 적어두면 입금이 들어왔을 때 그 칸을 고치는 것을 잊는 날이 반드시 옵니다.
 */

export const INVOICE_STREAMS = ["학비", "학비외"] as const;
export type InvoiceStream = (typeof INVOICE_STREAMS)[number];

/** 청구 갈래. 옛 줄은 stream 이 비어 있으므로 category 로 되짚습니다. */
export function streamOf(inv: { stream?: string | null; category?: string | null }): InvoiceStream {
  if (inv.stream === "학비" || inv.stream === "학비외") return inv.stream;
  return inv.category === "학비" ? "학비" : "학비외";
}

export type SettleInvoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name: string;
  student_name_ko?: string | null;
  issue_date: string;
  due_date: string;
  total_amount: number | string;
  status: string;
  category?: string | null;
  stream?: string | null;
  carried_to_invoice_id?: string | null;
};

export type SettlePayment = { invoice_id: string | null; amount: number | string };

export type InvoiceState =
  | "취소"
  | "이월됨"
  | "완납"
  | "부분납부"
  | "미납"
  | "연체";

export type Settled = {
  billed: number;
  paid: number;
  balance: number;
  state: InvoiceState;
  /** 마감일이 며칠 지났는가. 마감 전이면 0. */
  overdueDays: number;
};

const num = (v: number | string | null | undefined) => Math.round(Number(v ?? 0));

function daysBetween(a: string, b: string): number {
  const t1 = new Date(`${a}T00:00:00Z`).getTime();
  const t2 = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((t2 - t1) / 86_400_000);
}

/**
 * 한 장의 상태.
 *
 * 순서가 뜻을 가집니다.
 *   ① 취소   - 무효로 만든 것. 금액을 세지 않습니다.
 *   ② 이월됨 - 미납이 새 청구서로 옮겨간 것. **여기서 또 세면 같은 돈을 두 번 청구합니다.**
 *   ③ 완납 / 부분납부 / 연체 / 미납
 */
export function settle(inv: SettleInvoice, payments: SettlePayment[], today: string): Settled {
  const billed = num(inv.total_amount);
  const paid = payments.filter((p) => p.invoice_id === inv.id).reduce((n, p) => n + num(p.amount), 0);
  const balance = billed - paid;
  const overdueDays = Math.max(0, daysBetween(inv.due_date, today));

  const state: InvoiceState =
    inv.status === "취소"
      ? "취소"
      : inv.carried_to_invoice_id
        ? "이월됨"
        : balance <= 0
          ? "완납"
          : paid > 0
            ? "부분납부"
            : overdueDays > 0
              ? "연체"
              : "미납";

  return { billed, paid, balance, state, overdueDays };
}

/** 아직 받아야 하는 돈인가. 취소·이월·완납은 아닙니다. */
export function isOutstanding(s: Settled): boolean {
  return s.balance > 0 && s.state !== "취소" && s.state !== "이월됨";
}

export const AGING_BUCKETS = ["기한 전", "1~30일", "31~60일", "61일+"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/**
 * 얼마나 오래 밀렸는가.
 *
 * 회계에서 미수금을 볼 때 «얼마»보다 먼저 보는 것이 «얼마나 오래»입니다. 어제 마감된
 * 10만원과 두 달 밀린 10만원은 같은 돈이 아닙니다 - 뒤엣것은 받기 어렵고, 그래서 먼저
 * 연락해야 합니다.
 */
export function agingBucket(overdueDays: number): AgingBucket {
  if (overdueDays <= 0) return "기한 전";
  if (overdueDays <= 30) return "1~30일";
  if (overdueDays <= 60) return "31~60일";
  return "61일+";
}

/**
 * 새 청구서에 얹을 **이전 미납**.
 *
 * 같은 학생 · **같은 갈래**만 봅니다. 교복값이 안 들어왔다고 다음 달 학비 청구서에 얹으면
 * 학부모는 무슨 돈인지 모르고, 담당자도 「이 달 학비가 얼마 걷혔나」를 셀 수 없습니다.
 *
 * 이미 이월된 것(carried_to_invoice_id)은 제외합니다. 여기서 다시 세면 같은 돈이 두 번
 * 청구됩니다 - 학부모에게 가장 하면 안 되는 실수입니다.
 */
export function carryForwardCandidates(
  invoices: SettleInvoice[],
  payments: SettlePayment[],
  opts: { studentId: string; stream: InvoiceStream; today: string; excludeInvoiceId?: string },
): { invoice: SettleInvoice; balance: number }[] {
  return invoices
    .filter((v) => v.student_id === opts.studentId)
    .filter((v) => v.id !== opts.excludeInvoiceId)
    .filter((v) => streamOf(v) === opts.stream)
    .map((v) => ({ invoice: v, s: settle(v, payments, opts.today) }))
    .filter((x) => isOutstanding(x.s))
    .map((x) => ({ invoice: x.invoice, balance: x.s.balance }))
    .sort((a, b) => a.invoice.issue_date.localeCompare(b.invoice.issue_date));
}

/** 이월 줄에 적을 이름. 무슨 돈인지 학부모가 바로 알아야 합니다. */
export function carryForwardLineName(inv: SettleInvoice): string {
  const [, m, d] = inv.issue_date.split("-");
  return `이전 미납 (${Number(m)}/${Number(d)} 청구 ${inv.invoice_no})`;
}

// ── 월별·수단별 집계 ─────────────────────────────────────────────────────────

/**
 * 「이 달에 어떤 수단으로 얼마가 들어왔나」.
 *
 * 수단을 세는 이유는 둘입니다. **현금·계좌이체는 현금영수증을 우리가 발행해야 하고**,
 * 카드는 수수료가 붙습니다. 합계만 알면 둘 다 못 챙깁니다.
 *
 * 수단이 비어 있는 옛 줄은 「기타」로 셉니다 - 빼버리면 합계가 안 맞고, 안 맞는 표는
 * 아무도 안 믿습니다.
 */
export type MethodTotals = { month: string; byMethod: Record<string, number>; total: number; count: number };

export function monthlyByMethod(
  payments: { paid_at: string; amount: number | string; method_kind?: string | null; method?: string | null }[],
  months = 6,
): MethodTotals[] {
  const map = new Map<string, MethodTotals>();
  for (const p of payments) {
    const month = (p.paid_at ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const kind = (p.method_kind ?? "").trim() || "기타";
    const row = map.get(month) ?? { month, byMethod: {}, total: 0, count: 0 };
    row.byMethod[kind] = (row.byMethod[kind] ?? 0) + num(p.amount);
    row.total += num(p.amount);
    row.count += 1;
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, months);
}

// ── 학생별 원장 ─────────────────────────────────────────────────────────────

/**
 * 한 학생의 청구와 입금을 **시간순 한 줄기**로 세웁니다.
 *
 * 학부모가 「우리가 뭘 얼마 냈죠」라고 물으면 지금은 인보이스를 하나씩 열어 더해야 합니다.
 * 회계 프로그램들이 이 화면을 「거래명세서(Statement)」라고 부르는 이유는, 이 한 장이면
 * 더 물을 것이 없기 때문입니다.
 *
 * **잔액은 누적으로 굴립니다.** 각 줄 오른쪽의 잔액이 그 시점까지의 미수금입니다.
 */
export type LedgerRow = {
  date: string;
  kind: "청구" | "입금" | "취소";
  label: string;
  /** 청구는 +, 입금은 -. 취소는 0(기록만 남깁니다). */
  delta: number;
  running: number;
  invoiceId?: string;
  invoiceNo?: string;
  method?: string | null;
};

export function studentLedger(
  invoices: SettleInvoice[],
  payments: (SettlePayment & { paid_at?: string; method_kind?: string | null })[],
  studentId: string,
): { rows: LedgerRow[]; outstanding: number } {
  const mine = invoices.filter((v) => v.student_id === studentId);
  const ids = new Set(mine.map((v) => v.id));

  type Ev = { date: string; kind: LedgerRow["kind"]; label: string; delta: number; invoiceId?: string; invoiceNo?: string; method?: string | null };
  const events: Ev[] = [];

  for (const v of mine) {
    if (v.status === "취소") {
      // 취소한 청구서도 남깁니다. 없애면 「그때 그 청구서는 어디 갔나」에 답할 수 없습니다.
      events.push({ date: v.issue_date, kind: "취소", label: `${v.invoice_no} 청구 취소`, delta: 0, invoiceId: v.id, invoiceNo: v.invoice_no });
      continue;
    }
    // 이월된 청구서는 금액을 세지 않습니다 - 그 돈은 새 청구서에 이미 들어가 있습니다.
    const carried = !!v.carried_to_invoice_id;
    events.push({
      date: v.issue_date,
      kind: "청구",
      label: `${v.invoice_no}${carried ? " (이월됨)" : ""}`,
      delta: carried ? 0 : num(v.total_amount),
      invoiceId: v.id,
      invoiceNo: v.invoice_no,
    });
  }

  for (const p of payments) {
    if (!p.invoice_id || !ids.has(p.invoice_id)) continue;
    const inv = mine.find((v) => v.id === p.invoice_id);
    events.push({
      date: p.paid_at ?? inv?.issue_date ?? "",
      kind: "입금",
      label: `${inv?.invoice_no ?? ""} 입금`,
      delta: -num(p.amount),
      invoiceId: p.invoice_id,
      invoiceNo: inv?.invoice_no,
      method: p.method_kind ?? null,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "청구" ? -1 : 1));

  let running = 0;
  const rows: LedgerRow[] = events.map((e) => {
    running += e.delta;
    return { ...e, running };
  });
  return { rows, outstanding: running };
}
