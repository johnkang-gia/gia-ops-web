import type { SupabaseClient } from "@supabase/supabase-js";
import { readAll } from "@/lib/financeFetch";
import { todayKst } from "@/lib/kst";
import type { FeeDiscount, FeeItem, FeePaymentOption, FeePlan, Invoice, StudentFeeItem, Term } from "@/lib/types";
import type { BilledLine } from "@/lib/billedItems";
import type { Enrollment, LedgerPayment, LedgerStudent, LedgerWorld, StudentDiscountRow } from "@/lib/studentLedger";
import { loadStudents } from "@/lib/students";
import type { AddonPrice } from "@/lib/tuitionAddon";
import { termOfMonth } from "@/lib/financePeriod";

/**
 * 원장이 필요로 하는 자료를 **한 번에** 읽습니다. 회계 화면은 전교생 것을, 학생 창은 한
 * 명 것을 읽는데 읽는 표와 거르는 조건은 같아야 합니다 - 둘이 다르면 목록의 숫자와 창의
 * 숫자가 어긋나고, 그러면 아무도 안 믿습니다.
 *
 * 학생을 주면 청구서·입금·등록은 그 학생 것만 읽습니다(큰 표). 요금표·항목은 작아서 그냥
 * 전부 읽습니다.
 */
export async function loadLedgerWorld(
  supabase: SupabaseClient,
  opts: { termId: string | null; studentId?: string | null; month?: string | null },
): Promise<{ world: LedgerWorld; students: LedgerStudent[]; terms: Term[]; errors: string[] }> {
  const errors: string[] = [];
  const only = opts.studentId ?? null;
  // 한 명이면 그 학생 것만. 제네릭으로 묶으면 supabase 타입이 깊어져 컴파일이 멈추므로
  // 표마다 적습니다.
  const invQ = (from: number, to: number) => {
    const q = supabase.from("invoices").select("*").order("issue_date").order("id").range(from, to);
    return only ? q.eq("student_id", only) : q;
  };
  const payQ = (from: number, to: number) => {
    const q = supabase.from("payments").select("id, invoice_id, student_id, paid_at, amount, method, memo, origin, kind, matched_by").order("paid_at").order("id").range(from, to);
    return only ? q.eq("student_id", only) : q;
  };
  const enrQ = () => {
    const q = supabase.from("student_fee_enrollments").select("student_id, plan_id, option_id, term_id, active, override_amount, override_note, paid_from").eq("active", true);
    return only ? q.eq("student_id", only) : q;
  };
  const sdQ = () => {
    const q = supabase.from("student_fee_discounts").select("student_id, discount_id, term_id, plan_id").eq("active", true);
    return only ? q.eq("student_id", only) : q;
  };
  const ovQ = () => {
    const q = supabase.from("student_fee_items").select("*");
    return only ? q.eq("student_id", only) : q;
  };

  const [stuRes, termRes, planRes, optRes, discRes, enrRes, sdRes, itemRes, ovRes, invRes, lineRes, payRes, addonRes] = await Promise.all([
    // 한 명을 찍어 읽을 때는 퇴소한 아이도 돌려줍니다 - 그 아이의 미납·예치금을 보는 자리입니다.
    only ? loadStudents(supabase, { ids: [only], status: "all" }) : loadStudents(supabase),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("fee_plans").select("*").order("category").order("sort_order").order("name"),
    supabase.from("fee_payment_options").select("*").order("sort_order").order("periods"),
    supabase.from("fee_discounts").select("*").order("sort_order").order("name"),
    enrQ(),
    sdQ(),
    supabase.from("fee_items").select("*").order("category").order("sort_order").order("name"),
    ovQ(),
    readAll<Invoice>(invQ),
    // 청구서 줄은 학생 칸이 없어 청구서 번호로 거릅니다. 한 명이면 아래에서 그 학생 청구서 번호로.
    only
      ? Promise.resolve({ rows: [] as BilledLine[], error: null, truncated: false })
      : readAll<BilledLine>((from, to) => supabase.from("invoice_lines").select("invoice_id, name, item_id").order("invoice_id").order("seq").range(from, to)),
    readAll<LedgerPayment>(payQ),
    // 함께 하면 합친 금액이 정해진 프로그램. 작은 표라 전부 읽습니다.
    supabase.from("fee_addon_prices").select("addon_plan_id, base_plan_id, combined_amount, active"),
  ]);

  for (const [name, r] of [
    ["학생", stuRes], ["학기", termRes], ["학비 항목", planRes], ["납부 옵션", optRes], ["할인", discRes],
    ["학비 신청", enrRes], ["학생 할인", sdRes], ["학비외 항목", itemRes], ["학비외 신청", ovRes], ["함께 하는 프로그램", addonRes],
  ] as const) {
    if (r.error) errors.push(`${name}: ${typeof r.error === "string" ? r.error : r.error.message}`);
  }
  if (invRes.error) errors.push(`청구서: ${invRes.error}`);
  if (invRes.truncated) errors.push("청구서가 한도를 넘어 일부만 읽었습니다.");
  if (lineRes.error) errors.push(`청구서 줄: ${lineRes.error}`);
  if (payRes.error) errors.push(`입금: ${payRes.error}`);
  if (payRes.truncated) errors.push("입금이 한도를 넘어 일부만 읽었습니다.");

  let lines = lineRes.rows;
  if (only) {
    const ids = invRes.rows.map((v) => v.id);
    if (ids.length > 0) {
      const { data, error } = await supabase.from("invoice_lines").select("invoice_id, name, item_id").in("invoice_id", ids).order("seq");
      if (error) errors.push(`청구서 줄: ${error.message}`);
      lines = (data as BilledLine[] | null) ?? [];
    }
  }

  const terms = (termRes.data as Term[] | null) ?? [];
  // 달을 골랐으면 그 달이 담긴 학기입니다(`termOfMonth`). 학기를 따로 골랐으면 그것이 먼저입니다.
  const monthOk = /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month ?? "") ? (opts.month as string) : null;
  const termOfPicked = monthOk
    ? termOfMonth(monthOk, terms.map((t) => ({ id: t.id, label: `${t.year} ${t.term_type}`, start_date: t.start_date ?? null, end_date: t.end_date ?? null })))?.id ?? null
    : null;
  const termId = opts.termId ?? termOfPicked ?? terms.find((t) => t.status === "진행중")?.id ?? null;
  const termIsCurrent = terms.find((t) => t.id === termId)?.status === "진행중";

  const world: LedgerWorld = {
    termId,
    termIsCurrent,
    today: todayKst(),
    plans: (planRes.data as FeePlan[] | null) ?? [],
    options: (optRes.data as FeePaymentOption[] | null) ?? [],
    discounts: (discRes.data as FeeDiscount[] | null) ?? [],
    enrollments: (enrRes.data as Enrollment[] | null) ?? [],
    studentDiscounts: (sdRes.data as StudentDiscountRow[] | null) ?? [],
    items: (itemRes.data as FeeItem[] | null) ?? [],
    overrides: (ovRes.data as StudentFeeItem[] | null) ?? [],
    invoices: invRes.rows,
    lines,
    payments: payRes.rows,
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month ?? "") ? (opts.month as string) : null,
    addonPrices: (addonRes.data as AddonPrice[] | null) ?? [],
  };
  const students = stuRes.rows.map((s) => ({
    id: s.id,
    name: s.name,
    name_en: s.name_en ?? null,
    grade: s.grade,
    class_name: s.class_name,
    department: s.department ?? null,
  }));
  return { world, students, terms, errors };
}
