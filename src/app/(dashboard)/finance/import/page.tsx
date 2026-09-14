import { redirect } from "next/navigation";
import Link from "next/link";
import FinanceLive from "@/components/finance/FinanceLive";
import ImportUploadClient, { type BatchRow } from "@/components/finance/ImportUploadClient";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * **올톡페이 결제내역 올리기 — 묶음 목록.**
 *
 * 올린 파일 한 벌이 한 줄입니다. **대기가 몇 줄 남았는지**가 보여야 며칠에 걸쳐 나눠
 * 검수할 수 있습니다 - 285줄을 한 자리에서 다 보는 일은 실제로 일어나지 않습니다.
 */
export default async function FinanceImportPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!hasFinanceAccess(me)) redirect("/home");

  const supabase = await createClient();
  // 진행 상황은 **데이터베이스가 셉니다**(payment_import_progress). 화면이 줄을 끌어와
  // 세면 묶음이 늘수록 느려지고, 어느 순간 한도에 걸려 숫자가 조용히 줄어듭니다.
  const { data, error } = await supabase
    .from("payment_import_progress")
    .select("*")
    .order("uploaded_at", { ascending: false });

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col p-4 sm:p-6">
      <FinanceLive />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">📥 결제내역 올리기</h1>
        <Link href="/finance/payments" className="ml-auto text-[12px] font-semibold text-teal-700 underline">
          수납 →
        </Link>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          자료를 읽지 못했습니다: {error.message}
        </p>
      )}

      <ImportUploadClient batches={((data as BatchRow[] | null) ?? [])} />
    </div>
  );
}
