"use client";

import { useState } from "react";
import PanelModal from "@/components/common/PanelModal";
import FeeItemsClient from "./FeeItemsClient";
import type { FeeItemsPanel } from "@/lib/panels/feeItems";

/**
 * **학비외 항목을 청구 표 위에서 그대로 엽니다.**
 *
 * 항목이 없으면 표에 열이 안 생기고, 그러면 그 아이에게 교재를 청구할 방법이 없습니다.
 * 그런데 항목 관리는 다른 대분류 탭이라, 만들러 건너가면 보고 있던 학기·부서·체크가
 * 전부 풀렸습니다. 이제 표를 보면서 바로 만듭니다.
 *
 * 주소(`/finance/items`)는 그대로 둡니다 - 즐겨찾기와 옛 링크가 끊기면 안 됩니다.
 */
export default function FeeItemsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-[12px] font-bold text-teal-700 transition hover:bg-teal-100"
        title="교재·교복 등 학비외 항목을 이 화면에서 바로 만듭니다"
      >
        📚 학비외 항목
      </button>

      <PanelModal<FeeItemsPanel>
        open={open}
        onClose={() => setOpen(false)}
        kind="fee-items"
        title="📚 학비외 항목"
        hint="여기서 만든 항목은 닫는 즉시 뒤의 표에 열로 뜹니다. 이미 나간 청구서는 그대로입니다."
      >
        {(d, email) => (
          <FeeItemsClient
            initialItems={d.initialItems}
            initialCategories={d.initialCategories}
            terms={d.terms}
            gradesByDept={d.gradesByDept}
            classesByDept={d.classesByDept}
            classesByGrade={d.classesByGrade}
            groups={d.groups}
            usageByItem={d.usageByItem}
            currentUserEmail={email}
            loadError={d.loadError}
          />
        )}
      </PanelModal>
    </>
  );
}
