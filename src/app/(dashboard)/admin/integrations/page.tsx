import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import { INTEGRATIONS } from "@/lib/heartbeat";
import IntegrationsClient, { type Row, type DataStat } from "@/components/admin/IntegrationsClient";

export const dynamic = "force-dynamic";

// 연동 상태 - 무엇이 조용히 멈췄는지 한 화면에서 봅니다.
//
// 이 화면을 만든 이유는 하나입니다. 27호 GPS 추적이 3일 동안 죽어 있었는데 아무도 몰랐습니다.
// 크론 주소를 옮긴 뒤 새 주소를 스케줄러에 등록하지 않은 것이 원인이었고, 담당자가 "기록분석에
// 아무것도 안 보인다"고 말해서야 찾았습니다.
//
// 이런 실패는 화면이 깨지지 않습니다. **그냥 새 데이터가 안 들어올 뿐**이라, 조용한 날과
// 고장난 날이 똑같이 보입니다. 그래서 "돌고 있다"는 신호를 따로 남기고 여기서 확인합니다.
export default async function IntegrationsPage() {
  const supabase = await createClient();
  // 권한 판정은 앱 전체가 쓰는 isAdminUser로 합니다.
  //
  // 처음에는 app_users.position이 "관리자"인지 직접 비교했는데, 그러면 개발자 계정과
  // 역할 미리보기 상태가 걸러집니다. 실제로 관리 메뉴에서 눌러도 홈으로 튕겼습니다 -
  // 같은 판단을 두 군데서 다르게 하면 이런 일이 생깁니다.
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isAdminUser(me)) redirect("/home");

  const { data: beats } = await supabase.from("integration_heartbeats").select("key, last_seen_at, status, detail");
  const byKey = new Map((beats ?? []).map((b) => [b.key as string, b]));

  const rows: Row[] = INTEGRATIONS.map((spec) => {
    const b = byKey.get(spec.key);
    return {
      key: spec.key,
      label: spec.label,
      what: spec.what,
      everyMinutes: spec.everyMinutes,
      officeHoursOnly: !!spec.officeHoursOnly,
      lastSeenAt: (b?.last_seen_at as string | null) ?? null,
      status: (b?.status as string | null) ?? null,
      detail: (b?.detail as string | null) ?? null,
    };
  });

  // 신호가 아니라 **실제로 쌓인 데이터**도 함께 봅니다. 크론이 돌아도 데이터가 안 들어오는
  // 경우(예: 기사님 폰이 꺼져 있음)는 신호만으로는 안 잡힙니다.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [pings24, pingsMonth, lastPing, events24, chat24, inquiries24] = await Promise.all([
    supabase.from("shuttle_pilot_pings").select("id", { count: "exact", head: true }).gte("recorded_at", dayAgo),
    supabase.from("shuttle_pilot_pings").select("id", { count: "exact", head: true }).gte("recorded_at", monthAgo),
    supabase.from("shuttle_pilot_pings").select("recorded_at").order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("shuttle_run_events").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    supabase.from("google_chat_mirror_messages").select("id", { count: "exact", head: true }).gte("received_at", dayAgo),
    supabase.from("pickup_requests").select("id", { count: "exact", head: true }).gte("received_at", dayAgo),
  ]);

  const monthCount = pingsMonth.count ?? 0;
  // 위치 한 줄이 대략 120바이트(좌표·시각·정확도·인덱스 포함 실측 근사).
  const monthMb = Math.round((monthCount * 120) / 1024 / 1024);

  const stats: DataStat[] = [
    {
      label: "GPS 위치 수신",
      value: `24시간 ${(pings24.count ?? 0).toLocaleString()}건`,
      sub: lastPing.data?.recorded_at ? `마지막 ${new Date(lastPing.data.recorded_at).toLocaleString("ko-KR")}` : "기록 없음",
      warn: (pings24.count ?? 0) === 0,
    },
    {
      label: "출발·도착 판단",
      value: `24시간 ${(events24.count ?? 0).toLocaleString()}건`,
      // GPS는 오는데 판단이 0이면 크론이 안 도는 것입니다 - 27호 때 바로 이 상태였습니다.
      sub: (pings24.count ?? 0) > 0 && (events24.count ?? 0) === 0 ? "⚠️ 위치는 오는데 판단이 없습니다" : "",
      warn: (pings24.count ?? 0) > 0 && (events24.count ?? 0) === 0,
    },
    { label: "구글챗 수집", value: `24시간 ${(chat24.count ?? 0).toLocaleString()}건`, sub: "", warn: false },
    { label: "문의·픽업 수집", value: `24시간 ${(inquiries24.count ?? 0).toLocaleString()}건`, sub: "", warn: false },
    {
      label: "GPS 저장량(30일)",
      value: `${monthCount.toLocaleString()}건 · 약 ${monthMb}MB`,
      sub: monthMb > 500 ? "⚠️ Traccar 간격을 확인하세요" : "",
      warn: monthMb > 500,
    },
  ];

  return <IntegrationsClient rows={rows} stats={stats} />;
}
