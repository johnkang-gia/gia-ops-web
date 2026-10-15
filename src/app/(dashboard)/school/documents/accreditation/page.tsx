import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isStaffOrAboveUser } from "@/lib/roles";
import AccreditationHub from "@/components/accreditation/AccreditationHub";
import GuideButton from "@/components/common/GuideButton";

export const dynamic = "force-dynamic";

const GUIDE_SECTIONS = [
  {
    title: "📑 인증 자료란?",
    lines: [
      "Ai/MSA-CESS 재평가(11월 6~7일)에 낼 증거를 앱 기록에서 영문으로 뽑는 곳입니다. 마감은 10월 30일(드라이브 공유)입니다.",
      "숫자는 앱 화면과 같은 계산으로 냅니다(출석률은 출석현황, 셔틀은 셔틀 화면과 같은 함수). 종이와 화면의 숫자가 다르면 설명할 수 없기 때문입니다.",
      "학생 이름·연락처는 담지 않습니다. 외부 기관과 드라이브로 공유되는 자료입니다.",
      "뽑기 전에 개발자 › 진단의 빨간 줄(반 미배정·생일 없음 등)을 먼저 비우면 숫자가 정확해집니다.",
    ],
  },
];

export default async function AccreditationPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");
  if (!isStaffOrAboveUser(me)) redirect("/home");
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">🏅 인증 자료 (Ai / MSA-CESS)</h1>
        <GuideButton title="인증 자료 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">재평가 방문 2026년 11월 6~7일 · 자료 공유 마감 10월 30일(금)</p>
      <AccreditationHub />
    </div>
  );
}
