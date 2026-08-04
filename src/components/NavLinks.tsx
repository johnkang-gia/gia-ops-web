"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// labelEn이 있으면 한글 라벨 아래 작게 영어 라벨을 함께 보여줍니다 - 주간 학생 관찰기록은
// 영어 원어민 교사도 쓰기 때문에, 그 메뉴만이라도 영어를 병기해둡니다(요청).
export type NavLeaf = { href: string; label: string; labelEn?: string; icon: string };

// 메뉴 구조를 "카테고리" 단위로 바꿨습니다. items가 있으면 마우스를 올렸을 때 오른쪽으로
// 펼쳐지는 플라이아웃 서브메뉴가 되고(주메뉴가 세로로 길어지지 않음), items가 없으면 href로
// 바로 이동하는 단일 링크입니다. accent는 이 카테고리가 속한 "앱"을 색으로 구분하기 위한
// 값입니다(업무=블루/운영=네이비/위클리 리포트=틸/관리자·개발자=앰버·레드).
export type NavAccent = "navy" | "blue" | "teal" | "amber" | "red" | "purple";

export type NavCategory = {
  key: string;
  label: string;
  labelEn?: string;
  icon: string;
  accent?: NavAccent;
  href?: string;
  items?: NavLeaf[];
};

function isActiveHref(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

function isActiveCategory(pathname: string | null, cat: NavCategory) {
  if (cat.href && isActiveHref(pathname, cat.href)) return true;
  return !!cat.items?.some((i) => isActiveHref(pathname, i.href));
}

const ACCENT_TEXT: Record<NavAccent, string> = {
  navy: "text-gia-navy",
  blue: "text-blue-600",
  teal: "text-teal-600",
  amber: "text-amber-600",
  red: "text-red-600",
  purple: "text-purple-600",
};

const ACCENT_BG_SOFT: Record<NavAccent, string> = {
  navy: "bg-gia-navy/8",
  blue: "bg-blue-50",
  teal: "bg-teal-50",
  amber: "bg-amber-50",
  red: "bg-red-50",
  purple: "bg-purple-50",
};

const ACCENT_BORDER: Record<NavAccent, string> = {
  navy: "border-gia-navy",
  blue: "border-blue-500",
  teal: "border-teal-500",
  amber: "border-amber-500",
  red: "border-red-500",
  purple: "border-purple-500",
};

export function SidebarNavLinks({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flyoutRef = useRef<HTMLDivElement | null>(null);

  // 주메뉴가 사이드바 아래쪽에 있으면 부메뉴(플라이아웃)도 그만큼 아래에서 열리는데, 그대로
  // 두면 화면 아래로 잘려나가 누르기 어려워집니다(요청: "부메뉴가 화면에 가려서 누르기
  // 불편해"). 실제로 렌더링된 부메뉴 높이를 측정해서, 화면 아래로 넘치면 위로 밀어올려
  // 항상 화면 안에 다 보이도록 보정합니다. 페인트 전에 동기적으로 실행되는 useLayoutEffect라
  // 깜빡임 없이 바로 보정된 위치로 나타납니다.
  useLayoutEffect(() => {
    if (!openKey || !flyoutRef.current) return;
    const el = flyoutRef.current;
    const margin = 8;
    const height = el.offsetHeight;
    setPopupPos((prev) => {
      if (!prev) return prev;
      const maxTop = Math.max(margin, window.innerHeight - margin - height);
      const clampedTop = Math.min(prev.top, maxTop);
      if (clampedTop === prev.top) return prev;
      return { ...prev, top: clampedTop };
    });
    // openKey가 바뀔 때(=새로 열릴 때)만 보정하면 충분하고, popupPos를 의존성에 넣으면
    // 보정 자체가 다시 보정을 트리거해 무한루프가 됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);

  // 부메뉴를 사이드바 <nav> 안(overflow-y-auto)에 그대로 두면, 메뉴가 길어질 때 부메뉴 자체가
  // 스크롤 영역에 끼어 잘리거나 사이드바에 스크롤이 생겨버립니다. document.body에 포탈로
  // 그려서(진짜 팝업처럼) 어떤 부모의 overflow에도 영향받지 않고 항상 떠서 나오게 했습니다.
  function openFlyout(key: string, el: HTMLElement) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = el.getBoundingClientRect();
    setPopupPos({ top: rect.top, left: rect.right + 4 });
    setOpenKey(key);
  }

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenKey(null), 120);
  }

  const openCategory = categories.find((c) => c.key === openKey);

  // 예전에는 메뉴 그룹 사이에 구분선이 있어서 어디까지가 한 앱(업무/운영/위클리 등)인지
  // 한눈에 보였는데, 플라이아웃으로 평평하게 펼치면서 그 구분이 사라졌습니다. 얇은 실선을
  // 각 메뉴 항목 사이(divide-y)에 다시 넣어서 원래처럼 구분되도록 했습니다.
  return (
    <div className="flex flex-col divide-y divide-slate-100">
      {categories.map((cat) => {
        const active = isActiveCategory(pathname, cat);
        const accent = cat.accent ?? "navy";
        const hasChildren = !!cat.items && cat.items.length > 0;
        const targetHref = cat.href ?? cat.items?.[0]?.href ?? "#";

        return (
          <div
            key={cat.key}
            className="py-0.5"
            onMouseEnter={(e) => hasChildren && openFlyout(cat.key, e.currentTarget)}
            onMouseLeave={scheduleClose}
          >
            {/* <Link href>가 아니라 버튼+router.push로 이동시킵니다: <a href>를 쓰면 마우스를
                올렸을 때 브라우저가 창 아래쪽 상태표시줄에 링크 주소를 계속 띄우는데(요청:
                "메뉴에 마우스 올리면 창아래에 주소가 뜨는데 없앨 수 있어?"), 이건 브라우저
                자체 동작이라 CSS/JS로는 못 없애고 실제 href를 안 쓰는 방법뿐입니다. */}
            <button
              type="button"
              onClick={() => {
                setOpenKey(null);
                router.push(targetHref);
              }}
              className={
                "flex w-full cursor-pointer items-center gap-2 rounded-lg border-l-2 px-3 py-2 text-left text-sm font-medium transition-colors " +
                (active
                  ? ACCENT_BORDER[accent] + " " + ACCENT_BG_SOFT[accent] + " " + ACCENT_TEXT[accent] + " font-bold"
                  : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900")
              }
            >
              <span>{cat.icon}</span>
              <span className="flex-1 leading-tight">
                {cat.label}
                {cat.labelEn && <span className="block text-[10px] font-normal text-slate-400">{cat.labelEn}</span>}
              </span>
              {hasChildren && <span className="text-[10px] text-slate-300">›</span>}
            </button>
          </div>
        );
      })}

      {openCategory &&
        popupPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={flyoutRef}
            onMouseEnter={() => closeTimer.current && clearTimeout(closeTimer.current)}
            onMouseLeave={scheduleClose}
            style={{ position: "fixed", top: popupPos.top, left: popupPos.left }}
            className="z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            <div className={"mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-wide " + ACCENT_TEXT[openCategory.accent ?? "navy"]}>
              {openCategory.label}
            </div>
            {openCategory.items!.map((item) => {
              const itemActive = isActiveHref(pathname, item.href);
              const accent = openCategory.accent ?? "navy";
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => {
                    setOpenKey(null);
                    router.push(item.href);
                  }}
                  className={
                    "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors " +
                    (itemActive
                      ? ACCENT_BG_SOFT[accent] + " " + ACCENT_TEXT[accent] + " font-semibold"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")
                  }
                >
                  <span>{item.icon}</span>
                  <span className="leading-tight">
                    {item.label}
                    {item.labelEn && <span className="block text-[10px] font-normal text-slate-400">{item.labelEn}</span>}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

// 모바일은 화면이 좁아 플라이아웃을 붙일 공간이 없어서, 기존처럼 전체를 한 줄로 펼쳐 가로
// 스크롤하는 방식을 그대로 유지합니다(카테고리 라벨은 생략하고 실제 링크만 나열).
export function MobileNavLinks({ categories }: { categories: NavCategory[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const items: NavLeaf[] = categories.flatMap((c) =>
    c.items && c.items.length > 0
      ? c.items
      : c.href
        ? [{ href: c.href, label: c.label, labelEn: c.labelEn, icon: c.icon }]
        : []
  );

  return (
    <>
      {items.map((item) => {
        const active = isActiveHref(pathname, item.href);
        return (
          <button
            key={item.href}
            type="button"
            onClick={() => router.push(item.href)}
            className={
              "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
              (active ? "bg-gia-navy text-white" : "text-slate-600 hover:bg-slate-100")
            }
          >
            {item.icon} {item.label}
          </button>
        );
      })}
    </>
  );
}
