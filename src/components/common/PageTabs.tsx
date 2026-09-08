"use client";

import { usePathname, useRouter } from "next/navigation";

/**
 * 한 가지 일을 여러 화면으로 나눠 놓은 곳에서, 그 화면들을 묶어주는 줄입니다.
 *
 * 상단 탭줄(SectionTabs)에 화면을 하나씩 다 걸면 대분류가 금세 열 개를 넘고, 그러면 사람은
 * 「명부 관리」와 「명부 점검」과 「명부 가져오기」가 서로 무슨 관계인지 알 수 없습니다.
 * 같은 일이면 한 자리에 모으고, 그 안에서 갈라야 합니다.
 *
 * **구현은 이 파일 하나뿐입니다.** 페이지마다 각자 탭줄을 그리면 모양도 자리도 제각각이
 * 되는데, 이 저장소에서 이미 겪은 일입니다(재무 화면 다섯 개).
 */

export type PageTab = {
  label: string;
  href: string;
  /** 이 탭이 켜지는 경로들. 없으면 href 하나. */
  match?: string[];
  /** 관리자만 들어갈 수 있는 화면. 아니면 아예 보여주지 않습니다 - 눌러도 튕겨나가니까요. */
  admin?: boolean;
};

export default function PageTabs({ tabs, isAdmin = false }: { tabs: PageTab[]; isAdmin?: boolean }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const shown = tabs.filter((t) => !t.admin || isAdmin);

  // 가장 길게 맞는 것이 이깁니다(/attendance 와 /attendance/status 처럼 겹칠 때).
  let active = "";
  let bestLen = -1;
  for (const t of shown) {
    for (const m of t.match ?? [t.href]) {
      if ((pathname === m || pathname.startsWith(m + "/")) && m.length > bestLen) {
        active = t.href;
        bestLen = m.length;
      }
    }
  }

  return (
    // h-10 고정: 화면을 옮길 때마다 이 줄이 위아래로 튀면 사람은 매번 눈으로 다시 찾습니다.
    <div className="mb-2 flex h-10 shrink-0 items-center gap-1 overflow-x-auto print:!hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {shown.map((t) => {
        const on = t.href === active;
        return (
          <button
            key={t.href}
            type="button"
            onClick={() => router.push(t.href)}
            onMouseEnter={() => router.prefetch(t.href)}
            className={
              "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors " +
              (on ? "bg-purple-600 text-white" : "bg-white/70 text-slate-600 ring-1 ring-slate-200 hover:text-slate-900")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
