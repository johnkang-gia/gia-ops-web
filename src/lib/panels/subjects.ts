import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMember, WrClass, WrStudent, WrSubject } from "@/lib/types";

/** 과목반 세팅이 쓰는 자료. 자기 주소와 [반/담임] 팝업 두 자리가 **같은 것**을 읽습니다. */

export type SubjectsPanel = {
  initialSubjects: WrSubject[];
  team: TeamMember[];
  classes: WrClass[];
  students: WrStudent[];
  loadError: string | null;
};

export async function loadSubjectsPanel(supabase: SupabaseClient): Promise<SubjectsPanel> {
  const [subRes, teamRes, clsRes, stuRes] = await Promise.all([
    supabase.from("wr_subjects").select("*").order("name", { ascending: true }),
    supabase.from("app_users").select("email, name").eq("status", "approved").order("email", { ascending: true }),
    supabase.from("wr_classes").select("*").eq("is_demo", false).order("grade", { ascending: true }),
    supabase
      .from("wr_students")
      .select("*")
      .eq("is_demo", false)
      .eq("status", "active")
      .order("grade", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  return {
    initialSubjects: (subRes.data as WrSubject[] | null) ?? [],
    team: (teamRes.data as TeamMember[] | null) ?? [],
    classes: (clsRes.data as WrClass[] | null) ?? [],
    students: (stuRes.data as WrStudent[] | null) ?? [],
    // 조용히 빈 화면을 띄우지 않습니다 - 「과목이 하나도 없네」와 「못 읽었네」는 다른 말입니다.
    loadError: subRes.error?.message ?? teamRes.error?.message ?? clsRes.error?.message ?? stuRes.error?.message ?? null,
  };
}
