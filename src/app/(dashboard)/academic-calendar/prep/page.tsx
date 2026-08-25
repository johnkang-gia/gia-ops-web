import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { getCurrentTerm } from "@/lib/currentTerm";
import { TERM_TYPES } from "@/lib/termTypes";
import TermPrepClient from "@/components/academic/TermPrepClient";
import GuideButton from "@/components/common/GuideButton";
import SchoolTabs from "@/components/school/SchoolTabs";

const GUIDE_SECTIONS = [
  {
    title: "🧭 학기준비란?",
    lines: [
      "연도와 학기(또는 캠프)를 고르면, 같은 학기 유형의 지난 회차 기록 - 학기 돌아보기(잘한점/아쉬운점/제안), 그때 올렸던 신청서(구글폼) 기록, 그 준비 기간에 있었던 업무·회의 - 를 한 번에 모아서 보여줍니다.",
      "다음 같은 학기를 준비할 때 지난 회차를 그대로 참고할 수 있도록 만든 화면입니다(요청: \"이전학기 준비사항들을 참고하여 다음 같은 학기를 준비할 수 있도록\").",
    ],
  },
  {
    title: "📅 학사일정달력과 다른 점",
    lines: ["학사일정달력은 지금 진행중인 학기의 체크리스트를 보는 화면이고, 학기준비는 연도를 넘나들며 지난 같은 학기의 기록을 찾아보는 화면입니다."],
  },
];

export const dynamic = "force-dynamic";

// "학기준비" - 요청("학기준비의 경우 년도와 학기를 선택하면(예를들어 27년 1학기) 이전 학기 때
// 넣었던 구글폼이나, 몇일전에 어떤 준비를 했는지 기록상황을 바로 보고, 이전학기 준비사항들을
// 참고하여, 다음 같은 학기를 준비할 수 있도록"). 실제 데이터 조회는 연도/학기 선택에 따라
// 매번 바뀌므로 클라이언트 컴포넌트(TermPrepClient)에서 처리하고, 이 서버 페이지는 로그인
// 확인과 "다음에 준비할 만한 학기"의 기본값만 계산해서 넘겨줍니다.
export default async function AcademicPrepPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const currentTerm = await getCurrentTerm();
  const defaultTermType = currentTerm?.term_type ?? TERM_TYPES[0];
  const defaultYear = currentTerm ? String(Number(currentTerm.year) + 1 || new Date().getFullYear() + 1) : String(new Date().getFullYear() + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <SchoolTabs />
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🧭 학기준비</h1>
        <GuideButton title="학기준비 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        연도와 학기(또는 캠프)를 선택하면 지난 같은 학기의 돌아보기 기록·신청서(구글폼) 기록·준비 과정 업무/회의를 모아서 보여줍니다.
      </p>
      <TermPrepClient defaultYear={defaultYear} defaultTermType={defaultTermType} />
    </div>
  );
}
