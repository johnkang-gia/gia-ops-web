import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import CashReceiptsClient, { type CashReceiptRow, type StudentLite } from "@/components/finance/CashReceiptsClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🧾 이 화면이 하는 일",
    lines: [
      "현금영수증 발행 자체는 결제 단말기에서 합니다. 이 화면은 그 앞뒤를 붙잡습니다.",
      "① 누가 현금영수증을 달라고 했는지 한 곳에 모읍니다. 지금은 카톡·구두로 흩어져 있어 연말정산 철 문의에 답할 수 없습니다.",
      "② 휴대폰번호(개인) 또는 사업자등록번호(사업자)를 미리 받아둡니다. 번호가 없는 건은 목록 맨 위에 빨갛게 섭니다.",
      "③ [🖨 인쇄]로 종이 한 장을 뽑아 단말기 앞에 들고 갑니다. 번호가 크게 찍혀 있어 자리를 세지 않아도 됩니다.",
      "④ 끊고 오시면 [발행함]을 누릅니다. 여러 건이면 체크해서 한 번에 누를 수 있습니다.",
    ],
  },
  {
    title: "⚠️ 체크를 잊으면 두 번 나갑니다",
    lines: [
      "뽑아서 단말기에서 다 끊었는데 앱에 체크하는 것을 잊으면, 다음에 뽑을 때 같은 사람이 또 나오고 두 번 발행됩니다.",
      "두 번 발행된 것은 취소 발행으로만 되돌릴 수 있습니다. 그래서 뽑아간 건에는 [🖨 뽑아감 · 미체크] 표시가 붙습니다.",
      "위쪽 [뽑았는데 미체크] 숫자가 0이 아니면 확인해주세요.",
    ],
  },
  {
    title: "❓ 요청은 어디서 들어오나요",
    lines: [
      "수납을 넣을 때 [🧾 현금영수증 신청]에 체크하면 여기로 옵니다.",
      "나중에 요청이 오는 경우가 더 많아서, 이 화면의 [＋ 요청 추가]로도 바로 접수할 수 있습니다.",
      "이름이 명부에 있으면 학생에 연결되고, 없으면 이름으로만 남습니다. 사업자 명의처럼 학생과 안 이어지는 건도 있어서 접수를 막지 않습니다.",
    ],
  },
];

export default async function CashReceiptsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const [{ data, error }, { data: studentRows }] = await Promise.all([
    supabase.from("cash_receipts").select("*").order("created_at", { ascending: false }).limit(500),
    // 접수할 때 이름으로 학생을 고릅니다. 명부 전체가 있어야 이름을 치는 순간 붙습니다.
    supabase
      .from("wr_students")
      .select("id, name, grade, class_name")
      .eq("status", "active")
      .eq("is_demo", false)
      .order("grade")
      .order("name"),
  ]);
  if (error) console.error("[현금영수증] 목록을 읽지 못했습니다:", error.message);

  const rows = (data as CashReceiptRow[] | null) ?? [];
  const students = (studentRows as StudentLite[] | null) ?? [];

  // 어느 청구서 건인지. 「이 사람 얼마짜리였지」를 확인하러 인보이스 명단으로 건너가야
  // 하면 그 왕복이 곧 안 하게 되는 이유가 됩니다.
  const invoiceIds = [...new Set(rows.map((r) => r.invoice_id).filter((v): v is string => !!v))];
  const { data: invRows } = invoiceIds.length
    ? await supabase.from("invoices").select("id, invoice_no, category").in("id", invoiceIds)
    : { data: [] };
  const invoiceLabel: Record<string, string> = {};
  for (const v of ((invRows as { id: string; invoice_no: string; category: string | null }[] | null) ?? [])) {
    invoiceLabel[v.id] = v.invoice_no + (v.category ? ` · ${v.category}` : "");
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🧾 현금영수증</h1>
        <GuideButton title="현금영수증 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        현금영수증을 요청하신 분을 모아두고, 번호를 미리 받아두고, 종이로 뽑아 단말기에서 끊은 뒤 체크하는 곳입니다.
      </p>
      <CashReceiptsClient
        initialRows={rows}
        students={students}
        invoiceLabel={invoiceLabel}
        currentUserName={me.name ?? me.email}
      />
    </div>
  );
}
