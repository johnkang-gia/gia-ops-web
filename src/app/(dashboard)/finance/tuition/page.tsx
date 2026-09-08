import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import { todayKst } from "@/lib/kst";
import GuideButton from "@/components/common/GuideButton";
import TuitionGridClient, {
  type TuitionStudent,
  type EnrollRow,
  type StudentDiscountRow,
} from "@/components/finance/TuitionGridClient";
import type { FeePlan, FeePaymentOption, FeeDiscount, Term, Invoice } from "@/lib/types";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "💰 청구 · 학비란?",
    lines: [
      "정규과정과 방과후 등록금을 청구하는 곳입니다. 교재·교복 같은 학비외 항목은 [청구 → 학비외]에서 따로 다룹니다.",
      "칸에 넣는 것은 금액이 아니라 «학부모가 고른 납부 옵션»입니다. 안내문에 √ 표시하고 서명해서 낸 그 항목이고, 그게 곧 계약입니다.",
      "금액은 기준금액 × 회차수 × (1 − 옵션 할인)으로 그때그때 계산합니다. 요금이 오르면 [납부 항목 · 할인]에서 기준금액 하나만 고치면 전부 따라옵니다.",
    ],
  },
  {
    title: "🏷️ 할인은 어떻게 붙이나요?",
    lines: [
      "할인 칸의 [＋]를 누르면 [납부 항목 · 할인]에서 만들어둔 할인을 골라 붙입니다. 할인 종류와 비율은 코드에 박혀 있지 않고 사람이 정합니다.",
      "붙일 때 «왜 붙이는지»를 반드시 적습니다. 몇 달 뒤 「이 아이는 왜 깎였지」에 답할 수 있는 것은 기억이 아니라 그 칸뿐입니다.",
      "비율 할인은 옵션 할인을 뺀 금액에 걸립니다 — 연납 10%를 받은 학생에게 특별감면 10%를 붙이면 20%가 아니라 연납가에서 다시 10%입니다.",
      "쓰지 않기로 한 할인은 지우지 말고 [납부 항목 · 할인]에서 끄세요. 지우면 지난 청구서가 왜 그 금액이었는지 설명할 수 없게 됩니다.",
    ],
  },
  {
    title: "🧾 발행",
    lines: [
      "학생을 체크하고 [고른 N명 발행]을 누릅니다. 한 명만 급하면 그 줄의 [발행 →]를 눌러도 됩니다.",
      "청구서에는 할인이 별도 줄로 찍힙니다. 깎인 금액만 적으면 학부모가 «원래 얼마였는데 얼마 깎였는지»를 알 수 없고, 그 문의가 행정실로 옵니다.",
      "발행은 종이를 만든 것이고, 청구가 나간 것은 아닙니다. 올톡페이 발송은 [청구 → 학비외]에서 합니다.",
    ],
  },
];

export default async function TuitionPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [stuRes, planRes, optRes, discRes, termRes, enrollRes, sdRes, invRes] = await Promise.all([
    supabase
      .from("wr_students")
      .select("id, name, name_en, grade, class_name, department")
      .eq("status", "active")
      .eq("is_demo", false)
      .order("grade")
      .order("name"),
    supabase.from("fee_plans").select("*").eq("category", "학비").order("sort_order").order("name"),
    supabase.from("fee_payment_options").select("*").order("sort_order").order("periods"),
    supabase.from("fee_discounts").select("*").order("sort_order").order("name"),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }),
    supabase.from("student_fee_enrollments").select("id, student_id, plan_id, option_id, term_id").eq("active", true),
    supabase.from("student_fee_discounts").select("id, student_id, discount_id, term_id, reason").eq("active", true),
    supabase
      .from("invoices")
      .select("*")
      .eq("category", "학비")
      .order("issue_date", { ascending: false })
      .limit(1000),
  ]);

  // 무엇을 못 읽었는지 **화면에 말합니다.** 조용히 비어 있으면 「아직 아무도 안 골랐구나」로
  // 오해하고 그대로 발행하게 됩니다.
  const loadError =
    stuRes.error?.message ??
    planRes.error?.message ??
    optRes.error?.message ??
    discRes.error?.message ??
    enrollRes.error?.message ??
    sdRes.error?.message ??
    invRes.error?.message ??
    null;

  const students: TuitionStudent[] = ((stuRes.data as
    | { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; department: string | null }[]
    | null) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    nameEn: s.name_en,
    grade: s.grade,
    className: s.class_name,
    department: s.department,
  }));

  return (
    <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">💰 청구 · 학비</h1>
        <GuideButton title="학비 청구 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-3 text-xs leading-relaxed text-slate-500">
        정규과정·방과후 등록금입니다. 학부모가 고른 납부 옵션을 넣으면 금액이 계산되고, 할인을 붙인 뒤 청구서를
        발행합니다. 교재·교복 같은 <b>학비외 항목은 [청구 → 학비외]</b>에서 따로 다룹니다.
      </p>

      <TuitionGridClient
        students={students}
        plans={(planRes.data as FeePlan[] | null) ?? []}
        options={(optRes.data as FeePaymentOption[] | null) ?? []}
        discounts={(discRes.data as FeeDiscount[] | null) ?? []}
        terms={(termRes.data as Term[] | null) ?? []}
        initialEnrollments={(enrollRes.data as EnrollRow[] | null) ?? []}
        initialStudentDiscounts={(sdRes.data as StudentDiscountRow[] | null) ?? []}
        recentInvoices={(invRes.data as Invoice[] | null) ?? []}
        today={todayKst()}
        loadError={loadError}
      />
    </div>
  );
}
