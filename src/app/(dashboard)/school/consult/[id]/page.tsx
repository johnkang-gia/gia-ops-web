import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser, isStaffOrAboveUser } from "@/lib/roles";
import { loadConsultState } from "@/lib/consult/server";
import { loadStudents } from "@/lib/students";
import ConsultEventClient, { type ClassOption, type StaffOption } from "@/components/consult/ConsultEventClient";

export const dynamic = "force-dynamic";

/** 상담 행사 하나 — 안내데스크·명단·상담실·설정·기록. */
export default async function ConsultEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect(`/consult?event=${id}`);

  const supabase = await createClient();
  const { state, error } = await loadConsultState(supabase, id, { phones: true });
  if (!state) {
    return <p className="m-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">상담 행사를 열지 못했습니다: {error}</p>;
  }

  // 명단에 넣을 아이들은 **명부에서** 고릅니다(이름을 손으로 적지 않습니다).
  const [stuRes, clsRes, staffRes] = await Promise.all([
    loadStudents(supabase, { demo: state.event.is_demo, order: "grade" }),
    supabase.from("wr_classes").select("id, grade, class_name, teacher_email").eq("is_demo", state.event.is_demo),
    supabase.from("app_users").select("email, name, position").eq("status", "approved").order("name"),
  ]);
  if (stuRes.error) console.error("[학부모 상담] 명부를 읽지 못했습니다:", stuRes.error);
  if (clsRes.error) console.error("[학부모 상담] 반을 읽지 못했습니다:", clsRes.error.message);
  if (staffRes.error) console.error("[학부모 상담] 교직원을 읽지 못했습니다:", staffRes.error.message);

  return (
    <ConsultEventClient
      initial={state}
      allStudents={stuRes.rows}
      classes={(clsRes.data as ClassOption[] | null) ?? []}
      staff={((staffRes.data as StaffOption[] | null) ?? []).filter((s) => s.name)}
      isAdmin={isAdminUser(me)}
    />
  );
}
