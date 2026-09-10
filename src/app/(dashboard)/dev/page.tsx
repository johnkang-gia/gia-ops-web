import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import SiteCheckPanel from "@/components/dev/SiteCheckPanel";
import { DATA_KINDS, openGaps } from "@/lib/registry/dataKinds";

const GUIDE_SECTIONS = [
  {
    title: "🛠️ 개발자 대시보드란?",
    lines: [
      "전체 데이터 현황, 14일 이상 방치된 제안/채택예정, 3일 이상 미해결 오류 문의를 한눈에 확인합니다.",
      "최근 30일 AI 사용량과 예상 과금, 라우트별 호출 수/토큰/실패 건수를 볼 수 있습니다.",
    ],
  },
  {
    title: "💰 AI 기능 on/off",
    lines: ["과금이 부담스러운 AI 기능은 개별적으로 꺼서 즉시 호출을 막을 수 있습니다(끄면 전 직원 화면에 일시정지 배너 표시)."],
  },
];

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
const ONE_DAY_AGO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
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
    errors24hCount,
    errors7dCount,
    lastBackup
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
    // 오류 상세 목록과 AI 사용량은 각각 /dev/errors, /dev/ai 로 옮겼습니다.
    // 개요에서까지 다시 읽으면 화면 하나 여는 데 조회가 두 배로 듭니다.
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", ONE_DAY_AGO()),
    supabase.from("error_logs").select("id", { count: "exact", head: true }).gte("created_at", SEVEN_DAYS_AGO()),
    supabase
      .from("backups")
      .select("label, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

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

  // 통합관리: 시스템 상태 확장(요청: "통합관리를 위해... 방법들을 제안해줘"). 최근 24시간 오류
  // 건수를 지난 7일 하루 평균과 비교해, 평소보다 눈에 띄게 늘었으면(1.5배 이상, 최소 3건)
  // 빨간 카드로 바로 눈에 띄게 표시합니다. 마지막 백업 카드는 /admin/backups의 수동 백업과
  // 새로 추가한 자동 일일 백업(cron)이 잘 돌고 있는지 여기서 바로 확인할 수 있게 합니다.
  const errors24h = errors24hCount.count ?? 0;
  // 평소를 모르면 "3건"이 많은 건지 적은 건지 알 수 없습니다. 7일 전체를 세서 평균을 냅니다
  // (예전에는 최근 20건만 보고 나눠서, 오류가 많을수록 평균이 오히려 낮게 나왔습니다).
  const errors7dAvg = (errors7dCount.count ?? 0) / 7;
  const errors24hSpike = errors24h >= 3 && errors24h >= errors7dAvg * 1.5;
  const lastBackupRow = lastBackup.data as { label: string | null; created_by: string; created_at: string } | null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">개발자 대시보드</h1>
        <div className="flex items-center gap-2">
          <GuideButton title="개발자 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>
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

      {/* 메뉴가 90개를 넘어 사람이 매일 돌면서 눌러보는 것은 이미 불가능합니다. 한 번 눌러
          전 화면을 열어보고 안 열리는 곳을 모아 보여줍니다. */}
      <div className="mb-6">
        <SiteCheckPanel />

        {/* ── 자료 등기소 ──────────────────────────────────────────────────
            자료 종류마다 「모이는 한 곳 · 중복 열쇠 · 넣기와 내리기」를 적어 둔 표입니다
            (src/lib/registry/dataKinds.ts). **짝이 없는 자리를 숨기지 않고 그대로
            띄웁니다** - 코드 주석에만 적어두면 아무도 안 열어보고, 그 사이에 한 곳에서
            지운 자료가 다른 화면에 계속 남습니다. */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-black text-slate-800">🗂 자료 등기소</h2>
            <span className="text-[11px] text-slate-400">
              종류 {DATA_KINDS.length} · 표를 새로 만들면 빌드가 등록을 요구합니다
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-[12px]">
              <thead className="bg-slate-100 text-[11px] text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-bold">종류</th>
                  <th className="px-2 py-1.5 text-left font-bold">모이는 한 곳</th>
                  <th className="w-12 px-2 py-1.5 font-bold">딸린 표</th>
                  <th className="px-2 py-1.5 text-left font-bold">중복 열쇠</th>
                  <th className="w-14 px-2 py-1.5 font-bold">내리기</th>
                </tr>
              </thead>
              <tbody>
                {DATA_KINDS.map((k) => (
                  <tr key={k.key} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-bold text-slate-700">{k.key}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] text-slate-500">{k.canonical}</td>
                    <td className="px-2 py-1.5 text-center tabular-nums text-slate-500">{k.satellites.length}</td>
                    <td className="px-2 py-1.5 text-[11px] text-slate-500">
                      {"by" in k.dedupe ? k.dedupe.by.join(" + ") : <span className="text-amber-700">막지 않음</span>}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {k.undo ? (
                        <span className="text-emerald-600">있음</span>
                      ) : (
                        <span className="font-bold text-red-600">없음</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openGaps().length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
              <p className="text-[12px] font-bold text-amber-800">아직 짝이 안 맞는 자리 {openGaps().length}</p>
              {openGaps().map((g) => (
                <p key={g.key} className="mt-0.5 text-[11px] leading-relaxed text-amber-900">
                  <b>{g.key}</b> — {g.gap}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mb-2 text-xs font-semibold text-slate-400">데이터 현황</div>
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {dataCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="g-panel-solid p-3 text-center shadow-sm hover:border-slate-300"
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

      <div className="mb-2 text-xs font-semibold text-slate-400">시스템 상태</div>
      <div className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          className={
            "rounded-xl border p-3 text-xs shadow-sm " +
            (errors24hSpike
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-slate-200 bg-white text-slate-600")
          }
        >
          <div className="mb-1 font-semibold">🚨 최근 24시간 오류</div>
          <div className="text-lg font-bold">{errors24h}건</div>
          {errors24hSpike && <p className="mt-1">평소(7일 평균 {Math.round(errors7dAvg * 10) / 10}건)보다 늘었습니다.</p>}
          <Link href="/dev/errors" className="mt-1 inline-block underline">오류 목록 열기 →</Link>
        </div>
        <div className="g-panel-solid p-3 text-xs text-slate-600 shadow-sm">
          <div className="mb-1 font-semibold">💾 마지막 자동/수동 백업</div>
          {lastBackupRow ? (
            <>
              <div className="text-sm font-bold text-slate-800">{lastBackupRow.label || "(라벨 없음)"}</div>
              <div className="mt-1 text-slate-400">
                {lastBackupRow.created_at.slice(0, 19).replace("T", " ")} · {lastBackupRow.created_by}
              </div>
            </>
          ) : (
            <p className="text-slate-400">아직 백업 기록이 없습니다.</p>
          )}
          <Link href="/admin/backups" className="mt-1 inline-block underline">백업/복원 화면 열기 →</Link>
        </div>
      </div>

      {/* AI 과금과 오류 로그는 각각 상단 탭(🤖 AI 과금 / 🚨 오류)으로 옮겼습니다.
          한 장에 여섯 덩이가 쌓여 있으면 급할 때 필요한 것을 못 찾습니다. */}
    </div>
  );
}
