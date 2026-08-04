"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// labelEn이 있으면 한글 라벨 아래 작게 영어 라벨을 함께 보여줍니다 - 주간 학생 관찰기록은
// 영어 원어민 교사도 쓰기 때문에, 그 메뉴만이라도 영어를 병기해둡니다(요청).
// badge - 이 메뉴에서 "지금 처리해야 할 게 몇 건인지"를 사이드바에서 바로 보여주기 위한
// 숫자입니다(요청: "검토 대기 배지 추가" - 제안함/채택예정처럼 검토를 기다리는 항목이 있는
// 메뉴에 빨간 숫자로 표시). 0이거나 없으면 아무것도 표시하지 않습니다.
export type NavLeaf = { href: string; label: string; labelEn?: string; icon: string; badge?: number };

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

// 검토 대기 배지 - 제안함/채택예정처럼 "지금 처리해야 할 게 몇 건인지"를 메뉴를 열어보지
// 않아도 사이드바에서 바로 알 수 있게 빨간 숫자로 보여줍니다.
function NavBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-1 inline-flex h-4 min-w-[1rem] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function isActiveHref(pathname: string | null, href: string) {
  return pathname === href || pathname?.startsWith(href + "/");
}

// 카테고리끼리 URL 경로가 겹칠 수 있습니다(예: "학교관리"의 href는 "/school"인데, "학교문서함"은
// "/school/documents"). 단순 prefix 매칭만 쓰면 "/school/documents"에 있어도 "/school"로
// 시작한다는 이유로 학교관리까지 함께 활성화돼버립니다(요청: "학교문서합을 누르면 학교관리와
// 관리자가 색이 같이 바뀌고"). 그래서 지금 주소와 맞는 href 후보들을 전부 모은 뒤, 그중 가장
// 구체적인(글자수가 가장 긴) 것 하나만 "진짜 활성 경로"로 인정합니다 - 더 구체적인 카테고리가
// 있으면 그쪽만 켜지고, 바깥(부모격) 카테고리는 꺼집니다.
function bestMatchHref(pathname: string | null, categories: NavCategory[]): string | null {
  let best: string | null = null;
  for (const cat of categories) {
    const hrefs = [cat.href, ...(cat.items?.map((i) => i.href) ?? [])].filter((h): h is string => !!h);
    for (const href of hrefs) {
      if (isActiveHref(pathname, href) && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}

function isActiveCategory(cat: NavCategory, best: string | null) {
  if (!best) return false;
  if (cat.href === best) return true;
  return !!cat.items?.some((i) => i.href === best);
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
  const best = bestMatchHref(pathname, categories);

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
  function openFlyout(key: string, el: HTMLElement, items?: NavLeaf[]) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = el.getBoundingClientRect();
    setPopupPos({ top: rect.top, left: rect.right + 4 });
    setOpenKey(key);
    // 부메뉴가 열리는 순간 그 안의 항목들을 미리 가져와둡니다(요청: "메뉴 눌렀을 때 화면
    // 전환이 너무 느려" - <a href>를 버튼+router.push로 바꾸면서(위 주석 참고) Next.js가
    // 자동으로 해주던 프리페치까지 함께 사라진 게 원인이었습니다. 마우스를 올려 부메뉴가
    // 뜨는 시점에 그 안의 모든 링크를 미리 받아두면, 실제로 클릭할 땐 이미 화면 데이터가
    // 준비돼 있어 훨씬 빠르게 전환됩니다.
    items?.forEach((item) => router.prefetch(item.href));
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
        const active = isActiveCategory(cat, best);
        const accent = cat.accent ?? "navy";
        const hasChildren = !!cat.items && cat.items.length > 0;
        const targetHref = cat.href ?? cat.items?.[0]?.href ?? "#";
        const categoryBadgeTotal = cat.items?.reduce((sum, i) => sum + (i.badge ?? 0), 0) ?? 0;

        return (
          <div
            key={cat.key}
            onMouseEnter={(e) => (hasChildren ? openFlyout(cat.key, e.currentTarget, cat.items) : router.prefetch(targetHref))}
            onMouseLeave={scheduleClose}
          >
            {/* <Link href>가 아니라 버튼+router.push로 이동시킵니다: <a href>를 쓰면 마우스를
                올렸을 때 브라우저가 창 아래쪽 상태표시줄에 링크 주소를 계속 띄우는데(요청:
                "메뉴에 마우스 올리면 창아래에 주소가 뜨는데 없앨 수 있어?"), 이건 브라우저
                자체 동작이라 CSS/JS로는 못 없애고 실제 href를 안 쓰는 방법뿐입니다. 각 줄의
                상하 여백(py)도 최대한 줄여서 스크롤 없이 메뉴 전체가 한눈에 보이게 했습니다
                (요청: "메뉴들이 최대한 한눈에 보이게"). 다만 <Link>를 버리면서 Next.js가
                자동으로 해주던 hover 프리페치도 함께 사라졌던 게 "메뉴 눌렀을 때 화면 전환이
                느려" 문제의 원인이라, router.prefetch()로 그 역할을 직접 되살렸습니다. */}
            <button
              type="button"
              onTouchStart={() => router.prefetch(targetHref)}
              onClick={() => {
                setOpenKey(null);
                router.push(targetHref);
              }}
              className={
                "flex w-full cursor-pointer items-center gap-2 rounded-lg border-l-2 px-3 py-1.5 text-left text-sm font-medium transition-colors " +
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
              <NavBadge count={categoryBadgeTotal} />
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
              const itemActive = item.href === best;
              const accent = openCategory.accent ?? "navy";
              return (
                <button
                  key={item.href}
                  type="button"
                  onMouseEnter={() => router.prefetch(item.href)}
                  onTouchStart={() => router.prefetch(item.href)}
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
                  <span className="flex-1 leading-tight">
                    {item.label}
                    {item.labelEn && <span className="block text-[10px] font-normal text-slate-400">{item.labelEn}</span>}
                  </span>
                  <NavBadge count={item.badge ?? 0} />
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
        ? [{ href: c.href, label: c.label, labelEn: c.labelEn, icon: c.icon, badge: undefined }]
        : []
  );
  const best = bestMatchHref(pathname, categories);

  // 모바일은 가로로 죽 늘어선 목록이라 hover가 없어서(터치 시작 시점엔 이미 손가락이 눌린
  // 뒤라 프리페치할 시간이 촉박합니다), 화면에 붙는 순간 전부 미리 받아둡니다. 항목 수가
  // 많지 않아(전체 메뉴 20개 안팎) 한꺼번에 프리페치해도 부담이 없습니다.
  useLayoutEffect(() => {
    items.forEach((item) => router.prefetch(item.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {items.map((item) => {
        const active = item.href === best;
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
            <NavBadge count={item.badge ?? 0} />
          </button>
        );
      })}
    </>
  );
}
