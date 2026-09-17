import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import { runInspect } from "@/lib/inspectRun";
import { kstParts } from "@/lib/shuttleTracking";
import { APP_VERSION } from "@/lib/version";
import InspectClient from "@/components/dev/InspectClient";

/**
 * **점검** — 코드·데이터·보호를 한 번에 재고, 결과를 그대로 복사해 보냅니다.
 *
 * 옆의 「진단」은 **무엇이 지금 안 도는가**(연결·GPS·크론)를 봅니다. 이 화면은 **무엇이
 * 잘못된 채로 잘 돌고 있는가**를 봅니다 - 로그인 없이 읽히는 표, 서로 어긋난 숫자, 반영이
 * 안 된 마이그레이션. 둘 다 오류를 내지 않아서, 물어보지 않으면 영영 안 드러납니다.
 *
 * 개발자만 엽니다. 로그인 안 한 열쇠로 실제로 물어보는 검사가 들어 있어서, 그 결과는
 * 「무엇이 뚫려 있는지」의 목록이기도 합니다.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DevInspectPage() {
  const me = await getCurrentAppUser();
  if (!isDeveloperEmail(me?.email)) redirect("/home");

  const supabase = await createClient();
  const rows = await runInspect(supabase);
  const { iso, hour, minute } = kstParts(new Date());
  const at = `${iso} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return <InspectClient rows={rows} at={at} version={APP_VERSION} />;
}
