import { cn } from "@/lib/utils";

// 가로 막대 한 줄. 여러 항목을 견줄 때 씁니다.
//
// 표에 숫자만 늘어놓으면 "어디가 큰가"를 눈이 아니라 머리로 계산하게 됩니다.
export default function BarRow({
  label,
  value,
  max,
  suffix = "",
  color = "var(--g-accent)",
  danger = false,
  className,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  color?: string;
  /** 넘치면 빨강. 정원 초과처럼 "넘으면 안 되는" 값에 씁니다. */
  danger?: boolean;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = danger && value > max;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="w-20 shrink-0 truncate text-[11px] font-semibold text-[var(--g-ink)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(99,102,241,0.10)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: over ? "#f43f5e" : color }}
        />
      </div>
      <span className={cn("w-14 shrink-0 text-right text-[11px] font-bold", over ? "text-rose-600" : "text-[var(--g-muted)]")}>
        {value.toLocaleString("ko-KR")}
        {suffix}
      </span>
    </div>
  );
}
