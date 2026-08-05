import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import AccountSettingsForm from "@/components/account/AccountSettingsForm";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "👤 내 계정 설정이란?",
    lines: [
      "내 이름과 프로필 사진을 바꿀 수 있습니다. 바꾸면 사이드바 상단과 내가 작성하는 기록의 작성자 표시에 바로 반영됩니다.",
    ],
  },
  {
    title: "🏷️ 직위(권한) 뱃지",
    lines: ["자유 입력이 아니라 실제 권한 체계(교사/행정직원/관리자)를 그대로 보여주는 읽기 전용 표시입니다. 값 변경은 관리자만 가능합니다."],
  },
];

export const dynamic = "force-dynamic";

// 내 계정 설정 - 프로필 사진/이름을 스스로 바꿀 수 있는 화면입니다. 직위(권한) 뱃지는 여기서
// 자유롭게 정하는 값이 아니라 우리 시스템의 실제 권한 체계(교사/행정직원/관리자/개발자)를 그대로
// 보여주는 읽기 전용 표시입니다 - 실제 값을 바꾸는 건 관리자만 [학교관리 > 사용자 관리]에서
// 승인 시점 또는 그 이후에 할 수 있습니다(권한 상승 방지).
export default async function AccountPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const positionLabel = me.position ?? (isDeveloperEmail(me.email) ? "개발자" : null);

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">내 계정 설정</h1>
        <GuideButton title="내 계정 설정 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-6 text-xs text-slate-500">
        여기서 바꾼 이름과 사진은 사이드바 상단과, 앞으로 내가 작성하는 기록의 작성자 표시에 바로
        반영됩니다. 직위(권한) 뱃지는 관리자가 지정한 값을 그대로 보여줍니다.
      </p>
      <AccountSettingsForm
        userId={me.id}
        email={me.email}
        initialName={me.name ?? ""}
        initialAvatarUrl={me.avatar_url}
        positionLabel={positionLabel}
        initialTheme={me.theme}
      />
    </div>
  );
}
