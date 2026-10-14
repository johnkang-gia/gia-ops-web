"use client";

/**
 * **화면 아래 고정 작업 줄** — 고른 학생이 있을 때만 떠오릅니다.
 *
 * 표 위에 단추가 열 개 넘게 흩어져 있어서, 학생을 고르고 나면 「이제 어느 단추를 누르지」를
 * 표 위로 다시 올라가 찾아야 했습니다. 고른 순간 아래에 「3명 · 1,240,000원 · [발행]」이
 * 뜨면 손이 표에서 떠나지 않습니다. 단추는 표 위의 것과 **같은 함수**를 부릅니다 - 두 벌이
 * 아닙니다.
 */
export default function ActionBar({
  count,
  amount,
  onClear,
  children,
  warn,
}: {
  count: number;
  amount?: number;
  /** 누르기 전에 알아야 할 것(예: 이미 일부가 나간 학생 2명). 숫자로 띄우고 마우스를 올리면 누구인지. */
  warn?: { count: number; detail: string };
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 print:hidden">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900/95 px-4 py-2 text-white shadow-2xl backdrop-blur">
        <span className="text-[13px] font-bold">
          {count}명 선택
          {amount !== undefined && <span className="ml-1.5 tabular-nums text-emerald-300">{Math.round(amount).toLocaleString("ko-KR")}원</span>}
        </span>
        {warn && warn.count > 0 && (
          <span className="cursor-help rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white" title={warn.detail}>
            ⚠ {warn.count}
          </span>
        )}
        <span className="h-4 w-px bg-slate-600" />
        {children}
        <button type="button" onClick={onClear} className="rounded-lg px-2 py-1 text-[12px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white">
          선택 해제
        </button>
      </div>
    </div>
  );
}
