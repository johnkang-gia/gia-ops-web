"use client";

import { useState } from "react";
import PanelModal from "@/components/common/PanelModal";
import SubjectManageClient from "./SubjectManageClient";
import type { SubjectsPanel } from "@/lib/panels/subjects";

/**
 * **과목반 세팅을 반/담임 화면에서 그대로 엽니다.**
 *
 * 반을 만들고 담임을 붙이는 일과 과목에 담당 교사를 붙이는 일은 **같은 자리에서 같은 날**
 * 합니다 — 학기 초에 한 번에 끝내지 않으면, 담당이 빈 과목의 위클리 리포트는 아무도 쓰지
 * 못한 채 학기가 흘러갑니다. 그런데 두 화면이 갈려 있어서 한쪽만 하고 잊는 일이 반복됐습니다.
 *
 * 주소(`/weekly-report/admin/subjects`)는 그대로 둡니다.
 */
export default function SubjectsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-purple-300 bg-purple-50 px-2.5 py-1 text-[12px] font-bold text-purple-700 transition hover:bg-purple-100"
        title="과목마다 담당 교사와 수강 학생을 이 화면에서 바로 정합니다"
      >
        📗 과목반 세팅
      </button>

      <PanelModal<SubjectsPanel>
        open={open}
        onClose={() => setOpen(false)}
        kind="subjects"
        title="📗 과목반 세팅"
        hint="과목마다 담당 교사와 수강 학생 명단을 정합니다. 담당으로 지정된 교사가 그 과목의 위클리 리포트를 씁니다."
      >
        {(d) => (
          <div className="p-4">
            {d.loadError && (
              <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-800">
                자료를 읽지 못했습니다: {d.loadError}
              </p>
            )}
            <SubjectManageClient
              initialSubjects={d.initialSubjects}
              team={d.team}
              classes={d.classes}
              students={d.students}
            />
          </div>
        )}
      </PanelModal>
    </>
  );
}
