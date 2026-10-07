"use client";

import { useRouter } from "next/navigation";
import { shiftMonth, type MonthKey } from "@/lib/financePeriod";

/**
 * **년도 · 월 고르기** — 재무 화면 공용.
 *
 * 청구·수납·통계가 저마다 달을 고르는 모양이 다르면, 화면을 옮길 때마다 「지금 몇 월을 보고
 * 있지」를 다시 확인하게 됩니다. 한 모양으로 둡니다: ◀ [년도] [월] ▶ [이번 달].
 */
export default function MonthPicker({
  value,
  onChange,
  thisMonth,
  fromYear = 2025,
  allowAll = false,
}: {
  value: MonthKey | null;
  onChange: (m: MonthKey | null) => void;
  /** 오늘이 든 달(한국 시간). 「이번 달」 단추와 년도 끝을 정합니다. */
  thisMonth: MonthKey;
  fromYear?: number;
  /** 「전체」를 고를 수 있는가(수납 내역처럼 달을 안 가릴 때도 있는 화면). */
  allowAll?: boolean;
}) {
  const cur = value ?? thisMonth;
  const [y, m] = cur.split("-").map(Number);
  const lastYear = Number(thisMonth.slice(0, 4)) + 1;
  const years: number[] = [];
  for (let k = Math.min(fromYear, y); k <= Math.max(lastYear, y); k++) years.push(k);
  const set = (yy: number, mm: number) => onChange(`${yy}-${String(mm).padStart(2, "0")}`);
  const btn = "rounded-lg border border-slate-300 bg-white px-2 py-1 text-[12px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40";
  return (
    <span className="inline-flex items-center gap-1" title="청구월 · 수납월">
      <button type="button" className={btn} onClick={() => onChange(shiftMonth(cur, -1))} disabled={value === null} aria-label="지난달">
        ◀
      </button>
      <select
        value={value === null ? "" : String(y)}
        onChange={(e) => (e.target.value ? set(Number(e.target.value), m) : onChange(null))}
        className="rounded-lg border border-slate-300 px-1.5 py-1 text-[12px] font-bold"
      >
        {allowAll && <option value="">전체</option>}
        {years.map((yy) => (
          <option key={yy} value={yy}>
            {yy}년
          </option>
        ))}
      </select>
      <select
        value={value === null ? "" : String(m)}
        onChange={(e) => (e.target.value ? set(y, Number(e.target.value)) : onChange(null))}
        disabled={value === null}
        className="rounded-lg border border-slate-300 px-1.5 py-1 text-[12px] font-bold disabled:opacity-40"
      >
        {value === null && <option value="">—</option>}
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mm) => (
          <option key={mm} value={mm}>
            {mm}월
          </option>
        ))}
      </select>
      <button type="button" className={btn} onClick={() => onChange(shiftMonth(cur, 1))} disabled={value === null} aria-label="다음 달">
        ▶
      </button>
      {cur !== thisMonth || value === null ? (
        <button type="button" className={btn} onClick={() => onChange(thisMonth)}>
          이번 달
        </button>
      ) : null}
    </span>
  );
}

/**
 * 서버에서 그리는 화면용 - 고르면 주소의 `?ym=` 을 바꿔 서버가 그 달로 다시 그립니다.
 * 달을 화면 상태로만 들고 있으면 새로고침·링크 공유 때 이번 달로 돌아가 버립니다.
 */
export function MonthNav({ basePath, value, thisMonth, allowAll = false }: { basePath: string; value: MonthKey | null; thisMonth: MonthKey; allowAll?: boolean }) {
  const router = useRouter();
  return (
    <MonthPicker
      value={value}
      thisMonth={thisMonth}
      allowAll={allowAll}
      onChange={(m) => router.push(m ? `${basePath}?ym=${m}` : `${basePath}?ym=all`)}
    />
  );
}
