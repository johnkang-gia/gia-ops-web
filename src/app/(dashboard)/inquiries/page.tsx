import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { Inquiry } from "@/lib/types";
import InquiriesClient from "@/components/inquiries/InquiriesClient";

export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isDeveloper = isDeveloperEmail(user?.email);

  const { data } = await supabase
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <InquiriesClient
      initialItems={(data as Inquiry[]) ?? []}
      isDeveloper={isDeveloper}
      currentUserEmail={user?.email ?? ""}
    />
  );
}
