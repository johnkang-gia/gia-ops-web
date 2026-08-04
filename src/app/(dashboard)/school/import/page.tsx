import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import SchoolImportClient from "@/components/school/SchoolImportClient";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📥 구글시트로 가져오기란?",
    lines: [
      "기존 구글시트의 교직원 명단·반 구성(담임/부담임)·학생 명부를 CSV 붙여넣기로 한 번에 시스템에 반영합니다.",
      "구글시트에서 표를 CSV로 다운로드하거나 셀 범위를 그대로 복사해 붙여넣으면 됩니다.",
    ],
  },
  {
    title: "⚠️ 주의",
    lines: ["관리자 전용 화면입니다. 기존 데이터와 겹치는 항목은 갱신되므로, 처음 세팅 또는 일괄 갱신 시에만 사용하세요."],
  },
];

export const dynamic = "force-dynamic";

// 구글시트를 계속 쓰시는 경우가 많다는 요청으로 만든 화면입니다. 구글시트에서 각 표를 CSV로
// 다운로드하거나(File > 다운로드 > 쉼표로 구분된 값(.csv)) 표 범위를 그대로 복사해서 붙여넣으면
// 교직원/반(담임·부담임)/학생 정보를 한 번에 시스템에 반영할 수 있습니다. 관리자만 접근 가능합니다.
export default async function SchoolImportPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const isAdmin = isDeveloperEmail(me.email) || me.position === "관리자";
  if (!isAdmin) redirect("/school");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">📥 구글시트로 학교정보 가져오기</h1>
        <GuideButton title="구글시트로 학교정보 가져오기 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-xs text-slate-500">
        구글시트에서 표를 CSV로 다운로드하거나 셀 범위를 그대로 복사해서 붙여넣으면, 교직원 명단·반
        구성(담임/부담임)·학생 명부를 한 번에 시스템에 반영합니다.
      </p>
      <SchoolImportClient adminEmail={me.email} />
    </div>
  );
}
