import { redirect } from "next/navigation";
import { getCurrentAppUser } from "@/lib/currentUser";
import { createClient } from "@/lib/supabase/server";
import { isDeveloperEmail } from "@/lib/roles";
import AccountSettingsForm from "@/components/account/AccountSettingsForm";
import GuideButton from "@/components/common/GuideButton";
import { getLang } from "@/lib/langServer";
import { makeT, type T } from "@/lib/lang";
import { positionLabel as translatePosition } from "@/lib/i18nLabels";

function guideSections(t: T) {
  return [
    {
      title: t("👤 내 계정 설정이란?", "👤 What is this page?"),
      lines: [
        t(
          "내 이름과 프로필 사진을 바꿀 수 있습니다. 바꾸면 사이드바 상단과 내가 작성하는 기록의 작성자 표시에 바로 반영됩니다.",
          "You can change your name and profile photo here. Changes appear immediately at the top of the sidebar and on records you write."
        ),
      ],
    },
    {
      title: t("🏷️ 직위(권한) 뱃지", "🏷️ Role badge"),
      lines: [
        t(
          "자유 입력이 아니라 실제 권한 체계(교사/행정직원/관리자)를 그대로 보여주는 읽기 전용 표시입니다. 값 변경은 관리자만 가능합니다.",
          "This is read-only. It shows your actual role in the permission system (Teacher / Office Staff / Admin). Only an administrator can change it."
        ),
      ],
    },
    {
      title: t("🌐 화면 언어", "🌐 Screen language"),
      lines: [
        t(
          "왼쪽 메뉴 아래쪽의 [한국어 / English] 버튼으로 화면 전체를 원하는 언어로 바꿀 수 있습니다. 선택은 이 브라우저에 저장되어 다음에 로그인해도 그대로 유지됩니다.",
          "Use the [한국어 / English] switch near the bottom of the sidebar to change the whole app language. Your choice is remembered in this browser, including next time you sign in."
        ),
      ],
    },
  ];
}

export const dynamic = "force-dynamic";

// 내 계정 설정 - 프로필 사진/이름을 스스로 바꿀 수 있는 화면입니다. 직위(권한) 뱃지는 여기서
// 자유롭게 정하는 값이 아니라 우리 시스템의 실제 권한 체계(교사/행정직원/관리자/개발자)를 그대로
// 보여주는 읽기 전용 표시입니다 - 실제 값을 바꾸는 건 관리자만 [학교관리 > 사용자 관리]에서
// 승인 시점 또는 그 이후에 할 수 있습니다(권한 상승 방지).
export default async function AccountPage() {
  const me = await getCurrentAppUser();
  if (!me) redirect("/login");

  const lang = await getLang();
  const t = makeT(lang);
  // 담당 업무는 행정직원·관리자만 씁니다(교사는 담임반·담당과목이 그 역할을 합니다).
  const supabase = await createClient();
  const { data: row } = await supabase.from("app_users").select("duty").eq("email", me.email).maybeSingle();
  const showDuty = me.position === "행정직원" || me.position === "관리자" || isDeveloperEmail(me.email);
  const roleLabel = translatePosition(me.position ?? (isDeveloperEmail(me.email) ? "개발자" : null), lang) || null;

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">{t("내 계정 설정", "My Account")}</h1>
        <GuideButton title={t("내 계정 설정 사용 가이드", "Account settings guide")} sections={guideSections(t)} />
      </div>
      <p className="mb-6 text-xs leading-relaxed text-slate-500">
        {t(
          "여기서 바꾼 이름과 사진은 사이드바 상단과, 앞으로 내가 작성하는 기록의 작성자 표시에 바로 반영됩니다. 직위(권한) 뱃지는 관리자가 지정한 값을 그대로 보여줍니다.",
          "The name and photo you set here appear at the top of the sidebar and on records you write from now on. The role badge shows the value an administrator assigned to you."
        )}
      </p>
      <AccountSettingsForm
        userId={me.id}
        email={me.email}
        initialName={me.name ?? ""}
        initialAvatarUrl={me.avatar_url}
        positionLabel={roleLabel}
        initialTheme={me.theme}
        initialDuty={((row as { duty?: string | null } | null)?.duty) ?? ""}
        showDuty={showDuty}
      />
    </div>
  );
}
