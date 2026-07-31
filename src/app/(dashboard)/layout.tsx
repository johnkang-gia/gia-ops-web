import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks } from "@/components/NavLinks";

// 메뉴를 목적별로 묶었습니다:
// - 홈/실무자매뉴얼: 매일 가장 자주 쓰는 화면(홈 확인, 학부모 문의 답변용 검색)이라 맨 위.
// - 자료 기록: 사건·회의·AI매뉴얼은 전부 "실무자매뉴얼/운영계획안을 만들기 위한 재료"라는
//   같은 목적을 가지므로 한 그룹으로 묶었습니다.
// - 행사: 사건/회의와 달리 매뉴얼 제작이 아니라 "반복되는 행사를 중복 없이 기록하고, 다음
//   행사를 준비할 때 참고"하는 것이 목적이라 별도 그룹으로 분리했습니다.
// - 제안·발행 워크플로우: 위 자료들이 실제 문서로 만들어지는 승인 단계.
// - 문서함: 최종 결과물(매뉴얼·서류) 보관/편집.
// - 관리: 시스템 운영(승인 관리).
const NAV_GROUPS = [
  {
    items: [
      { href: "/home", label: "홈", icon: "🏠" },
      { href: "/staff-manual", label: "실무자매뉴얼", icon: "📚" },
    ],
  },
  {
    label: "자료 기록 (매뉴얼 재료)",
    items: [
      { href: "/records", label: "사건기록", icon: "📋" },
      { href: "/meetings", label: "회의기록", icon: "💬" },
      { href: "/ai-manual", label: "AI 매뉴얼", icon: "✨" },
    ],
  },
  {
    label: "행사 · 학기",
    items: [
      { href: "/events", label: "행사기록", icon: "🎉" },
      { href: "/terms", label: "학기", icon: "📅" },
    ],
  },
  {
    label: "제안 · 발행",
    items: [
      { href: "/proposals", label: "제안함", icon: "📝" },
      { href: "/adopted", label: "채택예정", icon: "📬" },
    ],
  },
  {
    label: "문서함",
    items: [
      { href: "/manuals", label: "매뉴얼", icon: "📖" },
      { href: "/documents", label: "서류함", icon: "📁" },
    ],
  },
  {
    label: "관리",
    items: [{ href: "/admin/users", label: "사용자 관리", icon: "🔐" }],
  },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // middleware.ts가 1차로 막지만, 서버 컴포넌트 단에서도 한 번 더 확인합니다(방어적 이중 확인).
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-6 px-2">
          <Link href="/home" className="inline-block cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="GIA Micro Lab" className="h-10 w-auto" />
          </Link>
          <div className="mt-2 truncate text-xs text-slate-400">
            {user.email}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
          <SidebarNavLinks groups={NAV_GROUPS} />
        </nav>
        <div className="border-t border-slate-200 pt-3">
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
          <Link href="/home" className="inline-block cursor-pointer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-main.png" alt="GIA Micro Lab" className="h-7 w-auto" />
          </Link>
          <SignOutButton />
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 sm:hidden">
          <MobileNavLinks groups={NAV_GROUPS} />
        </nav>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
