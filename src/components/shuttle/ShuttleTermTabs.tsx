"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SHUTTLE_TERMS, CURRENT_SHUTTLE_TERM, type ShuttleTerm } from "@/lib/shuttleTerm";

// 학기 전환 탭.
//
// 지난 학기 노선은 지우지 않고 여기서 꺼내 봅니다. 기본은 현재 학기라, 평소에는 여름캠프
// 차량이 섞여 보이지 않습니다.
export default function ShuttleTermTabs({ term }: { term: ShuttleTerm }) {
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(t: ShuttleTerm) {
    const next = new URLSearchParams(params.toString());
    if (t === CURRENT_SHUTTLE_TERM) next.delete("term");
    else next.set("term", t);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex items-center gap-1">
      <span className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {SHUTTLE_TERMS.map((t) => (
          <Link
            key={t}
            href={hrefFor(t)}
            className={
              "rounded-md px-2.5 py-1 text-[11px] font-bold transition " +
              (term === t ? "bg-white text-gia-navy shadow-sm" : "text-slate-500 hover:text-slate-700")
            }
          >
            {t}
          </Link>
        ))}
      </span>
      {term !== CURRENT_SHUTTLE_TERM && (
        // 지난 학기를 열어두고 고치면 그때 기록이 어긋납니다. 보고 있다는 사실을 계속 말해줍니다.
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          지난 학기 — 기록 보기용
        </span>
      )}
    </div>
  );
}
