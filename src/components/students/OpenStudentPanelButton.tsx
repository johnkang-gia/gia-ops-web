"use client";

import { useStudentPanel, type PanelTab } from "./StudentPanelProvider";

/** 서버 화면(프로필 등)에서 학생 창을 여는 단추. 창 자체는 로그인 영역에 이미 깔려 있습니다. */
export default function OpenStudentPanelButton({ studentId, tab = "기본", label, className = "" }: { studentId: string; tab?: PanelTab; label: string; className?: string }) {
  const panel = useStudentPanel();
  return (
    <button type="button" onClick={() => panel.open(studentId, tab)} className={"rounded-lg px-2.5 py-1.5 text-xs font-semibold transition " + className}>
      {label}
    </button>
  );
}
