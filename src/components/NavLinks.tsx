"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { label?: string; items: NavItem[] };

function isActive(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

export function SidebarNavLinks({ groups, dark = false }: { groups: NavGroup[]; dark?: boolean }) {
  const pathname = usePathname();
  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className={gi === 0 ? "" : "mt-4"}>
          {group.label && (
            <div
              className={
                "mb-1 px-3 text-[10px] font-bold uppercase tracking-wide " +
                (dark ? "text-white/40" : "text-slate-400")
              }
            >
              {group.label}
            </div>
          )}
          <div className="flex flex-col gap-1">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors " +
                    (dark
                      ? active
                        ? "bg-gia-gold text-gia-navy font-bold shadow-sm"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                      : active
                        ? "bg-gia-navy text-white"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
                  }
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export function MobileNavLinks({ groups, dark = false }: { groups: NavGroup[]; dark?: boolean }) {
  const pathname = usePathname();
  const items = groups.flatMap((g) => g.items);
  return (
    <>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={
              "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (dark
                ? active
                  ? "bg-gia-gold text-gia-navy font-bold"
                  : "text-white/70 hover:bg-white/10"
                : active
                  ? "bg-gia-navy text-white"
                  : "text-slate-600 hover:bg-slate-100")
            }
          >
            {item.icon} {item.label}
          </Link>
        );
      })}
    </>
  );
}
