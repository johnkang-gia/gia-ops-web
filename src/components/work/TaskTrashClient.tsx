"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { friendlyError } from "@/lib/errorMessage";
import type { Task } from "@/lib/types";

function daysLeft(deletedAt: string) {
  const deletedMs = new Date(deletedAt).getTime();
  const purgeMs = deletedMs + 7 * 24 * 60 * 60 * 1000;
  const left = Math.ceil((purgeMs - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, left);
}

// 업무 휴지통(요청: "삭제 휴지통 7일 복구" + "휴지통에 영구삭제버튼과 휴지통 비우기 버튼 넣어줘") -
// RLS가 이미 "삭제한 지 7일 이내면서 본인/담당자/관리자"만 이 목록을 볼 수 있게 걸러주므로
// (schema.sql 섹션 62), 여기서는 받은 목록을 그대로 보여주고 복구/영구삭제만 처리하면 됩니다.
// 실제 하드 삭제(delete)는 DB의 owner_delete_tasks 정책상 등록자 본인 또는 관리자만 가능해서,
// 그 기준과 똑같이 버튼도 등록자 본인/관리자에게만 보여줍니다(담당자로 태그만 된 사람은 목록은
// 봐도 영구삭제는 못 하고 7일 뒤 자동 삭제를 기다립니다).
export default function TaskTrashClient({
  tasks,
  currentUserEmail,
  isAdmin,
}: {
  tasks: Task[];
  currentUserEmail: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const confirmAction = useConfirm();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);

  function canPurge(t: Task) {
    return isAdmin || t.owner_email === currentUserEmail;
  }

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

  async function purge(t: Task) {
    if (
      !(await confirmAction(`"${t.title}"을(를) 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`, {
        danger: true,
        confirmLabel: "영구 삭제",
      }))
    )
      return;
    setDeletingId(t.id);
    const supabase = createClient();
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    setDeletingId(null);
    if (error) {
      notify(friendlyError("영구 삭제하지 못했습니다.", error), "error");
      return;
    }
    notify("영구 삭제했습니다.", "success");
    router.refresh();
  }

  async function emptyTrash() {
    const purgeable = tasks.filter(canPurge);
    if (purgeable.length === 0) return;
    if (
      !(await confirmAction(
        `휴지통에서 영구삭제할 수 있는 업무 ${purgeable.length}건을 모두 지울까요? 이 작업은 되돌릴 수 없습니다.`,
        { danger: true, confirmLabel: "휴지통 비우기" }
      ))
    )
      return;
    setEmptying(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("tasks")
      .delete()
      .in("id", purgeable.map((t) => t.id));
    setEmptying(false);
    if (error) {
      notify(friendlyError("휴지통을 비우지 못했습니다.", error), "error");
      return;
    }
    notify("휴지통을 비웠습니다.", "success");
    router.refresh();
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
        휴지통이 비어있습니다.
      </div>
    );
  }

  const purgeableCount = tasks.filter(canPurge).length;

  return (
    <div className="flex flex-col gap-3">
      {purgeableCount > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={emptyTrash}
            disabled={emptying}
            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {emptying ? "비우는 중..." : `🗑️ 휴지통 비우기 (${purgeableCount})`}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-3 g-panel-solid px-4 py-3 shadow-sm"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-700">{t.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {t.department ? `${t.department} · ` : ""}
                삭제됨 - {daysLeft(t.deleted_at as string)}일 후 완전히 삭제됩니다
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => restore(t.id)}
                disabled={restoringId === t.id}
                className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
              >
                {restoringId === t.id ? "복구 중..." : "↩️ 복구"}
              </button>
              {canPurge(t) && (
                <button
                  type="button"
                  onClick={() => purge(t)}
                  disabled={deletingId === t.id}
                  title="7일을 기다리지 않고 지금 바로 완전히 삭제합니다"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deletingId === t.id ? "삭제 중..." : "🗑️ 영구삭제"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
