import type { SupabaseClient } from "@supabase/supabase-js";
import { isFromDeposit } from "@/lib/depositLines";
import { poolOf } from "@/lib/depositShare";
import { loadStudents } from "@/lib/students";

/**
 * **예치금 사용내역서** — 맡긴 돈이 언제 들어와 어디에 얼마 쓰였고 얼마 남았나.
 *
 * 학부모가 «맡긴 돈이 어떻게 됐나요»를 물으면 행정실이 청구서를 하나씩 열어 더해야 했습니다. 이 종이는 그 답을
 * 한 장에 적습니다. 공유 묶음이면 형제 몫을 함께 적고, 어느 아이 돈이 어느 아이 청구서에 쓰였는지 밝힙니다.
 *
 * 숫자는 **입금 줄에서만** 셉니다(따로 적어 둔 잔액 없음). 쪼개진 줄은 처음 들어온 줄(`split_from_id` 의 뿌리)로
 * 모아 «받은 돈»을 한 번만 셉니다 - 조각마다 세면 같은 입금이 두세 번 찍힙니다.
 *
 *   받은 돈 − 쓴 돈 − 돌려준 돈 = 남은 돈   (화면이 이 식이 맞는지 확인해 다르면 적습니다)
 */

export type StatementPay = {
  id: string;
  student_id: string | null;
  shared_from_student_id: string | null;
  invoice_id: string | null;
  amount: number;
  paid_at: string;
  method: string | null;
  payer_name: string | null;
  memo: string | null;
  origin: string | null;
  matched_by: string | null;
  split_from_id: string | null;
  applied_line_id: string | null;
  deposit_applied_at: string | null;
};

export type StatementIn = { date: string; depositor: string; method: string; origin: string; memo: string; amount: number };
export type StatementUse = { date: string; student: string; invoiceNo: string; item: string; amount: number; from: string | null };
export type StatementOut = { date: string; memo: string; amount: number };

export type DepositStatement = {
  received: StatementIn[];
  used: StatementUse[];
  refunded: StatementOut[];
  totals: { received: number; used: number; refunded: number; balance: number; mismatch: boolean };
  /** 남은 돈을 맡긴 학생별로. 공유 묶음이면 둘 이상. */
  leftBy: { student: string; amount: number }[];
};

const ORIGIN_LABEL: Record<string, string> = { 미리받음: "미리 받음", 과납: "더 받은 돈", 이미받음: "직접수납" };

export function buildDepositStatement(
  pays: StatementPay[],
  ctx: {
    nameOf: (studentId: string | null) => string;
    invoiceOf: (id: string) => { invoice_no: string; issue_date: string; student_id: string | null } | null;
    lineName: (id: string | null) => string | null;
  },
): DepositStatement {
  const byId = new Map(pays.map((p) => [p.id, p]));
  const rootOf = (p: StatementPay): StatementPay => {
    let cur = p;
    const seen = new Set<string>();
    while (cur.split_from_id && byId.has(cur.split_from_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.split_from_id)!;
    }
    return cur;
  };
  /** 이 돈을 맡긴 학생. 형제 청구서에 붙은 조각은 `shared_from` 이 원래 주인입니다. */
  const depositorOf = (p: StatementPay) => p.shared_from_student_id ?? p.student_id;

  const roots = new Map<string, { root: StatementPay; amount: number }>();
  const used: StatementUse[] = [];
  const refunded: StatementOut[] = [];
  let balance = 0;
  const left = new Map<string, number>();

  for (const p of pays) {
    const attached = !!p.invoice_id;
    if (attached && !isFromDeposit(p.matched_by)) continue; // 예치금에서 온 돈이 아닌 수납은 이 종이와 상관없습니다.
    if (!attached && p.amount < 0) {
      refunded.push({ date: p.paid_at, memo: p.memo ?? "예치금에서 돌려드림", amount: -p.amount });
      balance += p.amount;
      const who = depositorOf(p) ?? "";
      left.set(who, (left.get(who) ?? 0) + p.amount);
      continue;
    }
    const r = rootOf(p);
    const cur = roots.get(r.id) ?? { root: r, amount: 0 };
    cur.amount += p.amount;
    roots.set(r.id, cur);
    if (attached) {
      const inv = ctx.invoiceOf(p.invoice_id!);
      used.push({
        date: (p.deposit_applied_at ?? "").slice(0, 10) || inv?.issue_date || p.paid_at,
        student: ctx.nameOf(inv?.student_id ?? p.student_id),
        invoiceNo: inv?.invoice_no ?? "",
        item: ctx.lineName(p.applied_line_id) ?? "항목 지정 없음",
        amount: p.amount,
        from: p.shared_from_student_id ? ctx.nameOf(p.shared_from_student_id) : null,
      });
    } else {
      balance += p.amount;
      const who = depositorOf(p) ?? "";
      left.set(who, (left.get(who) ?? 0) + p.amount);
    }
  }

  const received: StatementIn[] = [...roots.values()].map(({ root, amount }) => ({
    date: root.paid_at,
    depositor: ctx.nameOf(depositorOf(root)),
    method: root.method ?? "",
    origin: ORIGIN_LABEL[root.origin ?? ""] ?? (root.origin || "예치금"),
    // 쪼갤 때 앱이 덧쓴 메모(「…원 중 …원을 충당」)는 받은 돈의 사연이 아니라 빼지 않습니다 - 원래 메모가 없으면 비웁니다.
    memo: /충당/.test(root.memo ?? "") ? "" : root.memo ?? "",
    amount,
  }));
  received.sort((a, b) => a.date.localeCompare(b.date));
  used.sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNo.localeCompare(b.invoiceNo));
  refunded.sort((a, b) => a.date.localeCompare(b.date));

  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
  const totals = { received: sum(received), used: sum(used), refunded: sum(refunded), balance: Math.round(balance), mismatch: false };
  totals.mismatch = Math.round(totals.received - totals.used - totals.refunded) !== totals.balance;
  return {
    received,
    used,
    refunded,
    totals,
    leftBy: [...left.entries()].map(([id, amount]) => ({ student: ctx.nameOf(id || null), amount })).filter((x) => x.amount !== 0),
  };
}

/** 한 학생(공유면 묶음 전체)의 사용내역서를 읽어 만듭니다. */
export async function loadDepositStatement(supabase: SupabaseClient, studentId: string) {
  const pool = await poolOf(supabase, studentId);
  if (pool.error) throw new Error(pool.error);
  const cols = "id, student_id, shared_from_student_id, invoice_id, amount, paid_at, method, payer_name, memo, origin, matched_by, split_from_id, applied_line_id, deposit_applied_at";
  const [a, b, stu] = await Promise.all([
    supabase.from("payments").select(cols).in("student_id", pool.memberIds),
    // 묶음을 푼 뒤에도, 이 학생들이 맡긴 돈이 다른 아이 청구서에 쓰인 기록은 남아야 합니다.
    supabase.from("payments").select(cols).in("shared_from_student_id", pool.memberIds),
    loadStudents(supabase, { ids: pool.memberIds, status: "all" }),
  ]);
  const bad = a.error?.message ?? b.error?.message ?? stu.error;
  if (bad) throw new Error(`예치금 내역을 읽지 못했습니다: ${bad}`);
  const all = new Map<string, StatementPay>();
  for (const r of [...((a.data as StatementPay[] | null) ?? []), ...((b.data as StatementPay[] | null) ?? [])]) {
    all.set(r.id, { ...r, amount: Number(r.amount) });
  }
  const pays = [...all.values()];
  const invIds = [...new Set(pays.filter((p) => p.invoice_id && isFromDeposit(p.matched_by)).map((p) => p.invoice_id!))];
  const lineIds = [...new Set(pays.map((p) => p.applied_line_id).filter((x): x is string => !!x))];
  const [inv, lines] = await Promise.all([
    invIds.length ? supabase.from("invoices").select("id, invoice_no, issue_date, student_id, student_name_ko, student_name").in("id", invIds) : Promise.resolve({ data: [], error: null }),
    lineIds.length ? supabase.from("invoice_lines").select("id, name").in("id", lineIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const bad2 = inv.error ?? lines.error;
  if (bad2) throw new Error(`예치금이 쓰인 청구서를 읽지 못했습니다: ${bad2.message}`);

  type Inv = { id: string; invoice_no: string; issue_date: string; student_id: string | null; student_name_ko: string | null; student_name: string };
  const invById = new Map(((inv.data as Inv[] | null) ?? []).map((v) => [v.id, v]));
  const students = stu.rows.map((s) => ({ id: s.id, name: s.name, grade: s.grade, class_name: s.class_name }));
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  for (const v of invById.values()) if (v.student_id && !nameById.has(v.student_id)) nameById.set(v.student_id, v.student_name_ko ?? v.student_name);
  const lineById = new Map(((lines.data as { id: string; name: string }[] | null) ?? []).map((l) => [l.id, l.name.replace(/^[\s　└]+/, "")]));

  const statement = buildDepositStatement(pays, {
    nameOf: (id) => (id ? nameById.get(id) ?? "이름 미확인" : "이름 미확인"),
    invoiceOf: (id) => invById.get(id) ?? null,
    lineName: (id) => (id ? lineById.get(id) ?? null : null),
  });
  return { statement, share: pool.share, students };
}
