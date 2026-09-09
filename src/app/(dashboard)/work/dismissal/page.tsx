import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMissingWeekStart } from "@/lib/dismissalToday";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import GuideButton from "@/components/common/GuideButton";
import { markIfAmbiguous, toKoreanDisplayName, toRosterEntries, ROSTER_SELECT } from "@/lib/pickupParse";
import DismissalBulkClient, { type InquiryLite, type PlanRow, type RideLite, type StudentLite } from "@/components/work/DismissalBulkClient";

export const dynamic = "force-dynamic";

// DB에서 받은 그대로의 모양. 화면이 쓰는 모양으로는 아래에서 한 번에 옮깁니다 -
// 두 모양을 섞어 쓰면 «이 값이 어느 쪽 이름이더라»가 됩니다.
type RawInquiry = {
  id: string;
  kind: string | null;
  matched_name: string | null;
  ai_student_name: string | null;
  channel_label: string | null;
  summary: string | null;
  raw_text: string | null;
  received_at: string;
  source_url: string | null;
  is_demo: boolean | null;
};

// 조인해서 받은 셔틀 배정 한 줄. 정류장 → 노선까지 따라갑니다.
type RawRide = {
  student_id: string | null;
  student_name_raw: string;
  weekdays: number[] | null;
  shuttle_stops: { name: string | null; shuttle_routes: { name: string | null } | null } | null;
};

const GUIDE_SECTIONS = [
  {
    title: "🎒 하원수단이란?",
    lines: [
      "요일마다 아이가 어떻게 집에 가는지입니다. 셔틀 · 학원차 · 보호자픽업 · 도보 · 기타.",
      "셔틀을 타지 않는 날은 하원 체크표에 줄이 아예 없어서, 여기 적어두지 않으면 어디에도 남지 않습니다.",
      "여기 적어두면 오늘 요일 것이 중앙 대시보드와 업무보드 [출결내역] 위에 저절로 뜹니다.",
    ],
  },
  {
    title: "한 번에 넣기",
    lines: [
      "형제자매처럼 같은 차를 타는 아이는 함께 골라 한 번에 넣습니다.",
      "요일도 여러 개 고를 수 있습니다 - 월·금 같은 학원차는 두 요일을 함께 찍으면 끝납니다.",
      "이미 넣어둔 요일이 있으면 덮어씁니다. 한 아이의 한 요일에는 하원수단이 하나뿐입니다.",
    ],
  },
];

export default async function DismissalBulkPage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  // 담임도 학부모에게 직접 듣는 경우가 많아 고칠 수 있어야 합니다. 행정실을 거쳐야만
  // 고칠 수 있으면 결국 아무도 안 고쳐서 낡은 값이 남습니다.
  if (!isStaffOrAboveUser(me)) redirect("/");

  // 학부모 연락과 셔틀 배정을 **읽기만** 해서 함께 보여줍니다. 넣을 때 «누구였더라»를 보려고
  // 업무보드나 셔틀로 돌아가야 했는데, 그 왕복이 곧 «나중에 하자»가 됩니다.
  // 새 자료를 만들지 않습니다 - 저 두 곳이 원본이고 여기는 창문일 뿐입니다.
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: students }, plansRes, { data: inquiries }, { data: rides }] = await Promise.all([
    supabase
      .from("wr_students")
      .select(ROSTER_SELECT)
      .eq("status", "active")
      .eq("is_demo", false)
      .order("grade")
      .order("class_name")
      .order("name"),
    supabase.from("student_dismissal_plans").select("id, student_id, weekday, kind, label, depart_time, note, week_start"),
    // 최근 2주 학부모 연락. 원문(raw_text)까지 가져와야 «몇 시 무슨 차»가 읽힙니다 -
    // 요약만으로는 시각이 잘려 있는 경우가 있습니다.
    supabase
      .from("pickup_requests")
      .select("id, kind, matched_name, ai_student_name, channel_label, summary, raw_text, received_at, source_url, is_demo")
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(80),
    // 셔틀 배정(요일·호차). 셔틀을 타는 날을 «외부버스»로 덮어쓰는 실수를 막습니다.
    supabase
      .from("shuttle_assignments")
      .select("student_id, student_name_raw, weekdays, stop_id, shuttle_stops(name, shuttle_routes(name))"),
  ]);

  // week_start 가 아직 없으면(마이그레이션 전) **있는 칸만으로 다시 읽습니다.** 없는 칸 하나
  // 때문에 이 화면이 통째로 비면, 하원수단을 고칠 자리 자체가 사라집니다.
  let plans = plansRes.data as { id: string; student_id: string; weekday: number }[] | null;
  if (isMissingWeekStart(plansRes.error)) {
    const retry = await supabase
      .from("student_dismissal_plans")
      .select("id, student_id, weekday, kind, label, depart_time, note");
    plans = retry.data as typeof plans;
  } else if (plansRes.error) {
    console.error("[하원수단] 목록을 읽지 못했습니다:", plansRes.error.message);
  }

  // 동명이인을 가르는 재료(생일·반)까지 들어 있는 명부. 한 곳에서 만듭니다.
  const nameRoster = toRosterEntries(students);

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🎒 하원수단</h1>
        <GuideButton title="하원수단 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        요일마다 아이가 어떻게 집에 가는지 적습니다. <b>셔틀을 타지 않는 날</b>은 하원 체크표에 줄이 없어서, 여기
        적어두지 않으면 어디에도 남지 않습니다. 넣어두면 오늘 요일 것이 중앙 대시보드와 업무보드 [출결내역] 위에
        저절로 뜹니다.
      </p>

      <DismissalBulkClient
        students={((students as StudentLite[] | null) ?? [])}
        initialPlans={((plans as PlanRow[] | null) ?? [])}
        inquiries={
          ((inquiries as RawInquiry[] | null) ?? [])
            .filter((r) => !r.is_demo)
            .map(
              (r): InquiryLite => ({
                id: r.id,
                kind: r.kind ?? "문의",
                // 이름만 띄우면 보는 사람은 **이미 정해진 이름이라고 믿습니다.** 김재이가
                // 셋이라, 그 상태로 하원수단을 고치면 엉뚱한 아이 것이 바뀝니다.
                name:
                  markIfAmbiguous(
                    toKoreanDisplayName(
                      r.matched_name ?? r.ai_student_name,
                      r.channel_label,
                      nameRoster,
                      `${r.summary ?? ""} ${r.raw_text ?? ""}`,
                    ),
                    nameRoster,
                  ) ??
                  r.channel_label ??
                  "미확인",
                summary: r.summary,
                raw: r.raw_text,
                at: r.received_at,
                url: r.source_url,
              })
            )
        }
        rides={
          ((rides as unknown as RawRide[] | null) ?? []).map(
            (a): RideLite => ({
              studentId: a.student_id,
              nameRaw: a.student_name_raw,
              weekdays: a.weekdays ?? [],
              route: a.shuttle_stops?.shuttle_routes?.name ?? null,
              stop: a.shuttle_stops?.name ?? null,
            })
          )
        }
      />
    </div>
  );
}
