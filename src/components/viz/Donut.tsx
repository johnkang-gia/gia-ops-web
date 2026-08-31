import { cn } from "@/lib/utils";

// 도넛. 비율 하나를 크게 보여줄 때 씁니다(수납률, 정원 대비 탑승률 등).
//
// 숫자만 적어두면 "78%"가 좋은 건지 나쁜 건지 읽는 사람이 매번 판단해야 합니다.
// 원이 얼마나 찼는지는 읽지 않고도 보입니다.
export default function Donut({
  value,
  max = 100,
  size = 96,
  thickness = 10,
  label,
  sub,
  color = "var(--g-accent)",
  className,
}: {
  value: number;
  max?: number;
  size?: number;
  thickness?: number;
  label?: string;
  sub?: string;
  color?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(99,102,241,0.12)" strokeWidth={thickness} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
        />
        <text
          x="50%"
          y="50%"
          className="rotate-90"
          style={{ transformOrigin: "center" }}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.24}
          fontWeight={800}
          fill="var(--g-ink)"
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      {label && <span className="mt-1 text-[11px] font-bold text-[var(--g-ink)]">{label}</span>}
      {sub && <span className="text-[10px] text-[var(--g-muted)]">{sub}</span>}
    </div>
  );
}
