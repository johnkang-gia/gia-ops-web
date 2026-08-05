"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { StaffRequestCategoryRow } from "@/lib/types";
import CategoryManager from "@/components/requests/CategoryManager";

// 업무상황판의 짝입니다(요청: "행정요청메뉴가 없기 때문에 업무상황판을 둘로 나누고 왼쪽에는
// 지금의 업무상황판 오른쪽에는 행정요청이 얼마나 들어왔는지가 뜨도록하고 그 옆에 톱니바퀴
// 아이콘을 만들어서 거기에서 카테고리 관리할 수 있도록 해줘"). 행정요청 메뉴 자체는 이제
// 교사에게만 보이고(layout.tsx), 관리자/행정직원은 여기서 미처리 건수를 확인하고 필요하면
// /requests로 들어가거나, 톱니바퀴로 카테고리를 바로 관리합니다.
export default function RequestStatusWidget({
  pendingCount,
  categories,
  onCategoriesChange,
}: {
  pendingCount: number;
  categories: StaffRequestCategoryRow[];
  onCategoriesChange: (next: StaffRequestCategoryRow[]) => void;
}) {
  const [gearOpen, setGearOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  function openGear(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setGearOpen(true);
  }

  return (
    <div className="glass flex h-full items-center gap-2 px-3 py-1.5">
      <Link
        href="/requests"
        className="flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1.5 text-[11px] font-bold text-teal-700 transition hover:bg-teal-100"
        title="행정요청 전체 보기"
      >
        <span>🧾</span>
        <span>행정요청</span>
        <span className="rounded-full bg-white/70 px-1.5">{pendingCount}</span>
      </Link>
      <button
        type="button"
        onClick={(e) => openGear(e.currentTarget)}
        title="카테고리 관리"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/5 text-[12px] transition hover:bg-black/10"
      >
        ⚙️
      </button>

      {gearOpen &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setGearOpen(false)} />
            <div
              style={{ position: "fixed", top: pos.top, right: pos.right }}
              className="z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-600">
                <span>⚙️ 행정요청 카테고리 관리</span>
                <button type="button" onClick={() => setGearOpen(false)} className="text-slate-400 hover:text-slate-600">
                  닫기 ✕
                </button>
              </div>
              <CategoryManager categories={categories} onCategoriesChange={onCategoriesChange} variant="inline" />
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
