import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { Inquiry } from "@/lib/types";
import InquiriesClient from "@/components/inquiries/InquiriesClient";

export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  const isDeveloper = isDeveloperEmail(me?.email);

  const { data } = await supabase
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <InquiriesClient
      initialItems={(data as Inquiry[]) ?? []}
      isDeveloper={isDeveloper}
      currentUserEmail={me?.email ?? ""}
    />
  );
}
