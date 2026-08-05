import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import type { Inquiry } from "@/lib/types";
import InquiriesClient from "@/components/inquiries/InquiriesClient";

export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  // 미리보기 중에는(요청: "권한별로... 보아서는 안되는 것을 보고 있지는 않은지") 개발자만
  // 보이는 "전체 문의" 목록이 아니라 실제 그 직위가 보는 "내가 남긴 문의"만 보여야 합니다.
  const isDeveloper = isDeveloperEmail(me?.email) && !me?.previewOf;

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
