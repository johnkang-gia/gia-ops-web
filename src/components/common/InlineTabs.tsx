"use client";

/**
 * 화면 «안»의 탭 줄. 상단 대분류 탭(SectionTabs)과 달리 한 화면 안에서 갈래를 나눕니다.
 *
 * **구현은 이 파일 하나뿐이고, 높이가 고정입니다.**
 *
 * 화면마다 각자 그리면 위에 얹힌 제목·요약 줄의 높이가 달라서, 탭 줄이 화면을 옮길 때마다
 * 위아래로 튑니다. 사람은 매번 눈으로 다시 찾아야 하고, 그게 「여기저기 왔다갔다 한다」로
 * 느껴집니다. 자리가 고정이면 눈이 한 번만 익히면 됩니다.
 */

export type InlineTab = { key: string; label: string; badge?: string | number; tone?: "default" | "warn" };

export default function InlineTabs({
  tabs,
  active,
  onPick,
  right,
}: {
  tabs: InlineTab[];
  active: string;
  onPick: (key: string) => void;
  /** 오른쪽에 함께 놓을 것(검색칸 등). 줄 높이는 그대로 유지됩니다. */
  right?: React.ReactNode;
}) {
  return (
    // h-10: 높이를 못 박습니다. 안에 무엇이 들어와도 아래 내용이 밀리지 않습니다.
    <div className="mb-2 flex h-10 shrink-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(t.key)}
            className={
              "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors " +
              (on
                ? "bg-slate-800 text-white"
                : t.tone === "warn"
                  ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900")
            }
          >
            {t.label}
            {t.badge !== undefined && t.badge !== "" && (
              <span className={"ml-1 rounded px-1 text-[10px] " + (on ? "bg-white/20" : "bg-slate-100 text-slate-500")}>
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
      {right && <div className="ml-auto flex shrink-0 items-center gap-1">{right}</div>}
    </div>
  );
}
