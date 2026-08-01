// 관리자 대시보드 전용 막대그래프 - 별도 차트 라이브러리 없이 순수 SVG/div로 구성했습니다
// (레퍼런스 코드베이스가 기존에도 recharts 등 없이 자체 SVG 게이지만 써왔던 관례를 그대로 따름).
// 시리즈가 1개면 단일 막대(예: 부서별 완료율), 2개 이상이면 그룹 막대(예: 월별 경고/우수 배지 추이)로 씁니다.
export type BarSeries = { key: string; label: string; color: string };
export type BarDataPoint = { label: string; values: Record<string, number> };

export default function GroupedBarChart({
  data,
  series,
  height = 120,
  maxValue,
  valueFormatter,
}: {
  data: BarDataPoint[];
  series: BarSeries[];
  height?: number;
  maxValue?: number;
  valueFormatter?: (v: number) => string;
}) {
  const fmt = valueFormatter ?? ((v: number) => String(v));
  const computedMax = maxValue ?? Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));

  if (data.length === 0) {
    return <p className="text-xs text-slate-300">표시할 데이터가 없습니다.</p>;
  }

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-3">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-3 overflow-x-auto pb-1">
        {data.map((d) => (
          <div key={d.label} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex items-end gap-1" style={{ height }}>
              {series.map((s) => {
                const v = d.values[s.key] ?? 0;
                const barH = computedMax > 0 ? Math.max(v > 0 ? 4 : 1, Math.round((v / computedMax) * height)) : 1;
                return (
                  <div key={s.key} className="flex flex-col items-center justify-end" style={{ height }}>
                    {v > 0 && <span className="mb-1 whitespace-nowrap text-[9px] font-semibold text-slate-500">{fmt(v)}</span>}
                    <div
                      className="w-3.5 rounded-t transition-all sm:w-5"
                      style={{ height: barH, backgroundColor: s.color }}
                      title={`${d.label} · ${s.label}: ${fmt(v)}`}
                    />
                  </div>
                );
              })}
            </div>
            <span className="whitespace-nowrap text-[10px] text-slate-400">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
