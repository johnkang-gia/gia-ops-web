/**
 * **학년·반별로 얼마를 청구했고 얼마가 들어왔는가** — 집계는 여기 한 곳입니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 재무 개요에 학교 전체 숫자만 있었습니다. 그런데 돈 이야기에서 다음 행동을 정하는 것은
 * **어디가 밀렸는가**입니다 - 전체 수납률 82%는 모든 반이 고르게 82%인 것과 한 반만
 * 30%인 것을 똑같이 보이게 합니다. 뒤엣것은 그 반 담임에게 전화 한 통이면 풀리는 일인데,
 * 전체 숫자만 보면 그 반이 있다는 것조차 모릅니다.
 *
 * ── 세는 규칙 ───────────────────────────────────────────────────────────────
 *
 * 한 장의 상태는 `settlement.ts` 의 `settle()` 이 정합니다. 여기서 다시 정하지 않습니다 -
 * 두 곳이 다르면 개요와 미납 화면이 다른 숫자를 말하고, 그러면 아무도 개요를 안 믿습니다.
 *
 *   · **취소**는 아예 세지 않습니다. 무효로 만든 종이입니다.
 *   · **이월됨**도 세지 않습니다. 그 돈은 새 청구서에 들어가 있어서, 여기서 또 세면
 *     같은 돈을 두 번 청구한 것으로 보입니다.
 *
 * 학년·반은 **학생 번호로** 찾습니다(§2-4). 이름으로 찾으면 김재이 셋이 한 칸을 나눠 써서
 * 엉뚱한 반의 금액이 부풀고, 그건 화면에 오류가 아니라 «그 반이 많이 밀렸다»로 보입니다.
 *
 * 순수 함수입니다 - 화면 없이 시험할 수 있습니다.
 */

import { isOutstanding, settle, streamOf, type InvoiceStream, type SettleInvoice, type SettlePayment } from "@/lib/settlement";

/** 학생 번호 → 학년·반. 명부에서 만들어 넘깁니다. */
export type StudentMeta = Map<string, { name: string; grade: string | null; className: string | null }>;

export type GroupBy = "학년" | "반";

export type BreakRow = {
  key: string;
  /** 청구서가 나간 사람 수. 한 사람이 여러 장이어도 한 명입니다. */
  people: number;
  invoices: number;
  billed: number;
  paid: number;
  /** 아직 받을 돈. 취소·이월은 빠져 있습니다. */
  balance: number;
  /** 그중 **마감이 지난** 돈. 마감 전 잔액은 「안 낸 것」이 아니라 「낼 때가 안 된 것」입니다. */
  overdue: number;
  /** 수납률(%). 청구가 0이면 100으로 둡니다 - 받을 것이 없으면 다 받은 것입니다. */
  rate: number;
};

/** 명부에 없는 학생의 청구서도 버리지 않습니다. 합계가 조용히 줄어드는 것이 더 나쁩니다. */
export const NO_CLASS = "반 미상";
export const NO_GRADE = "학년 미상";

function keyOf(meta: StudentMeta, studentId: string | null, by: GroupBy): string {
  const m = studentId ? meta.get(studentId) : undefined;
  if (by === "학년") return m?.grade?.trim() || NO_GRADE;
  return m?.className?.trim() || NO_CLASS;
}

export function rateOf(billed: number, paid: number): number {
  if (billed <= 0) return 100;
  return Math.round((paid / billed) * 1000) / 10;
}

/**
 * 학년별 또는 반별 집계.
 *
 * `stream` 을 주면 그 갈래만 봅니다 - 학비와 학비외는 납기도 담당도 달라서, 섞어 보면
 * 「교재비가 안 들어온 것」과 「등록금이 안 들어온 것」이 한 숫자가 됩니다.
 */
export function breakdown(
  invoices: SettleInvoice[],
  payments: SettlePayment[],
  meta: StudentMeta,
  today: string,
  by: GroupBy,
  stream?: InvoiceStream,
): BreakRow[] {
  const acc = new Map<string, { people: Set<string>; invoices: number; billed: number; paid: number; balance: number; overdue: number }>();

  for (const inv of invoices) {
    if (stream && streamOf(inv) !== stream) continue;
    const s = settle(inv, payments, today);
    if (s.state === "취소" || s.state === "이월됨") continue;

    const key = keyOf(meta, inv.student_id, by);
    const cur = acc.get(key) ?? { people: new Set<string>(), invoices: 0, billed: 0, paid: 0, balance: 0, overdue: 0 };
    cur.people.add(inv.student_id ?? `무명:${inv.id}`);
    cur.invoices += 1;
    cur.billed += s.billed;
    cur.paid += s.paid;
    if (isOutstanding(s)) {
      cur.balance += s.balance;
      if (s.overdueDays > 0) cur.overdue += s.balance;
    }
    acc.set(key, cur);
  }

  return [...acc.entries()]
    .map(([key, v]) => ({
      key,
      people: v.people.size,
      invoices: v.invoices,
      billed: v.billed,
      paid: v.paid,
      balance: v.balance,
      overdue: v.overdue,
      rate: rateOf(v.billed, v.paid),
    }))
    // **덜 받은 곳이 먼저입니다.** 다음에 할 일이 거기 있습니다. 가나다순으로 세우면
    // 급한 반이 목록 한가운데 묻힙니다.
    .sort((a, b) => b.overdue - a.overdue || b.balance - a.balance || a.key.localeCompare(b.key, "ko"));
}

/** 학교 전체 한 줄. 표의 합계와 도넛이 **같은 수**를 쓰게 합니다. */
export function totalOf(rows: BreakRow[]): BreakRow {
  const t = rows.reduce(
    (n, r) => ({
      people: n.people + r.people,
      invoices: n.invoices + r.invoices,
      billed: n.billed + r.billed,
      paid: n.paid + r.paid,
      balance: n.balance + r.balance,
      overdue: n.overdue + r.overdue,
    }),
    { people: 0, invoices: 0, billed: 0, paid: 0, balance: 0, overdue: 0 },
  );
  return { key: "전체", ...t, rate: rateOf(t.billed, t.paid) };
}

export type UnpaidPerson = {
  studentId: string | null;
  name: string;
  grade: string | null;
  className: string | null;
  invoices: number;
  balance: number;
  /** 가장 오래 밀린 청구서의 연체 일수. 0이면 아직 마감 전입니다. */
  worstOverdueDays: number;
  /** 가장 급한 청구서 번호. 눌러서 바로 열어보라고 둡니다. */
  topInvoiceNo: string;
};

/**
 * 미납자 명단 — **사람 단위**로 묶습니다.
 *
 * 청구서 단위로 늘어놓으면 한 아이가 세 줄이 되고, 전화를 세 번 걸게 됩니다. 연락은
 * 사람에게 하는 것이라 목록도 사람이어야 합니다.
 *
 * 오래 밀린 사람이 먼저입니다. 어제 마감된 10만원과 두 달 밀린 10만원은 같은 돈이
 * 아닙니다 - 뒤엣것이 받기 어렵고, 그래서 먼저 연락해야 합니다.
 */
export function unpaidPeople(
  invoices: SettleInvoice[],
  payments: SettlePayment[],
  meta: StudentMeta,
  today: string,
  stream?: InvoiceStream,
): UnpaidPerson[] {
  const acc = new Map<string, UnpaidPerson>();

  for (const inv of invoices) {
    if (stream && streamOf(inv) !== stream) continue;
    const s = settle(inv, payments, today);
    if (!isOutstanding(s)) continue;

    const id = inv.student_id;
    const m = id ? meta.get(id) : undefined;
    const key = id ?? `무명:${inv.id}`;
    const cur = acc.get(key);
    if (!cur) {
      acc.set(key, {
        studentId: id,
        // 명부에서 찾은 이름을 먼저 씁니다 - 청구서에 박힌 이름은 발행 당시의 것이라
        // 그 뒤에 고친 이름이 반영되지 않습니다.
        name: m?.name ?? inv.student_name_ko ?? inv.student_name,
        grade: m?.grade ?? null,
        className: m?.className ?? null,
        invoices: 1,
        balance: s.balance,
        worstOverdueDays: s.overdueDays,
        topInvoiceNo: inv.invoice_no,
      });
      continue;
    }
    cur.invoices += 1;
    cur.balance += s.balance;
    if (s.overdueDays > cur.worstOverdueDays) {
      cur.worstOverdueDays = s.overdueDays;
      cur.topInvoiceNo = inv.invoice_no;
    }
  }

  return [...acc.values()].sort(
    (a, b) => b.worstOverdueDays - a.worstOverdueDays || b.balance - a.balance || a.name.localeCompare(b.name, "ko"),
  );
}
