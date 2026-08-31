import { Card } from "@/components/ui/card";
import Sparkline from "./Sparkline";
import { cn } from "@/lib/utils";

// 숫자 한 개짜리 카드. 추세선과 증감을 함께 담습니다.
//
// "미납 12건"만 적으면 어제보다 나아진 건지 나빠진 건지 모릅니다. 같은 자리에 추세를
// 같이 두면 판단까지 한 번에 됩니다.
export default function StatCard({
  label,
  value,
  unit,
  trend,
  delta,
  tone = "accent",
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number[];
  /** 앞선 기간 대비 증감. 양수면 ▲, 음수면 ▼. */
  delta?: number;
  tone?: "accent" | "ok" | "warn" | "bad";
  className?: string;
}) {
  const color = { accent: "var(--g-accent)", ok: "#10b981", warn: "#f59e0b", bad: "#f43f5e" }[tone];
  return (
    <Card hover className={cn("px-4 py-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--g-muted)]">{label}</span>
        {delta != null && delta !== 0 && (
          <span className={cn("text-[10px] font-bold", delta > 0 ? "text-rose-500" : "text-emerald-600")}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-extrabold tracking-tight" style={{ color }}>
            {typeof value === "number" ? value.toLocaleString("ko-KR") : value}
          </span>
          {unit && <span className="text-[11px] font-semibold text-[var(--g-muted)]">{unit}</span>}
        </div>
        {trend && trend.length > 1 && <Sparkline values={trend} width={84} height={26} color={color} />}
      </div>
    </Card>
  );
}
