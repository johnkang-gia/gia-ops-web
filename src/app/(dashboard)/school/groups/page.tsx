import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import { isDemoAccount } from "@/lib/sharedAccounts";
import { gradeSortKey } from "@/lib/department";
import type { StudentGroup, Term } from "@/lib/types";
import GroupsClient, { type GroupStudent } from "@/components/school/GroupsClient";

export const dynamic = "force-dynamic";

// 수강 그룹 — 반이 아닌 명단.
//
// 학년·반은 어느 교실에 앉는가이고, 방과후·악기는 무엇을 하는가입니다. 지금 명부에는
// `afterschool` 이 예/아니오로만 있어서 **무엇을 하는지는 어디에도 없었습니다.**

export default async function StudentGroupsPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 담임은 읽을 수 있지만 고치는 것은 행정실만입니다 - 명단이 바뀌면 청구도 함께 바뀝니다.
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [groupRes, memberRes, stuRes, termRes] = await Promise.all([
    supabase.from("student_groups").select("*").eq("is_demo", isDemoAccount(me.email)).order("kind").order("name"),
    supabase.from("student_group_members").select("group_id, student_id"),
    supabase
      .from("wr_students_basic")
      .select("id, name, name_en, grade, class_name, department")
      .eq("is_demo", isDemoAccount(me.email))
      .eq("status", "active")
      .order("name"),
    supabase.from("terms").select("*").order("status").order("start_date", { ascending: false, nullsFirst: false }),
  ]);

  // 표가 아직 없어도(마이그레이션 전) 화면은 열려야 합니다. 그때는 "아직 그룹이 없습니다" 로
  // 뜹니다 - 화면이 통째로 안 열리는 것보다 낫습니다.
  if (groupRes.error) console.error("[수강 그룹] 그룹을 읽지 못했습니다:", groupRes.error.message);
  if (memberRes.error) console.error("[수강 그룹] 명단을 읽지 못했습니다:", memberRes.error.message);

  const students = ((stuRes.data as { id: string; name: string; name_en: string | null; grade: string | null; class_name: string | null; department: string | null }[] | null) ?? [])
    .map<GroupStudent>((s) => ({
      id: s.id,
      name: s.name,
      nameEn: s.name_en,
      grade: s.grade,
      className: s.class_name,
      department: s.department,
    }))
    .sort((a, b) => gradeSortKey(a.grade ?? "") - gradeSortKey(b.grade ?? "") || (a.className ?? "").localeCompare(b.className ?? "", "ko") || a.name.localeCompare(b.name, "ko"));

  const members: Record<string, string[]> = {};
  for (const m of ((memberRes.data as { group_id: string; student_id: string }[] | null) ?? [])) {
    (members[m.group_id] ??= []).push(m.student_id);
  }

  return (
    <GroupsClient
      initialGroups={(groupRes.data as StudentGroup[] | null) ?? []}
      initialMembers={members}
      students={students}
      terms={(termRes.data as Term[] | null) ?? []}
      currentUserEmail={me.email}
      isDemo={isDemoAccount(me.email)}
      loadError={groupRes.error?.message ?? null}
    />
  );
}
