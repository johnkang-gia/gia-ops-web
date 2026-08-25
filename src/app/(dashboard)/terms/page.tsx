import { createClient } from "@/lib/supabase/server";
import type { Term } from "@/lib/types";
import TermsClient from "@/components/terms/TermsClient";
import { getCurrentAppUser } from "@/lib/currentUser";
import SchoolTabs from "@/components/school/SchoolTabs";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const supabase = await createClient();
  const [{ data }, me] = await Promise.all([
    supabase.from("terms").select("*").order("year", { ascending: false }).limit(200),
    getCurrentAppUser(),
  ]);

  return (
    <div className="p-4 sm:p-6">
      <SchoolTabs />
      <TermsClient
      initialItems={(data as Term[]) ?? []}
      me={me ? { email: me.email, name: me.name || me.email } : null}
    />
    </div>  );
}
