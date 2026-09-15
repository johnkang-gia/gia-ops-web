import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { hasFinanceAccess, isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import type { CurrentAppUser } from "@/lib/currentUser";
import { loadFeeItemsPanel } from "@/lib/panels/feeItems";
import { loadSubjectsPanel } from "@/lib/panels/subjects";
import { loadSchoolDaysPanel } from "@/lib/panels/schoolDays";

/**
 * **팝업으로 여는 설정 화면의 자료 창구 — 한 자리입니다.**
 *
 * ── 왜 창구를 따로 두나 ─────────────────────────────────────────────────────
 *
 * 설정 화면(항목·과목·수업일)을 팝업으로 옮길 때, 부모 화면이 그 자료까지 미리 읽으면
 * **팝업을 한 번도 안 여는 사람도 그 조회를 매번 치릅니다.** 청구 명단은 하루에 수십 번
 * 열리고 항목 관리는 한 달에 몇 번인데, 열 때만 읽으면 그 차이만큼 그대로 아낍니다.
 *
 * ── 권한은 여기서 다시 봅니다 ───────────────────────────────────────────────
 *
 * 부모 화면이 열렸다는 것은 부모 화면의 권한을 통과했다는 뜻일 뿐입니다. 팝업 자료는
 * **자기 기준으로 다시** 확인합니다(그리고 표 자체의 RLS 가 마지막 자물쇠입니다 - 이
 * 라우트는 로그인한 사람의 세션으로 읽으므로 서비스 키의 무제한 권한을 쓰지 않습니다).
 */

export const dynamic = "force-dynamic";

type Panel = {
  /** 화면 가리기와 같은 기준. 어긋나면 「보이는데 자료가 안 온다」가 됩니다. */
  can: (me: NonNullable<CurrentAppUser>) => boolean;
  load: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<unknown>;
};

const PANELS: Record<string, Panel> = {
  "fee-items": { can: hasFinanceAccess, load: loadFeeItemsPanel },
  subjects: { can: isAdminUser, load: loadSubjectsPanel },
  "school-days": { can: isStaffOrAboveUser, load: loadSchoolDaysPanel },
};

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const panel = PANELS[kind];
  if (!panel) return NextResponse.json({ error: `모르는 설정 창입니다: ${kind}` }, { status: 404 });

  const me = await getCurrentAppUser();
  if (!me) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!panel.can(me)) return NextResponse.json({ error: "이 설정을 볼 권한이 없습니다." }, { status: 403 });

  const supabase = await createClient();
  try {
    const data = await panel.load(supabase);
    return NextResponse.json({ data, me: { email: me.email } });
  } catch (e) {
    // 조용히 빈 창을 띄우지 않습니다. 화면이 그대로 문장을 보여줍니다.
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[설정 창: ${kind}] 자료를 읽지 못했습니다:`, message);
    return NextResponse.json({ error: `자료를 읽지 못했습니다: ${message}` }, { status: 500 });
  }
}
