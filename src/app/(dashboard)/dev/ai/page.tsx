import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { AiUsageLog, AiFeatureFlag } from "@/lib/types";
import { estimateCostUsd, formatUsd, AI_FEATURES } from "@/lib/ai/pricing";
import AiFeatureTogglesClient from "@/components/dev/AiFeatureTogglesClient";

// AI 사용량 · 과금 - 개발자 전용.
//
// 개발자 대시보드 한 장에 다 있던 것을 탭으로 갈랐습니다. 한 화면에 여섯 덩이가 쌓여 있으면
// 급할 때 필요한 것을 못 찾습니다. AI 비용은 "가끔 들여다보는 것"이라 따로 두는 편이 맞습니다.

export const dynamic = "force-dynamic";

const THIRTY_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const SEVEN_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
};

export default async function DevAiPage() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) redirect("/home");

  const supabase = await createClient();
  const [usageRes, flagsRes] = await Promise.all([
    supabase.from("ai_usage_logs").select("*").gte("created_at", THIRTY_DAYS_AGO()).order("created_at", { ascending: false }).limit(1000),
    supabase.from("ai_feature_flags").select("*").order("group_name", { ascending: true }),
  ]);

  const usageLogs = (usageRes.data as AiUsageLog[]) ?? [];
  const featureFlags = (flagsRes.data as AiFeatureFlag[] | null) ?? [];
  const sevenDaysAgoStr = SEVEN_DAYS_AGO();

  type RouteStat = {
    route: string;
    calls7d: number;
    calls30d: number;
    fails30d: number;
    inTokens30d: number;
    outTokens30d: number;
    cost30d: number;
  };
  const byRoute = new Map<string, RouteStat>();
  for (const log of usageLogs) {
    const e =
      byRoute.get(log.route) ??
      { route: log.route, calls7d: 0, calls30d: 0, fails30d: 0, inTokens30d: 0, outTokens30d: 0, cost30d: 0 };
    e.calls30d += 1;
    if (log.created_at >= sevenDaysAgoStr) e.calls7d += 1;
    if (!log.success) e.fails30d += 1;
    e.inTokens30d += log.input_tokens ?? 0;
    e.outTokens30d += log.output_tokens ?? 0;
    e.cost30d += estimateCostUsd(log.model, log.input_tokens ?? 0, log.output_tokens ?? 0);
    byRoute.set(log.route, e);
  }
  const routeStats = [...byRoute.values()].sort((a, b) => b.cost30d - a.cost30d);
  const totalCost30d = usageLogs.reduce((s, l) => s + estimateCostUsd(l.model, l.input_tokens ?? 0, l.output_tokens ?? 0), 0);
  const totalFails30d = usageLogs.filter((l) => !l.success).length;
  const totalInTokens = usageLogs.reduce((s, l) => s + (l.input_tokens ?? 0), 0);
  const totalOutTokens = usageLogs.reduce((s, l) => s + (l.output_tokens ?? 0), 0);

  const flagByKey = new Map(featureFlags.map((f) => [f.key, f]));
  const featureItems = AI_FEATURES.map((f) => ({
    ...f,
    enabled: flagByKey.get(f.key)?.enabled ?? true,
    updatedAt: flagByKey.get(f.key)?.updated_at ?? null,
    updatedBy: flagByKey.get(f.key)?.updated_by ?? null,
  }));

  return (
    <div className="mx-auto max-w-5xl p-4">
      <h1 className="mb-3 text-lg font-bold">🤖 AI 사용량 · 과금</h1>

      <div className="mb-2 text-xs font-semibold text-slate-400">최근 30일</div>
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-sm font-bold text-blue-700">
            💰 예상 과금 {formatUsd(totalCost30d)}
          </span>
          <span>총 호출 {usageLogs.length}회</span>
          <span>실패 {totalFails30d}회</span>
          <span>입력 토큰 {totalInTokens.toLocaleString()}</span>
          <span>출력 토큰 {totalOutTokens.toLocaleString()}</span>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          Anthropic 공식 요금표 기준 추정치입니다. 실제 청구서와는 소폭 차이가 날 수 있습니다.
        </p>
        {routeStats.length === 0 ? (
          <p className="text-xs text-slate-400">아직 기록된 AI 호출이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {routeStats.map((r) => (
              <div key={r.route} className="flex items-center gap-3 border-t border-slate-100 py-1.5 text-xs first:border-t-0">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-700">{r.route}</span>
                <span className="shrink-0 font-semibold text-blue-700">{formatUsd(r.cost30d)}</span>
                <span className="shrink-0 text-slate-500">7일 {r.calls7d}회</span>
                <span className="shrink-0 text-slate-500">30일 {r.calls30d}회</span>
                {r.fails30d > 0 && <span className="shrink-0 font-semibold text-red-600">실패 {r.fails30d}</span>}
                <span className="shrink-0 text-slate-400">
                  in {r.inTokens30d.toLocaleString()} / out {r.outTokens30d.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-2 text-xs font-semibold text-slate-400">기능 on/off</div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          끄면 그 기능은 즉시 막히고(API 호출 자체가 없으므로 비용도 0원) 전 직원 사이드바에
          &quot;일시정지중&quot; 배너가 뜹니다.
        </p>
        <AiFeatureTogglesClient initialFeatures={featureItems} myEmail={me?.email ?? ""} />
      </div>
    </div>
  );
}
