import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { EVENT_COLUMNS } from "@/lib/consult/server";
import type { ConsultEvent } from "@/lib/consult/model";
import ConsultEventsClient from "@/components/consult/ConsultEventsClient";

export const dynamic = "force-dynamic";

/**
 * 학부모 상담 — 행사 목록.
 *
 * 1학기·2학기·수시 상담이 행사마다 따로 남습니다. 구글시트판은 새 상담을 하려면 명단을 지우고
 * 다시 채워야 해서 지난 상담 기록이 남지 않았습니다.
 */
export default async function ConsultEventsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 선생님은 면담 화면으로 바로 갑니다 - 행사를 만들고 명단을 넣는 것은 행정실의 일입니다.
  if (!isStaffOrAboveUser(me)) redirect("/consult");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("consult_events")
    .select(EVENT_COLUMNS)
    .eq("is_demo", isDemoAccount(me.email))
    .order("event_date", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });

  // 표가 아직 없어도(마이그레이션 전) 화면은 열고, 이유를 그대로 보여줍니다.
  const { data: counts } = await supabase.from("consult_appointments").select("event_id, status");
  const byEvent: Record<string, { total: number; done: number }> = {};
  for (const r of (counts ?? []) as { event_id: string; status: string }[]) {
    const b = (byEvent[r.event_id] ??= { total: 0, done: 0 });
    if (r.status !== "취소") b.total += 1;
    if (r.status === "완료" || r.status === "전화상담") b.done += 1;
  }

  return (
    <ConsultEventsClient
      events={(data as unknown as ConsultEvent[] | null) ?? []}
      counts={byEvent}
      loadError={error?.message ?? null}
    />
  );
}
