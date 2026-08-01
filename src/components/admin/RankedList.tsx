// 반복 사건 패턴 / 지도 필요 학생 / 우수 평가 학생처럼 "N건/N회" 랭킹 형태로 보여주는
// 공용 목록 컴포넌트입니다. 가장 큰 값 기준으로 막대 폭을 비례 표시합니다.
export type RankedItem = { label: string; count: number; sub?: string };

export default function RankedList({
  items,
  color,
  emptyText,
  unit = "건",
}: {
  items: RankedItem[];
  color: string;
  emptyText: string;
  unit?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-300">{emptyText}</p>;
  }
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <div key={item.label}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-xs font-semibold text-slate-700">{item.label}</span>
            <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
              {item.count}
              {unit}
            </span>
          </div>
          {item.sub && <div className="mb-0.5 truncate text-[10px] text-slate-400">{item.sub}</div>}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.max(6, (item.count / max) * 100)}%`, backgroundColor: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
