import { BILL_STATUS, type BillStatus } from "@/lib/billStatus";

/** 청구 상태 뱃지. 말·색은 `billStatus.ts` 한 곳에서 옵니다. */
export function StatusBadge({ status, suffix, title, className = "" }: { status: BillStatus; suffix?: string; title?: string; className?: string }) {
  const s = BILL_STATUS[status];
  return (
    <span className={"shrink-0 whitespace-nowrap rounded px-1 text-[10px] font-bold " + s.cls + " " + className} title={title ?? s.hint}>
      {s.label}
      {suffix ? <span className="ml-0.5 font-semibold opacity-80">{suffix}</span> : null}
    </span>
  );
}

/** 표 위에 한 줄로 까는 범례. 색만 보고도 읽히게 합니다. */
export function StatusLegend({ only }: { only?: BillStatus[] }) {
  const list = only ?? (["미청구", "청구됨", "일부", "완납", "연체", "이월"] as BillStatus[]);
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
      {list.map((k) => (
        <StatusBadge key={k} status={k} />
      ))}
    </span>
  );
}
