import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { ErrorLog } from "@/lib/types";
import ErrorGroupList from "@/components/dev/ErrorGroupList";
import { groupErrors, type ErrorResolution } from "@/lib/errorGroup";

// 오류 - 개발자 전용.
//
// 개발자 대시보드 맨 아래에 붙어 있어서, 정작 오류가 났을 때 한참 스크롤해야 보였습니다.
// 급할 때 찾아야 하는 것을 맨 아래 두면 안 됩니다.

export const dynamic = "force-dynamic";

const HOURS_AGO = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/**
 * 며칠치를 볼 것인가. 너무 짧으면 「어제 고쳤는데 오늘 또 났나」를 못 보고, 너무 길면
 * 몇 달 전에 끝난 고장이 목록을 채웁니다.
 */
const WINDOW_DAYS = 30;
/** 이 줄 수를 넘으면 최근 것부터 자릅니다. 자른 사실은 화면에 적습니다. */
const MAX_ROWS = 3000;

export default async function DevErrorsPage() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) redirect("/home");

  const supabase = await createClient();
  const [recent, c24, c7d, staleInquiries, resolutionsRes] = await Promise.all([
    // 줄이 아니라 **묶음**으로 보기 위해 창(30일) 전체를 읽습니다. 50줄만 읽으면 한 가지가
    // 고장 났을 때 그 50줄이 전부 같은 오류가 되어, 다른 종류는 아예 안 보입니다.
    supabase
      .from("error_logs")
      .select("id, route, message, stack, user_email, created_at")
      .gte("created_at", HOURS_AGO(24 * WINDOW_DAYS))
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", HOURS_AGO(24)),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", HOURS_AGO(24 * 7)),
    supabase
      .from("inquiries")
      .select("id, title")
      .eq("status", "접수")
      .lte("created_at", HOURS_AGO(24 * 3))
      .limit(10),
    supabase.from("error_resolutions").select("fingerprint, resolved_at, resolved_by, note"),
  ]);

  const logs = (recent.data as ErrorLog[]) ?? [];
  // 표가 아직 없으면(마이그레이션 전) 해결 표시가 하나도 없는 것과 같습니다. 조용히
  // 빈 목록으로 두되, 조회 자체가 실패한 것은 서버 기록에 남깁니다.
  if (resolutionsRes.error) {
    console.error("[dev/errors] 해결 표시를 읽지 못했습니다:", resolutionsRes.error.message);
  }
  const groups = groupErrors(logs, (resolutionsRes.data as ErrorResolution[] | null) ?? []);
  const openCount = groups.filter((g) => !g.resolved).length;
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
        <div className="g-panel-solid p-3 text-xs text-slate-600 shadow-sm">
          {/* 「몇 줄이 쌓였나」가 아니라 **몇 가지가 남았나**입니다. 줄 수는 같은 고장이
              반복된 횟수라, 할 일의 크기를 알려주지 않습니다. */}
          <div className="mb-1 font-semibold">아직 안 고친 오류</div>
          <div className="text-lg font-bold">{openCount}가지</div>
          <p className="mt-1 text-slate-400">하루 평균 {avgPerDay}건 (7일)</p>
        </div>
        <div className="g-panel-solid p-3 text-xs text-slate-600 shadow-sm">
          <div className="mb-1 font-semibold">3일 넘은 미처리 문의</div>
          <div className="text-lg font-bold">{staleInquiries.data?.length ?? 0}건</div>
          <Link href="/inquiries" className="mt-1 inline-block underline">
            문의함 열기 →
          </Link>
        </div>
      </div>

      <ErrorGroupList groups={groups} truncated={logs.length >= MAX_ROWS} days={WINDOW_DAYS} />
    </div>
  );
}
