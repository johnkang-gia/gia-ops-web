import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { ErrorLog, AiUsageLog, AiFeatureFlag } from "@/lib/types";
import { estimateCostUsd, formatUsd, AI_FEATURES } from "@/lib/ai/pricing";
import AiFeatureTogglesClient from "@/components/dev/AiFeatureTogglesClient";

export const dynamic = "force-dynamic";

const FOURTEEN_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString();
};
const THREE_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString();
};
const SEVEN_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
};
const THIRTY_DAYS_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};

export default async function DevDashboardPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) {
    redirect("/home");
  }

  const [
    incidentsCount,
    eventsCount,
    meetingsCount,
    proposalsPendingCount,
    adoptedPendingCount,
    manualSectionsCount,
    inquiriesOpenCount,
    appUsersPendingCount,
    staleProposals,
    staleAdopted,
    staleInquiries,
    recentErrors,
    recentUsage,
    featureFlagsRes,
  ] = await Promise.all([
    supabase.from("incidents").select("id", { count: "exact", head: true }),
    supabase.from("events").select("id", { count: "exact", head: true }),
    supabase.from("meetings").select("id", { count: "exact", head: true }),
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "검토대기"),
    supabase.from("adopted").select("id", { count: "exact", head: true }).eq("publish", false),
    supabase.from("manual_sections").select("id", { count: "exact", head: true }),
    supabase.from("inquiries").select("id", { count: "exact", head: true }).neq("status", "완료"),
    supabase.from("app_users").select("email", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("proposals")
      .select("id, category, date, created_at")
      .eq("status", "검토대기")
      .lt("created_at", FOURTEEN_DAYS_AGO())
      .order("created_at", { ascending: true })
      .limit(5),
    supabase
      .from("adopted")
      .select("id, category, date, created_at")
      .eq("publish", false)
      .lt("created_at", FOURTEEN_DAYS_AGO())
      .order("created_at", { ascending: true })
      .limit(5),
    supabase
      .from("inquiries")
      .select("id, category, title, created_at")
      .eq("category", "오류")
      .neq("status", "완료")
      .lt("created_at", THREE_DAYS_AGO())
      .order("created_at", { ascending: true })
      .limit(5),
    supabase
      .from("error_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ai_usage_logs")
      .select("*")
      .gte("created_at", THIRTY_DAYS_AGO())
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("ai_feature_flags").select("*").order("group_name", { ascending: true }),
  ]);

  const errorLogs = (recentErrors.data as ErrorLog[]) ?? [];
  const usageLogs = (recentUsage.data as AiUsageLog[]) ?? [];
  const featureFlags = (featureFlagsRes.data as AiFeatureFlag[] | null) ?? [];
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
    const existing = byRoute.get(log.route) ?? {
      route: log.route,
      calls7d: 0,
      calls30d: 0,
      fails30d: 0,
      inTokens30d: 0,
      outTokens30d: 0,
      cost30d: 0,
    };
    existing.calls30d += 1;
    if (log.created_at >= sevenDaysAgoStr) existing.calls7d += 1;
    if (!log.success) existing.fails30d += 1;
    existing.inTokens30d += log.input_tokens ?? 0;
    existing.outTokens30d += log.output_tokens ?? 0;
    existing.cost30d += estimateCostUsd(log.model, log.input_tokens ?? 0, log.output_tokens ?? 0);
    byRoute.set(log.route, existing);
  }
  const routeStats = [...byRoute.values()].sort((a, b) => b.cost30d - a.cost30d);
  const totalCalls30d = usageLogs.length;
  const totalFails30d = usageLogs.filter((l) => !l.success).length;
  const totalInTokens = usageLogs.reduce((sum, l) => sum + (l.input_tokens ?? 0), 0);
  const totalOutTokens = usageLogs.reduce((sum, l) => sum + (l.output_tokens ?? 0), 0);
  const totalCost30d = usageLogs.reduce(
    (sum, l) => sum + estimateCostUsd(l.model, l.input_tokens ?? 0, l.output_tokens ?? 0),
    0
  );
  // ai_feature_flags 테이블에 아직 없는 신규 route도 목록에서는 "켜짐" 상태로 항상 보여줍니다
  // (AI_FEATURES가 코드 기준 source of truth, DB는 개발자가 끈 것만 기록).
  const flagByKey = new Map(featureFlags.map((f) => [f.key, f]));
  const featureItems = AI_FEATURES.map((f) => ({
    ...f,
    enabled: flagByKey.get(f.key)?.enabled ?? true,
  }));

  const dataCards = [
    { label: "📋 사건", value: incidentsCount.count ?? 0, href: "/records" },
    { label: "🎉 행사", value: eventsCount.count ?? 0, href: "/events" },
    { label: "💬 회의", value: meetingsCount.count ?? 0, href: "/meetings" },
    { label: "📝 제안함 대기", value: proposalsPendingCount.count ?? 0, href: "/proposals" },
    { label: "📬 채택예정 대기", value: adoptedPendingCount.count ?? 0, href: "/adopted" },
    { label: "📖 매뉴얼 항목", value: manualSectionsCount.count ?? 0, href: "/manuals" },
    { label: "🗣️ 미해결 문의", value: inquiriesOpenCount.count ?? 0, href: "/inquiries" },
    { label: "🔐 승인 대기 계정", value: appUsersPendingCount.count ?? 0, href: "/admin/users" },
  ];

  const maintenanceAlerts = [
    ...staleProposals.data ?? [],
  ].length > 0 || (staleAdopted.data?.length ?? 0) > 0 || (staleInquiries.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-lg font-bold">개발자 대시보드</h1>
      <p className="mb-5 text-xs text-slate-500">
        전체 데이터 현황, 방치된 항목, AI 사용량, 최근 오류를 한눈에 확인합니다. 실사용자 페이지
        속도는{" "}
        <a
          href="https://vercel.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Vercel 대시보드의 Analytics/Speed Insights 탭
        </a>
        에서, DB 용량/쿼리 성능은{" "}
        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Supabase 대시보드
        </a>
        에서 확인하세요.
      </p>

      <div className="mb-2 text-xs font-semibold text-slate-400">데이터 현황</div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {dataCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm hover:border-slate-300"
          >
            <div className="text-lg font-bold">{card.value}</div>
            <div className="mt-1 text-xs text-slate-500">{card.label}</div>
          </Link>
        ))}
      </div>

      <div className="mb-2 text-xs font-semibold text-slate-400">유지보수 알림 (방치된 항목)</div>
      <div className="mb-6 flex flex-col gap-2">
        {!maintenanceAlerts && (
          <div className="rounded-lg bg-white p-3 text-sm text-slate-400 shadow-sm">
            14일 이상 방치된 제안/채택예정, 3일 이상 미해결 오류 문의가 없습니다.
          </div>
        )}
        {(staleProposals.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="mb-1 font-semibold">📝 제안함에서 14일 넘게 검토대기 중 ({staleProposals.data!.length}건)</div>
            {staleProposals.data!.map((p) => (
              <div key={p.id}>{p.category} · {p.date}</div>
            ))}
            <Link href="/proposals" className="mt-1 inline-block underline">제안함 열기 →</Link>
          </div>
        )}
        {(staleAdopted.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <div className="mb-1 font-semibold">📬 채택예정에서 14일 넘게 발행대기 중 ({staleAdopted.data!.length}건)</div>
            {staleAdopted.data!.map((a) => (
              <div key={a.id}>{a.category} · {a.date}</div>
            ))}
            <Link href="/adopted" className="mt-1 inline-block underline">채택예정 열기 →</Link>
          </div>
        )}
        {(staleInquiries.data?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <div className="mb-1 font-semibold">🐞 3일 넘게 미처리된 오류 문의 ({staleInquiries.data!.length}건)</div>
            {staleInquiries.data!.map((i) => (
              <div key={i.id}>{i.title}</div>
            ))}
            <Link href="/inquiries" className="mt-1 inline-block underline">문의함 열기 →</Link>
          </div>
        )}
      </div>

      <div className="mb-2 text-xs font-semibold text-slate-400">AI 사용량 & 예상 과금 (최근 30일)</div>
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-sm font-bold text-blue-700">
            💰 예상 과금 {formatUsd(totalCost30d)}
          </span>
          <span>총 호출 {totalCalls30d}회</span>
          <span>실패 {totalFails30d}회</span>
          <span>입력 토큰 {totalInTokens.toLocaleString()}</span>
          <span>출력 토큰 {totalOutTokens.toLocaleString()}</span>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          Anthropic 공식 요금표(Sonnet 5 $2/$10, Haiku 4.5 $1/$5 · 백만 토큰당) 기준 추정치입니다. 실제
          청구서와는 소폭 차이가 날 수 있습니다. Sonnet 5는 2026년 8월 31일까지 도입 특가이며 이후
          정가($3/$15)로 오릅니다.
        </p>
        {routeStats.length === 0 && <p className="text-xs text-slate-400">아직 기록된 AI 호출이 없습니다.</p>}
        {routeStats.length > 0 && (
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

      <div className="mb-2 text-xs font-semibold text-slate-400">AI 기능 on/off (과금 조절)</div>
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          과금이 부담스러운 기능을 꺼두면, 해당 기능은 즉시 사용이 막히고(Anthropic API 호출 자체가
          발생하지 않아 비용도 0원) 모든 직원 사이드바 프로필 아래에 빨간 배너로 &quot;일시정지중&quot;이
          표시됩니다.
        </p>
        <AiFeatureTogglesClient initialFeatures={featureItems} myEmail={me?.email ?? ""} />
      </div>

      <div className="mb-2 text-xs font-semibold text-slate-400">최근 오류 로그 (최신 20건)</div>
      <div className="mb-6 flex flex-col gap-1.5">
        {errorLogs.length === 0 && (
          <div className="rounded-lg bg-white p-3 text-sm text-slate-400 shadow-sm">기록된 오류가 없습니다.</div>
        )}
        {errorLogs.map((e) => (
          <div key={e.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 font-mono text-red-600">{e.route}</span>
              <span className="shrink-0 text-slate-400">{e.created_at.slice(0, 19).replace("T", " ")}</span>
              {e.user_email && <span className="shrink-0 text-slate-400">{e.user_email}</span>}
            </div>
            <p className="whitespace-pre-wrap text-slate-700">{e.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
