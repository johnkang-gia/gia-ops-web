import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { isDeveloperEmail } from "@/lib/roles";
import AccountSettingsForm from "@/components/account/AccountSettingsForm";

export const dynamic = "force-dynamic";

// 내 계정 설정 - 프로필 사진/이름/표시 직함을 스스로 바꿀 수 있는 화면입니다. 실제 메뉴 접근
// 권한을 결정하는 position(교사/행정직원/관리자/개발자)은 여기서 다루지 않습니다 - 권한 상승을
// 막기 위해 관리자만 [학교관리 > 사용자 관리]에서 바꿀 수 있게 그대로 남겨뒀습니다.
export default async function AccountPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const positionLabel = me.position ?? (isDeveloperEmail(me.email) ? "개발자" : null);

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-lg font-bold">내 계정 설정</h1>
      <p className="mb-6 text-xs text-slate-500">
        여기서 바꾼 이름과 표시 직함은 사이드바 상단과, 앞으로 내가 작성하는 기록의 작성자 표시에
        바로 반영됩니다.
      </p>
      <AccountSettingsForm
        userId={me.id}
        email={me.email}
        initialName={me.name ?? ""}
        initialTitle={me.title ?? ""}
        initialAvatarUrl={me.avatar_url}
        positionLabel={positionLabel}
      />
    </div>
  );
}
