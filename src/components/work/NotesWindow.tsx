"use client";

import { useState } from "react";
import { ToastProvider } from "@/components/common/ToastProvider";
import NoteBoard from "./NoteBoard";

/**
 * **쪽지 전용 작은 창.**
 *
 * ── 왜 창을 따로 띄우나 ────────────────────────────────────────────────────
 *
 * 쪽지는 업무보드 아래 띠로 늘 깔려 있었습니다. 그래서 자리를 계속 먹는데 정작 잘 안
 * 쓰였습니다 - 화면을 보는 이유(인박스·오늘 학생·달력)와 쪽지를 적는 순간이 다르기
 * 때문입니다.
 *
 * 그렇다고 없애면 「3시에 소방점검 옵니다」가 다시 말로만 오갑니다. 말로 한 것은 남지
 * 않습니다.
 *
 * 그래서 **평소에는 안 보이고, 필요할 때 옆에 띄워두는 창**으로 옮깁니다. 주소창 없는
 * 작은 창이라 업무 화면 옆에 붙여두고 쓸 수 있고, 업무보드는 그만큼 넓어집니다.
 *
 * 부서를 여기서 고를 수 있게 둡니다 - 창을 띄운 뒤에는 업무보드의 부서 탭이 안 보입니다.
 */
export default function NotesWindow({
  departments,
  initialDepartment,
  currentUserEmail,
  currentUserName,
}: {
  departments: string[];
  initialDepartment: string;
  currentUserEmail: string;
  currentUserName: string | null;
}) {
  const [dept, setDept] = useState(initialDepartment);

  return (
    <ToastProvider>
      <div className="flex h-screen flex-col bg-slate-50">
        <header className="flex shrink-0 items-center gap-1.5 border-b border-black/5 bg-white px-3 py-2">
          <span className="text-[13px] font-bold text-slate-700">📝 쪽지</span>
          {departments.length > 1 ? (
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="rounded-lg border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600"
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-[11px] font-semibold text-slate-500">{dept}</span>
          )}
          <span className="ml-auto text-[10px] text-slate-400">다같이 봅니다 · 지난 것은 저절로 떨어집니다</span>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden p-2">
          <NoteBoard department={dept} currentUserEmail={currentUserEmail} currentUserName={currentUserName} />
        </div>
      </div>
    </ToastProvider>
  );
}
