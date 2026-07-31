"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTodoReminders } from "@/lib/useTodoReminders";
import type { Todo } from "@/lib/types";

// 앱 전체(어느 화면에 있든)에서 할 일 알림 시간이 되면 화면 오른쪽 아래에 팝업을 띄웁니다.
// 대시보드 레이아웃에 한 번만 마운트해서, 홈 화면이 아니어도 알림을 받을 수 있게 합니다.
export default function TodoReminderProvider({ userEmail }: { userEmail: string | null }) {
  const [toast, setToast] = useState<Todo | null>(null);
  useTodoReminders(userEmail, (todo) => setToast(todo));

  async function markDone() {
    if (!toast) return;
    const supabase = createClient();
    await supabase.from("todos").update({ done: true }).eq("id", toast.id);
    setToast(null);
  }

  if (!toast) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl border border-blue-200 bg-white p-4 shadow-lg">
      <div className="mb-1 text-xs font-semibold text-blue-600">⏰ 할 일 시간이 됐어요</div>
      <div className="mb-3 whitespace-pre-wrap text-sm text-slate-800">{toast.text}</div>
      <div className="flex justify-end gap-2">
        <button
          onClick={markDone}
          className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
        >
          완료 처리
        </button>
        <button
          onClick={() => setToast(null)}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
