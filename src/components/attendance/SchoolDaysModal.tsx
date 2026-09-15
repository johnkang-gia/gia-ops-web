"use client";

import { useState } from "react";
import PanelModal from "@/components/common/PanelModal";
import CalendarClient from "./CalendarClient";
import type { SchoolDaysPanel } from "@/lib/panels/schoolDays";

/**
 * **수업일 달력을 출석부에서 그대로 엽니다.**
 *
 * 수업일은 출석률의 **분모**입니다. 「이 반 출석률이 왜 이렇지」를 보다가 곧바로 「그날이
 * 수업일로 잡혀 있나」를 확인하게 되는데, 달력이 다른 화면이면 보고 있던 학기·반·날짜가
 * 풀린 채 돌아옵니다.
 *
 * 주소(`/attendance/calendar`)는 그대로 둡니다.
 */
export default function SchoolDaysButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-[12px] font-bold text-sky-700 transition hover:bg-sky-100"
        title="출석률의 분모가 되는 수업일을 이 화면에서 바로 고칩니다"
      >
        📆 수업일 달력
      </button>

      <PanelModal<SchoolDaysPanel>
        open={open}
        onClose={() => setOpen(false)}
        kind="school-days"
        title="📆 수업일 달력"
        hint="여기서 뺀 날은 출석률의 분모에서도 빠집니다. 하루를 잘못 빼면 그날 결석한 아이 전원의 결석 일수가 함께 틀어집니다."
      >
        {(d, email) => (
          <>
            {d.loadError && (
              <p className="mx-4 mt-4 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
                자료를 읽지 못했습니다: {d.loadError}
              </p>
            )}
            <CalendarClient
              terms={d.terms}
              initialTermId={d.initialTermId}
              initialDays={d.initialDays}
              coverageStart={d.coverageStart}
              currentUserEmail={email}
            />
          </>
        )}
      </PanelModal>
    </>
  );
}
