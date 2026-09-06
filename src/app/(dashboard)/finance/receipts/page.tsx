import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import CashReceiptsClient, { type CashReceiptRow } from "@/components/finance/CashReceiptsClient";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "🧾 현금영수증이란?",
    lines: [
      "현금이나 계좌이체로 받은 돈에 대해 학부모가 요청하시는 증빙입니다. 카드 결제와 올톡페이는 그 자체로 증빙이 남아 여기 오지 않습니다.",
      "수납을 넣을 때 [현금영수증 신청]에 체크하고 휴대폰번호(개인) 또는 사업자등록번호(사업자)를 적으면 이 화면에 발행 대기로 쌓입니다.",
      "발행은 홈택스에서 하고, 끝나면 [발행함]을 눌러 표시합니다. 승인번호는 적어두면 나중에 문의가 왔을 때 그 자리에서 답할 수 있습니다.",
    ],
  },
  {
    title: "❓ 왜 앱에서 바로 발행하지 않나요?",
    lines: [
      "국세청 현금영수증 API 연동에는 사업자 인증서 등록과 별도 신청·심사가 필요합니다. 준비되면 이 화면에서 바로 발행하도록 바꿉니다.",
      "그때까지도 신청 내용을 여기 모아두는 것이 낫습니다 - 카톡과 구두로 오가면 누가 무엇을 요청했는지 남지 않고, 연말정산 철 문의에 답할 수 없습니다.",
    ],
  },
];

export default async function CashReceiptsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_receipts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) console.error("[현금영수증] 목록을 읽지 못했습니다:", error.message);

  const rows = (data as CashReceiptRow[] | null) ?? [];
  const ids = [...new Set(rows.map((r) => r.student_id).filter((v): v is string => !!v))];
  const { data: students } = ids.length
    ? await supabase.from("wr_students").select("id, name").eq("is_demo", false).in("id", ids)
    : { data: [] };
  const nameByStudent: Record<string, string> = {};
  for (const s of ((students as { id: string; name: string }[] | null) ?? [])) nameByStudent[s.id] = s.name;

  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🧾 현금영수증</h1>
        <GuideButton title="현금영수증 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        현금·계좌이체로 받은 건의 현금영수증 신청과 발행 여부를 여기서 관리합니다.
      </p>
      <CashReceiptsClient initialRows={rows} nameByStudent={nameByStudent} currentUserName={me.name ?? me.email} />
    </div>
  );
}
