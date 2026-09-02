import { createClient } from "@/lib/supabase/server";
import type { Term } from "@/lib/types";
import TermsClient from "@/components/terms/TermsClient";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import StartTermPanel from "@/components/terms/StartTermPanel";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const supabase = await createClient();
  const [{ data }, me] = await Promise.all([
    supabase.from("terms").select("*").order("year", { ascending: false }).limit(200),
    getCurrentAppUser(),
  ]);

  return (
    <div className="p-4 sm:p-6">
      {/* 학기 전환. 학교 전체가 함께 움직이는 일이라 만드는 자리를 한 곳으로 모았습니다. */}
      <StartTermPanel
        current={((data as Term[]) ?? []).find((t) => t.status === "진행중") ?? null}
        isAdmin={!!me && isAdminUser(me)}
      />
      <TermsClient
      initialItems={(data as Term[]) ?? []}
      me={me ? { email: me.email, name: me.name || me.email } : null}
    />
    </div>  );
}
