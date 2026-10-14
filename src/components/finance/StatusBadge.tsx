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

/**
 * **표 위의 색 범례 + 상태별 인원 + 그 상태만 보기.**
 *
 * 칸·줄을 상태 색으로 칠했으면 범례도 **같은 바탕색**이어야 «초록 = 완납»이 읽힙니다. 숫자를 함께 적어
 * 「완납 82 · 일부 6 · 청구됨 31 · 미청구 20」처럼 남은 일이 한 줄로 보이게 하고, 누르면 그 상태의 아이만
 * 남깁니다 - 일부만 낸 여섯 명을 찾으려고 139줄을 훑지 않게 합니다.
 */
export type FillKey = BillStatus | "없음";
export function StatusFillLegend({
  counts,
  active,
  onPick,
  order = ["완납", "일부", "청구됨", "연체", "미청구"],
}: {
  counts: Partial<Record<FillKey, number>>;
  active: FillKey | null;
  onPick: (k: FillKey | null) => void;
  order?: FillKey[];
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-[11px]">
      {order.map((k) => {
        const s = k === "없음" ? null : BILL_STATUS[k];
        const n = counts[k] ?? 0;
        const on = active === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onPick(on ? null : k)}
            disabled={n === 0 && !on}
            title={(s?.hint ?? "청구할 것이 없습니다") + (on ? " — 다시 누르면 전부 봅니다" : " — 누르면 이 상태만 봅니다")}
            className={
              "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-semibold transition disabled:opacity-40 " +
              (s?.bg || "bg-white") +
              (on ? " border-slate-700 ring-2 ring-slate-400" : " border-slate-200 hover:border-slate-400")
            }
          >
            <span className={"inline-block h-2.5 w-2.5 rounded-sm ring-1 ring-black/10 " + (s ? s.cls.split(" ")[0] : "bg-slate-200")} />
            <span className="text-slate-700">{s?.label ?? "청구 없음"}</span>
            <b className="tabular-nums text-slate-900">{n}</b>
          </button>
        );
      })}
      {active && (
        <button type="button" onClick={() => onPick(null)} className="rounded px-1 text-[11px] font-semibold text-slate-500 underline">
          전부 보기
        </button>
      )}
    </span>
  );
}
