import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { ErrorLog } from "@/lib/types";
import ErrorLogCopy from "@/components/dev/ErrorLogCopy";

// 오류 - 개발자 전용.
//
// 개발자 대시보드 맨 아래에 붙어 있어서, 정작 오류가 났을 때 한참 스크롤해야 보였습니다.
// 급할 때 찾아야 하는 것을 맨 아래 두면 안 됩니다.

export const dynamic = "force-dynamic";

const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export default async function DevErrorsPage() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) redirect("/home");

  const supabase = await createClient();
  const [recent, c24, c7d, staleInquiries] = await Promise.all([
    supabase.from("error_logs").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", HOURS_AGO(24)),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", HOURS_AGO(24 * 7)),
    supabase
      .from("inquiries")
      .select("id, title")
      .eq("status", "접수")
      .lte("created_at", HOURS_AGO(24 * 3))
      .limit(10),
  ]);

  const logs = (recent.data as ErrorLog[]) ?? [];
  const errors24h = c24.count ?? 0;
  const avgPerDay = Math.round(((c7d.count ?? 0) / 7) * 10) / 10;
  // 평소보다 늘었는지. 평소를 모르면 "3건"이 많은 건지 적은 건지 알 수 없습니다.
  const spike = errors24h > Math.max(3, avgPerDay * 2);

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="mb-3 text-lg font-bold">🚨 오류</h1>

      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div
          className={
            "rounded-xl border p-3 text-xs shadow-sm " +
            (spike ? "border-red-200 bg-red-50 text-red-800" : "border-slate-200 bg-white text-slate-600")
          }
        >
          <div className="mb-1 font-semibold">최근 24시간</div>
          <div className="text-lg font-bold">{errors24h}건</div>
          {spike && <p className="mt-1">평소(7일 평균 {avgPerDay}건)보다 늘었습니다.</p>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm">
          <div className="mb-1 font-semibold">하루 평균 (7일)</div>
          <div className="text-lg font-bold">{avgPerDay}건</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-sm">
          <div className="mb-1 font-semibold">3일 넘은 미처리 문의</div>
          <div className="text-lg font-bold">{staleInquiries.data?.length ?? 0}건</div>
          <Link href="/inquiries" className="mt-1 inline-block underline">
            문의함 열기 →
          </Link>
        </div>
      </div>

      <ErrorLogCopy logs={logs} />
    </div>
  );
}
