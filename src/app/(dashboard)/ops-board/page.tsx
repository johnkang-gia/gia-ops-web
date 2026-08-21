import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isAdminUser } from "@/lib/roles";
import type { WrClass, WrPeriod, WrTimetableEntry, OpsBoardLink } from "@/lib/types";
import TimetableManager from "@/components/opsBoard/TimetableManager";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🖥️ 운영 대시보드란?",
    lines: [
      "사무실 큰 모니터에 띄워두는 화면입니다(요청: \"업무 탭을 사무실 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할 수 있는 통합 대시보드\"). 화면 절반은 CCTV, 나머지 절반에 이 대시보드를 띄우는 구성을 전제로 만들었습니다.",
      "지금 각 반이 무슨 수업 중인지, 오늘 결석·지각·픽업 학생이 누구인지, 오늘 마감이거나 새로 등록된 업무가 무엇인지를 한 화면에 보여주고 30초마다 자동으로 갱신됩니다.",
      "설정한 시각(기본 16:00)이 되면 화면 전체가 하원 운행 화면으로 자동 전환됩니다. 위쪽에는 전체 셔틀 실시간 지도, 아래쪽에는 노선별 도착·출발과 탑승 진행 현황이 뜹니다.",
      "이때 화면이 전체화면으로 커져 옆의 CCTV를 덮습니다(요청: \"하원시간에는 전체화면으로 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시 화면 되돌리게\"). 종료 시각(기본 17:30)이 되거나 화면 오른쪽 위 [하원 종료]를 누르면 전체화면이 풀리고 원래 반반 배치로 돌아옵니다.",
      "⚠️ 전체화면으로 들어가는 것만은 브라우저 규칙상 사람이 한 번 눌러야 합니다(아무 사이트나 마음대로 화면을 덮지 못하게 하는 안전장치입니다). 하원 시각이 되면 오른쪽 아래에 [전체화면] 버튼이 뜨니 하루 한 번 눌러주세요. 되돌아오는 것은 제약이 없어 저절로 됩니다. 매일 누르는 것도 번거로우시면, 이 PC의 크롬에 자동 전체화면 허용 정책을 걸어드릴 수 있으니 말씀해주세요.",
      "로그인 없이 주소만으로 열리므로 하루 종일 켜두어도 세션이 풀리지 않습니다.",
      "짧은 주소(요청: \"다른곳에서 바로 주소만쳐서 들어갈 수 있게\")를 함께 만듭니다. 아래 링크 목록의 [/d/] 칸에 적힌 네 글자를 주소창에 \"우리주소/d/코드\" 형태로 치면 바로 열립니다. 36자리 토큰을 옮겨 적을 필요가 없고, 원하는 이름(office 등)으로 바꿔도 됩니다.",
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
  // 관리자·개발자만(요청: "운영 대시 보드는 관리자,개발자만 보이도록 해줘"). 이 화면은 로그인
  // 없이 열리는 대시보드 주소를 만들어내는 곳이라, 주소가 새어나가면 누구나 학생 결석 명단과
  // 업무 현황을 볼 수 있게 됩니다. isAdminUser()는 개발자 계정을 항상 포함합니다.
  if (!isAdminUser(me)) redirect("/home");

  const supabase = await createClient();
  const [classesRes, periodsRes, entriesRes, linksRes] = await Promise.all([
    supabase.from("wr_classes").select("*").order("grade").order("class_name"),
    supabase.from("wr_periods").select("*").order("start_time"),
    supabase.from("wr_timetable").select("*"),
    supabase.from("ops_board_links").select("*").order("created_at", { ascending: false }),
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
      />
    </div>
  );
}
