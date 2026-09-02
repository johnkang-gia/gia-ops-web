"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SHUTTLE_TERMS, CURRENT_SHUTTLE_TERM, type ShuttleTerm } from "@/lib/shuttleTerm";

// 학기 전환 탭.
//
// 지난 학기 노선은 지우지 않고 여기서 꺼내 봅니다. 기본은 현재 학기라, 평소에는 여름캠프
// 차량이 섞여 보이지 않습니다.
export default function ShuttleTermTabs({ term, labels }: { term: ShuttleTerm; labels?: string[] }) {
  // 학기 목록은 **학기 표에서** 받습니다. 예전에는 코드에 박아두어서, 새 학기를 만들어도
  // 탭에 나타나지 않았습니다. 못 받았을 때만 예전 상수로 돌아갑니다.
  const list = labels && labels.length > 0 ? labels : (SHUTTLE_TERMS as readonly string[]);
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(t: string) {
    const next = new URLSearchParams(params.toString());
    if (t === CURRENT_SHUTTLE_TERM) next.delete("term");
    else next.set("term", t);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex items-center gap-1">
      <span className="inline-flex rounded-lg bg-slate-100 p-0.5">
        {list.map((t) => (
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
