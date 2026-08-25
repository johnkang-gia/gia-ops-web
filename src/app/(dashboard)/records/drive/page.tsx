import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isTeacherOnly } from "@/lib/roles";
import RecordsDriveClient, { type DriveItem } from "@/components/work/RecordsDriveClient";

export const dynamic = "force-dynamic";

// 기록 드라이브(요청 ④): 사건·회의·행사 기록을 드라이브처럼 연 → 월로 내려가며 탐색하고,
// 검색어로 한 번에 찾는 화면. 등록사건목록(/ops)이 "최근 훑어보기"라면 여기는 "옛날 것 찾기".
export default async function RecordsDrivePage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (isTeacherOnly(me)) redirect("/weekly-report");
  const supabase = await createClient();

  const [{ data: incidents }, { data: meetings }, { data: events }] = await Promise.all([
    supabase.from("incidents").select("case_id, title, detail, date").order("date", { ascending: false }).limit(2000),
    supabase.from("meetings").select("case_id, content, date").order("date", { ascending: false }).limit(2000),
    supabase.from("events").select("case_id, name, good, date").order("date", { ascending: false }).limit(2000),
  ]);

  const items: DriveItem[] = [
    ...((incidents ?? []).map((r) => ({
      kind: "사건" as const,
      caseId: r.case_id as string,
      date: (r.date as string) ?? "",
      title: (r.title as string) || "(제목 없음)",
      body: (r.detail as string | null) ?? "",
      href: "/records",
    })) ?? []),
    ...((meetings ?? []).map((r) => ({
      kind: "회의" as const,
      caseId: r.case_id as string,
      date: (r.date as string) ?? "",
      title: ((r.content as string) ?? "").slice(0, 60) || "(내용 없음)",
      body: (r.content as string | null) ?? "",
      href: "/meetings",
    })) ?? []),
    ...((events ?? []).map((r) => ({
      kind: "행사" as const,
      caseId: r.case_id as string,
      date: (r.date as string) ?? "",
      title: (r.name as string) || "(이름 없음)",
      body: (r.good as string | null) ?? "",
      href: "/events",
    })) ?? []),
  ].filter((x) => x.date);

  return <RecordsDriveClient items={items} />;
}
