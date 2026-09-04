import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { ShuttleRoute, ShuttleStop, WrStudent, WrStudentFieldDef } from "@/lib/types";
import StudentManageClient from "@/components/weeklyReport/admin/StudentManageClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🎓 학생 명부 관리란?",
    lines: [
      "재학생을 등록·수정·재학상태 관리합니다. 여기서 등록한 학생은 반 배정과 과목반 세팅에서 바로 선택할 수 있습니다.",
      "학년 → 반 → 이름(가나다) 순으로 기본 정렬되고, 칼럼 제목을 클릭하면 구글시트처럼 그 칼럼 기준으로 다시 정렬됩니다.",
      "기본 항목 외에 필요한 항목이 있으면 [+ 칼럼 추가]로 원하는 이름의 칼럼을 직접 만들어 쓸 수 있습니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function StudentManagePage() {
  const supabase = await createClient();
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  /**
   * 명부는 **교직원 모두가 봅니다.** 고치는 것만 행정직원 이상입니다.
   *
   * 예전에는 관리자가 아니면 여기서 주간 관찰기록으로 되돌렸습니다. 그래서 담임이 명부를
   * 누르면 엉뚱한 화면이 떴고, 왜 그런지도 알 수 없었습니다. 담임은 자기 반 아이의 학년·
   * 생일·알레르기·셔틀을 늘 봐야 하는데, 못 보게 막으면 결국 종이 명단을 따로 들고 다닙니다.
   */
  const canEdit = isStaffOrAboveUser(me);

  /**
   * 고칠 수 있는 사람은 원본 표를, 나머지는 공용 뷰를 읽습니다.
   *
   * 공용 뷰에는 **보호자 연락처가 아예 없습니다.** 화면에서만 가리면 주소창을 직접 치거나
   * API 를 부르는 것으로 뚫립니다 - 뷰에 없어야 못 봅니다.
   */
  const [{ data: studentsData }, { data: fieldDefsData }, { data: routesData }, { data: stopsData }] = await Promise.all([
    supabase
      .from(canEdit ? "wr_students" : "wr_students_basic")
      .select("*")
      .eq("is_demo", false)
      .order("grade", { ascending: true })
      .order("class_name", { ascending: true })
      .order("name", { ascending: true }),
    supabase.from("wr_student_field_defs").select("*").order("sort_order", { ascending: true }),
    supabase.from("shuttle_routes").select("*").eq("active", true),
    supabase.from("shuttle_stops").select("*"),
  ]);

  return (
    // 요청("학생명부관리 스크롤이 안돼")의 원인은 이 감싸는 div에 h-full/flex 구조가 없어서
    // 안쪽 표의 overflow-auto가 기준으로 삼을 높이가 없었던 것입니다(/students 검색 화면과
    // 같은 구조로 맞췄습니다) - 이제 표 영역만 화면 높이에 맞춰 자체적으로 스크롤됩니다.
    <div className="mx-auto flex h-full w-full max-w-none flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">학생 명부 관리</h1>
          <GuideButton title="학생 명부 관리 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          {canEdit
            ? "학생을 등록하면 반 배정(반/담임 배정 관리)과 과목 배정(과목반 세팅)에서 바로 선택할 수 있습니다."
            : "명부는 교직원 모두가 봅니다. 고치는 것은 행정직원 이상이고, 보호자 연락처는 보이지 않습니다."}
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <StudentManageClient
          initialStudents={(studentsData as WrStudent[] | null) ?? []}
          initialFieldDefs={(fieldDefsData as WrStudentFieldDef[] | null) ?? []}
          currentUserEmail={me.email}
          canEdit={canEdit}
          shuttleRoutes={(routesData as ShuttleRoute[] | null) ?? []}
          shuttleStops={(stopsData as ShuttleStop[] | null) ?? []}
        />
      </div>
    </div>
  );
}
