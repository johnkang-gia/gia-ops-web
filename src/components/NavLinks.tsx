"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: string };

export function SidebarNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium " +
              (active
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </>
  );
}

export function MobileNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium " +
              (active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")
            }
          >
            {item.icon} {item.label}
          </Link>
        );
      })}
    </>
  );
}
