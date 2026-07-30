import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/SignOutButton";
import { SidebarNavLinks, MobileNavLinks } from "@/components/NavLinks";

const NAV_ITEMS = [
  { href: "/home", label: "홈", icon: "🏠" },
  { href: "/records", label: "기록함", icon: "🗂️" },
  { href: "/proposals", label: "제안함", icon: "📝" },
  { href: "/adopted", label: "채택예정", icon: "📬" },
  { href: "/manuals", label: "매뉴얼", icon: "📖" },
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-main.png" alt="GIA Micro Lab" className="h-10 w-auto" />
          <div className="mt-2 truncate text-xs text-slate-400">
            {user.email}
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          <SidebarNavLinks items={NAV_ITEMS} />
        </nav>
        <div className="border-t border-slate-200 pt-3">
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-main.png" alt="GIA Micro Lab" className="h-7 w-auto" />
          <SignOutButton />
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2 py-2 sm:hidden">
          <MobileNavLinks items={NAV_ITEMS} />
        </nav>
        <main className="flex-1 overflow-x-hidden p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
