"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { friendlyError } from "@/lib/errorMessage";
import type { Task } from "@/lib/types";

function daysLeft(deletedAt: string) {
  const deletedMs = new Date(deletedAt).getTime();
  const purgeMs = deletedMs + 7 * 24 * 60 * 60 * 1000;
  const left = Math.ceil((purgeMs - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, left);
}

// 업무 휴지통(요청: "삭제 휴지통 7일 복구") - RLS가 이미 "삭제한 지 7일 이내면서 본인/담당자/
// 관리자"만 이 목록을 볼 수 있게 걸러주므로(schema.sql 섹션 62), 여기서는 받은 목록을 그대로
// 보여주고 복구만 처리하면 됩니다.
export default function TaskTrashClient({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const notify = useToast();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function restore(id: string) {
    setRestoringId(id);
    const supabase = createClient();
    const { error } = await supabase.from("tasks").update({ deleted_at: null }).eq("id", id);
    setRestoringId(null);
    if (error) {
      notify(friendlyError("복구하지 못했습니다.", error), "error");
      return;
    }
    notify("업무를 복구했습니다.", "success");
    router.refresh();
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
        휴지통이 비어있습니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((t) => (
        <div
          key={t.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-700">{t.title}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">
              {t.department ? `${t.department} · ` : ""}
              삭제됨 - {daysLeft(t.deleted_at as string)}일 후 완전히 삭제됩니다
            </div>
          </div>
          <button
            type="button"
            onClick={() => restore(t.id)}
            disabled={restoringId === t.id}
            className="shrink-0 rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            {restoringId === t.id ? "복구 중..." : "↩️ 복구"}
          </button>
        </div>
      ))}
    </div>
  );
}
