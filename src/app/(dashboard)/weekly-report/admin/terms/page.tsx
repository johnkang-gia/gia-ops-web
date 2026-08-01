import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import type { WrTerm } from "@/lib/types";
import TermManageClient from "@/components/weeklyReport/admin/TermManageClient";

export const dynamic = "force-dynamic";

export default async function TermManagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const email = (user.email ?? "").toLowerCase();
  if (!isDeveloperEmail(email)) {
    const { data: me } = await supabase.from("app_users").select("position").eq("email", email).maybeSingle();
    if (me?.position !== "관리자") redirect("/weekly-report");
  }

  const { data } = await supabase.from("wr_terms").select("*").order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-lg font-bold">학기 관리</h1>
      <p className="mb-4 text-xs text-slate-500">활성 학기는 한 번에 하나만 유지됩니다. 리포트는 항상 활성 학기 기준으로 작성됩니다.</p>
      <TermManageClient initialTerms={(data as WrTerm[] | null) ?? []} />
    </div>
  );
}
