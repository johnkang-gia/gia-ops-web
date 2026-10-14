"use client";

import { useFinanceFilter } from "@/components/finance/FinanceFilterProvider";

/**
 * 이름 옆 📌 — 이 아이만 보기. 누르면 학비·학비외·학생별 회계·미납 어느 탭으로 가도 이 아이만 남습니다.
 * 고정한 아이에게는 늘 보이고, 나머지는 줄에 마우스를 올렸을 때만 보입니다(표가 핀으로 가득 차지 않게).
 */
export default function PinButton({ id, name }: { id: string; name: string }) {
  const f = useFinanceFilter();
  const on = f.pinned?.id === id;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        f.pin(on ? null : { id, name });
      }}
      title={on ? "고정 풀기" : `${name}만 보기 — 탭을 옮겨도 그대로`}
      className={
        "ml-1 rounded px-0.5 text-[11px] leading-none transition " +
        (on ? "opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100")
      }
    >
      📌
    </button>
  );
}
