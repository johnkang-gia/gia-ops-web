import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { EVENT_COLUMNS, loadConsultState } from "@/lib/consult/server";
import type { ConsultEvent } from "@/lib/consult/model";
import ConsultRoomClient from "@/components/consult/ConsultRoomClient";

export const dynamic = "force-dynamic";

/**
 * 면담 화면 — 선생님이 자기 상담실에서 쓰는 화면(행정실도 방마다 열어 볼 수 있습니다).
 *
 * 상담실의 선생님 계정으로 «내 방»을 찾습니다. 진행 중인 행사가 하나면 바로 그 행사, 여럿이면
 * 고르게 합니다. 학부모 전화번호는 이 화면에 싣지 않습니다(필요하면 안내데스크가 겁니다).
 */
export default async function ConsultRoomPage({ searchParams }: { searchParams: Promise<{ event?: string; room?: string }> }) {
  const sp = await searchParams;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  const staff = isStaffOrAboveUser(me);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consult_events")
    .select(EVENT_COLUMNS)
    .eq("is_demo", isDemoAccount(me.email))
    .neq("status", "종료")
    .order("event_date", { ascending: false, nullsFirst: true });
  const events = (data as unknown as ConsultEvent[] | null) ?? [];

  const chosen = events.find((e) => e.id === sp.event) ?? events.find((e) => e.status === "진행") ?? events[0] ?? null;
  const { state, error: stErr } = chosen ? await loadConsultState(supabase, chosen.id, { phones: false }) : { state: null, error: null };

  return (
    <ConsultRoomClient
      events={events}
      initial={state}
      initialRoom={sp.room ?? null}
      myEmail={me.email}
      staff={staff}
      loadError={error?.message ?? stErr ?? null}
    />
  );
}
