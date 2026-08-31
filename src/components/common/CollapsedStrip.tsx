"use client";

// 3단(또는 2단) 레이아웃에서 접힌 컬럼 자리에 대신 넣는 얇은 막대입니다. 클릭하면 다시
// 펼쳐집니다(요청: "좁게 사용하는 사람들이 있기 때문에... 접고 펼 수 있도록").
export default function CollapsedStrip({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`${label} 펼치기`}
      className="flex h-full w-full flex-col items-center justify-center gap-2 g-panel-solid py-3 text-slate-400 shadow-sm hover:border-slate-300 hover:text-slate-600 lg:h-full"
    >
      <span className="text-xs">›</span>
      <span className="text-[11px] font-semibold [writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}
