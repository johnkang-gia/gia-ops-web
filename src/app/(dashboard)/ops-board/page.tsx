import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import type { WrClass, WrPeriod, WrTimetableEntry, OpsBoardLink, ShuttleBoardLink } from "@/lib/types";
import TimetableManager from "@/components/opsBoard/TimetableManager";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🖥️ 운영 대시보드란?",
    lines: [
      "사무실 큰 모니터에 띄워두는 화면입니다(요청: \"업무 탭을 사무실 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드\"). 화면 절반은 CCTV, 나머지 절반에 이 대시보드를 띄우는 구성을 전제로 만들었습니다.",
      "지금 각 반이 무슨 수업 중인지, 오늘 결석·지각·픽업 학생이 누구인지, 오늘 마감이거나 새로 등록된 업무가 무엇인지를 한 화면에 보여주고 30초마다 자동으로 갱신됩니다.",
      "설정한 시각(기본 16:00)이 되면 화면 전체가 하원 차량 안내보드로 자동 전환됩니다. 전환할 안내보드는 아래 링크 목록에서 골라주세요.",
      "로그인 없이 주소만으로 열리므로 하루 종일 켜두어도 세션이 풀리지 않습니다.",
    ],
  },
  {
    title: "⏰ 교시와 시간표",
    lines: [
      "\"지금 몇 교시\"를 판단하려면 교시별 시작·종료 시각이 필요합니다. 부서(유치부/초등부/중고등부)마다 따로 설정합니다.",
      "교시를 넣은 뒤 아래 표에서 반×교시 칸에 과목명을 적으면 됩니다. 요일별로 따로 저장되니 요일 버튼을 바꿔가며 채워주세요.",
      "칸을 비우고 다른 곳을 누르면 그 칸이 지워집니다.",
    ],
  },
];

export const dynamic = "force-dynamic";

export default async function OpsBoardAdminPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");

  const supabase = await createClient();
  const [classesRes, periodsRes, entriesRes, linksRes, shuttleLinksRes] = await Promise.all([
    supabase.from("wr_classes").select("*").order("grade").order("class_name"),
    supabase.from("wr_periods").select("*").order("start_time"),
    supabase.from("wr_timetable").select("*"),
    supabase.from("ops_board_links").select("*").order("created_at", { ascending: false }),
    supabase.from("shuttle_board_links").select("*").eq("enabled", true).order("created_at", { ascending: false }),
  ]);

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🖥️ 운영 대시보드 · 시간표 관리</h1>
        <GuideButton title="운영 대시보드 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        사무실 대형 모니터용 대시보드 링크를 만들고, 대시보드가 보여줄 교시·시간표를 여기서 입력합니다.
      </p>
      <TimetableManager
        classes={(classesRes.data as WrClass[] | null) ?? []}
        initialPeriods={(periodsRes.data as WrPeriod[] | null) ?? []}
        initialEntries={(entriesRes.data as WrTimetableEntry[] | null) ?? []}
        initialBoardLinks={(linksRes.data as OpsBoardLink[] | null) ?? []}
        shuttleBoardLinks={(shuttleLinksRes.data as ShuttleBoardLink[] | null) ?? []}
      />
    </div>
  );
}
