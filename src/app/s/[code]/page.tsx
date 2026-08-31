import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { detectPlatform } from "@/lib/driverSetup";
import DriverSetupClient from "@/components/shuttle/DriverSetupClient";

export const dynamic = "force-dynamic";

// 기사님께 문자·카카오톡으로 보내는 설정 링크입니다(요청: "웹앱으로 몇호차 기사님께 보내기하면
// 기사님 카톡이나 문자로 링크가 가서 누르면 웹앱으로 접속되고 거기에서 편하게 누르면...").
//
// 로그인이 없습니다 - 기사님은 학교 계정이 없으시고, 계정을 만들어드리는 것 자체가 이 화면이
// 없애려는 그 번거로움입니다. 대신 주소의 6자리 코드가 열쇠 역할을 하고, 이 화면은 위치 기록을
// 전혀 보여주지 않습니다(설정에 필요한 값만 보여줍니다). 코드가 새어 나가도 남이 볼 수 있는 건
// "몇 호차의 기기 ID가 무엇인가"뿐이고, 그마저 걱정되면 관리자 화면에서 코드를 새로 발급하면
// 예전 링크는 바로 열리지 않습니다.

type PageProps = { params: Promise<{ code: string }> };

export default async function DriverSetupPage({ params }: PageProps) {
  const { code } = await params;
  const headerList = await headers();
  const platform = detectPlatform(headerList.get("user-agent") ?? "");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return <NotFound reason="서버 설정이 아직 끝나지 않았습니다." />;

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: device } = await supabase
    .from("shuttle_tracker_devices")
    .select("id, device_id, enabled, last_seen_at, route_id")
    .eq("setup_code", code)
    .maybeSingle();

  if (!device) return <NotFound reason="주소가 정확한지 확인해주세요. 링크가 새로 발급되었을 수도 있습니다." />;

  const { data: route } = await supabase
    .from("shuttle_routes")
    .select("route_no, name, vehicle_no, driver_name")
    .eq("id", device.route_id)
    .maybeSingle();

  // 링크를 여신 시각을 남깁니다. 담당자가 "보내드렸는데 하셨나?"를 전화로 묻지 않아도 됩니다.
  // 이미 기록이 있으면 덮어쓰지 않습니다(처음 여신 때가 알고 싶은 값이라).
  await supabase
    .from("shuttle_tracker_devices")
    .update({ setup_opened_at: new Date().toISOString() })
    .eq("id", device.id)
    .is("setup_opened_at", null);

  const routeLabel = route ? `${route.route_no}호차${route.name ? ` (${route.name})` : ""}` : "하원 차량";

  // 서버 주소는 배포 도메인에 따라 달라져서 요청 헤더에서 만듭니다(로컬·미리보기·실서버 모두 대응).
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const serverUrl = `${proto}://${host}/api/shuttle/track`;

  return (
    <DriverSetupClient
      platform={platform}
      routeLabel={routeLabel}
      vehicleNo={route?.vehicle_no ?? null}
      driverName={route?.driver_name ?? null}
      deviceId={device.device_id}
      serverUrl={serverUrl}
      setupCode={code}
      alreadyConnected={!!device.last_seen_at}
      enabled={device.enabled}
    />
  );
}

function NotFound({ reason }: { reason: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm g-panel-solid p-6 text-center shadow-sm">
        <div className="mb-2 text-3xl">🔎</div>
        <h1 className="mb-1 text-base font-bold text-slate-800">설정 링크를 찾을 수 없습니다</h1>
        <p className="text-sm leading-relaxed text-slate-500">{reason}</p>
        <p className="mt-3 text-xs text-slate-400">학교 사무실로 연락 주시면 링크를 다시 보내드리겠습니다.</p>
      </div>
    </main>
  );
}
