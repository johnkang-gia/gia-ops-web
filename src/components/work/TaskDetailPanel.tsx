"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskAttachment, TaskComment, TaskRecurrence, TaskStatus, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";
import { addTimedEventToNativeCalendar } from "@/lib/nativeCalendar";
import { recurrenceLabel, renewRecurringTask } from "@/lib/recurrence";
import { uploadTaskFile, getTaskFileSignedUrl, deleteTaskFile } from "@/lib/storage";
import { friendlyError } from "@/lib/errorMessage";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import { useRefreshTaskCounts } from "@/components/NotificationBell";
import { STATUS_ORDER, STATUS_LABEL } from "./statusConfig";

function formatFileSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export default function TaskDetailPanel({
  task,
  allTasks,
  team,
  online,
  currentUserEmail,
  isAdmin,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: Task;
  // 선행 업무(요청: "업무 선후관계 표시") 선택창의 후보 목록 + 이미 선택된 선행 업무의
  // 완료 여부를 보여주는 데 씁니다. 지금 업무보드에 떠 있는(=아직 보관되지 않은) 업무만
  // 후보로 제공합니다.
  allTasks: Task[];
  team: TeamMember[];
  online: string[];
  currentUserEmail: string;
  isAdmin: boolean;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [dueLocal, setDueLocal] = useState(task.due_at ? task.due_at.slice(0, 16) : "");
  // 보류로 옮기려고 하면 바로 상태를 바꾸지 않고, 먼저 "단순 보류"인지 "이슈"인지 물어봅니다
  // (이슈면 메모를 남겨야 하므로). holdPrompt가 열려 있는 동안은 select의 표시값도 이걸
  // 기준으로 되돌려둡니다(아직 확정 전이라 실제 상태는 안 바뀐 상태).
  const [holdPrompt, setHoldPrompt] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
  const refreshTaskCounts = useRefreshTaskCounts();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("task_attachments")
      .select("*")
      .eq("task_id", task.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setAttachments((data as TaskAttachment[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  async function uploadAttachment(file: File) {
    setUploading(true);
    try {
      const path = await uploadTaskFile(file, task.id);
      const supabase = createClient();
      const { data } = await supabase
        .from("task_attachments")
        .insert({
          task_id: task.id,
          uploader_email: currentUserEmail,
          file_path: path,
          file_name: file.name,
          file_type: file.type || null,
          file_size: file.size,
        })
        .select()
        .single();
      if (data) {
        setAttachments((prev) => [data as TaskAttachment, ...prev]);
        await logSystemEvent(`${nameFor(team, currentUserEmail)}님이 파일을 첨부했습니다: ${file.name}`);
      }
    } catch (err) {
      notify(friendlyError("파일 업로드에 실패했습니다.", err), "error");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function openAttachment(a: TaskAttachment) {
    const url = await getTaskFileSignedUrl(a.file_path);
    if (url) window.open(url, "_blank");
  }

  async function removeAttachment(a: TaskAttachment) {
    if (!(await confirmAction(`"${a.file_name}" 파일을 삭제할까요?`, { danger: true }))) return;
    setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    const supabase = createClient();
    await supabase.from("task_attachments").delete().eq("id", a.id);
    await deleteTaskFile(a.file_path);
  }

  async function setRecurrence(recurrence: TaskRecurrence) {
    await patch({ recurrence, recurrence_group_id: recurrence ? task.recurrence_group_id ?? crypto.randomUUID() : task.recurrence_group_id });
    setRecurrenceOpen(false);
  }

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // 상태변경/업무확인/코멘트 등록 시 자동으로 남는 시스템 로그(is_system=true)는 이제
    // 실시간 로그(ActivityLog)에서만 보여주고, 이 코멘트창에는 실제로 사람이 남긴 코멘트만
    // 보이도록 걸러냅니다(요청: "코멘트창에는 코멘트만 뜨고 로그는 실시간로그에 뜨도록").
    supabase
      .from("task_comments")
      .select("*")
      .eq("task_id", task.id)
      .eq("is_system", false)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setComments((data as TaskComment[] | null) ?? []);
      });

    const channel = supabase
      .channel(`task-comments-${task.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments", filter: `task_id=eq.${task.id}` },
        (payload) => {
          const next = payload.new as TaskComment;
          if (next.is_system) return;
          setComments((prev) => {
            if (prev.some((c) => c.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [task.id]);

  async function patch(fields: Partial<Task>) {
    // 낙관적으로 먼저 반영하되, 실제 저장이 실패하면(끊긴 와이파이 등) 원래 값으로 되돌리고
    // 알려줍니다 - 예전에는 실패해도 화면은 계속 "저장된 것처럼" 보여서 조용히 어긋났습니다.
    const previous = task;
    onUpdated({ ...task, ...fields });
    const supabase = createClient();
    const { error } = await supabase.from("tasks").update(fields).eq("id", task.id);
    if (error) {
      onUpdated(previous);
      notify(friendlyError("저장하지 못했습니다.", error), "error");
    }
  }

  // 상태 변경/업무 확인 시 "실시간 로그"에 뜰 시스템 코멘트를 자동으로 남깁니다(GIA WorkFlatform
  // 참조 구조의 활동 로그 기능 - 별도 로그 테이블 없이 기존 task_comments를 재사용합니다).
  async function logSystemEvent(content: string) {
    const supabase = createClient();
    await supabase.from("task_comments").insert({
      task_id: task.id,
      author_email: currentUserEmail,
      content,
      department: task.department,
      is_system: true,
    });
  }

  // 담당자 태그도 update 전체 덮어쓰기 대신 원자적 RPC로 토글합니다 - 관리자 여러 명이 거의
  // 동시에 담당자를 태그/해제해도 서로의 변경이 사라지지 않습니다.
  async function toggleAssignee(email: string) {
    const supabase = createClient();
    const { data: updated, error } = await supabase.rpc("toggle_task_assignee", { p_task_id: task.id, p_email: email });
    if (error) {
      notify(friendlyError("담당자 변경에 실패했습니다.", error), "error");
      return;
    }
    if (updated) onUpdated({ ...task, ...(updated as Task) });
  }

  async function changeStatus(status: TaskStatus) {
    if (status === task.status) return;
    const completedAt = status === "완료" ? new Date().toISOString() : null;
    // position도 함께 갱신해야 칸반 화면의 정렬 기준(order by position)이 이 패널에서
    // 완료/상태변경했을 때도 최신 상태를 반영합니다(칸반 드래그 쪽과 동일하게 맞춤).
    await patch({ status, updated_by: currentUserEmail, completed_at: completedAt, position: Date.now() });
    await logSystemEvent(`${nameFor(team, currentUserEmail)}님이 업무를 '${STATUS_LABEL[status]}'(으)로 변경했습니다.`);

    // 반복 업무는 완료되는 순간 다음 회차를 새로 등록합니다 - 예전에는 칸반(WorkBoardClient)
    // 쪽에만 이 로직이 있어서, 여기(상세패널)에서 완료 처리하면 반복이 조용히 끊겼습니다.
    // 두 곳 모두 같은 공용 함수를 쓰고, DB의 고유 제약(recurrence_group_id+due_at)이 있어
    // 두 사람이 거의 동시에 완료해도 다음 회차가 중복 생성되지 않습니다.
    if (status === "완료" && task.recurrence) {
      const supabase = createClient();
      await renewRecurringTask(supabase, { ...task, completed_at: completedAt });
    }
  }

  // 상태 드롭다운에서 "보류"를 고르면 바로 바꾸지 않고, 단순 보류인지 이슈(메모 필요)인지
  // 먼저 물어봅니다. 그 외 상태는 예전처럼 바로 반영됩니다.
  function onStatusSelect(next: TaskStatus) {
    if (next === "보류") {
      setHoldPrompt(true);
      return;
    }
    changeStatus(next);
  }

  // 이슈 메모는 업무를 공유하는 모두(코멘트를 볼 수 있는 사람 전원)에게 보이도록 일반
  // task_comments에 is_issue=true로 남깁니다 - 작성자는 author_email로 자동 표시됩니다.
  async function confirmHold(withIssue: boolean) {
    if (withIssue && !issueNote.trim()) return;
    await changeStatus("보류");
    if (withIssue) {
      const supabase = createClient();
      await supabase.from("task_comments").insert({
        task_id: task.id,
        author_email: currentUserEmail,
        content: issueNote.trim(),
        department: task.department,
        is_issue: true,
      });
    }
    setHoldPrompt(false);
    setIssueNote("");
  }

  // 업무 확인도 원자적 RPC로 처리합니다 - 여러 담당자가 거의 동시에 "확인"을 눌러도 서로의
  // 확인 기록이 사라지지 않습니다(전체 배열을 덮어쓰는 patch() 대신 toggle_task_ack 사용).
  async function toggleAck() {
    const already = task.acknowledged_by?.some((a) => a.email === currentUserEmail);
    const supabase = createClient();
    const { data: updated, error } = await supabase.rpc("toggle_task_ack", {
      p_task_id: task.id,
      p_email: currentUserEmail,
    });
    if (error) {
      notify(friendlyError("업무 확인 처리에 실패했습니다.", error), "error");
      return;
    }
    if (updated) onUpdated({ ...task, ...(updated as Task) });
    // 사이드바 알림 배지가 Realtime 전파를 기다리지 않고 지금 바로 다시 세도록 알립니다
    // (요청: "확인 체크 하자마자 사라지게 할 수 있어?").
    refreshTaskCounts();
    if (!already) {
      await logSystemEvent(`${nameFor(team, currentUserEmail)}님이 업무를 확인했습니다.`);
    }
  }

  async function saveDue() {
    await patch({ due_at: dueLocal ? new Date(dueLocal).toISOString() : null });
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    const supabase = createClient();
    const text = commentText.trim();
    setCommentText("");
    const { error } = await supabase
      .from("task_comments")
      .insert({ task_id: task.id, author_email: currentUserEmail, content: text, department: task.department });
    if (error) {
      // 저장 실패 시 입력하신 내용을 복원합니다 - 예전에는 실패해도 입력창은 이미 비워져 있어
      // 코멘트가 조용히 사라진 것처럼 보였습니다.
      setCommentText(text);
      notify(friendlyError("댓글을 등록하지 못했습니다.", error), "error");
      return;
    }
    // 코멘트를 남기면 실시간 로그(부서 전체가 보는 활동 피드)에도 한 줄로 뜨게 합니다(요청:
    // "코멘트를 날리면 로그에도 뜨게 만들어주고"). 로그 줄은 짧게 보여야 해서 너무 긴 코멘트는
    // 줄여서 남깁니다 - 원문 전체는 이 업무의 코멘트 목록에 그대로 남아있습니다.
    const preview = text.length > 40 ? text.slice(0, 40) + "…" : text;
    await logSystemEvent(`${nameFor(team, currentUserEmail)}님이 코멘트를 남겼습니다: "${preview}"`);
  }

  // 잘못 남은 코멘트/로그는 관리자이거나 그 글을 남긴 본인이면 지울 수 있습니다(요청) - 시스템
  // 로그(🔔)도 예외 없이 같은 기준으로 지울 수 있게 했습니다.
  function canDeleteComment(c: TaskComment) {
    return isAdmin || c.author_email === currentUserEmail;
  }

  async function deleteComment(c: TaskComment) {
    if (!(await confirmAction("이 항목을 삭제할까요?", { danger: true }))) return;
    setComments((prev) => prev.filter((x) => x.id !== c.id));
    const supabase = createClient();
    const { error } = await supabase.from("task_comments").delete().eq("id", c.id);
    if (error) notify(friendlyError("삭제하지 못했습니다.", error), "error");
  }

  // 하드 삭제 대신 소프트 삭제(deleted_at)로 바꿨습니다(요청: "삭제 휴지통 7일 복구") -
  // 코멘트는 지워지지 않고 그대로 남아있고(on delete cascade는 실제 삭제 시점에만 적용),
  // 업무탭 화면에서는 즉시 사라지지만(RLS가 deleted_at is null만 보여줌) 7일 안에는
  // /work/trash에서 등록자·담당자·관리자가 복구할 수 있습니다. 7일이 지나면 크론이 완전히
  // 지웁니다.
  async function remove() {
    if (
      !(await confirmAction("이 업무를 삭제할까요? 7일 안에는 휴지통에서 복구할 수 있습니다.", {
        danger: true,
      }))
    )
      return;
    const supabase = createClient();
    const { error } = await supabase.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", task.id);
    if (error) {
      notify(friendlyError("삭제하지 못했습니다.", error), "error");
      return;
    }
    onDeleted(task.id);
    onClose();
  }

  const myAck = task.acknowledged_by?.some((a) => a.email === currentUserEmail);
  // 등록자 본인은 확인 대상에서 제외합니다(요청: "업무등록한 사람은 확인목록에서 제외시켜주고") -
  // TaskCard.tsx와 같은 기준입니다.
  const ackRequiredEmails = task.assignee_emails.filter((e) => e !== task.owner_email);
  const iAmAssignee = ackRequiredEmails.includes(currentUserEmail);
  const canDelete = task.owner_email === currentUserEmail || isAdmin;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/30 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col bg-white p-4 shadow-xl sm:h-[85vh] sm:rounded-xl"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <input
            value={task.title}
            onChange={(e) => onUpdated({ ...task, title: e.target.value })}
            onBlur={(e) => patch({ title: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-transparent px-1 py-0.5 text-base font-bold hover:border-slate-200 focus:border-slate-300"
          />
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={task.status}
            onChange={(e) => onStatusSelect(e.target.value as TaskStatus)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <select
            value={task.priority}
            onChange={(e) => patch({ priority: e.target.value as Task["priority"] })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="보통">보통</option>
            <option value="긴급">🔴 긴급</option>
          </select>
          <input
            type="datetime-local"
            value={dueLocal}
            onChange={(e) => setDueLocal(e.target.value)}
            onBlur={saveDue}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
          {task.due_at && (
            <button
              type="button"
              onClick={() => addTimedEventToNativeCalendar(task.due_at as string, task.title)}
              title="내 캘린더에 추가"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              📅
            </button>
          )}
          <input
            list="dept-options"
            defaultValue={task.department ?? ""}
            onBlur={(e) => patch({ department: e.target.value.trim() || null })}
            placeholder="부서"
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={() => setRecurrenceOpen((v) => !v)}
            title="완료될 때마다 다음 회차를 자동으로 등록합니다"
            className={
              "rounded-lg border px-2 py-1 text-xs font-semibold " +
              (task.recurrence ? "border-indigo-400 bg-indigo-50 text-indigo-600" : "border-slate-300 text-slate-500 hover:bg-slate-50")
            }
          >
            🔁 {task.recurrence ? recurrenceLabel(task.recurrence) : "반복 없음"}
          </button>
          {/* 선행 업무(요청: "업무 선후관계 표시") - 강제로 막지는 않고, 아직 안 끝났으면
              아래 배너로만 알려줍니다(팀 운영 특성상 예외적으로 먼저 시작하는 경우도 잦아서). */}
          <select
            value={task.depends_on_task_id ?? ""}
            onChange={(e) => patch({ depends_on_task_id: e.target.value || null })}
            title="선행 업무 - 먼저 끝나야 하는 다른 업무를 지정합니다"
            className="max-w-[9rem] rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">🔗 선행 업무 없음</option>
            {allTasks
              .filter((t) => t.id !== task.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  🔗 {t.title}
                </option>
              ))}
          </select>
        </div>

        {task.depends_on_task_id &&
          (() => {
            const predecessor = allTasks.find((t) => t.id === task.depends_on_task_id);
            // 목록에서 안 보이면(칸반에서 이미 보관됐다는 뜻) 이미 끝난 것으로 간주하고
            // 경고를 띄우지 않습니다.
            if (!predecessor || predecessor.status === "완료") return null;
            return (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                ⛔ 선행 업무가 아직 끝나지 않았습니다: <span className="font-semibold">{predecessor.title}</span>{" "}
                ({STATUS_LABEL[predecessor.status]})
              </div>
            );
          })()}

        {recurrenceOpen && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 p-2">
            <button
              type="button"
              onClick={() => setRecurrence(null)}
              className={"rounded-full border px-2 py-0.5 text-[11px] font-semibold " + (!task.recurrence ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 text-slate-500")}
            >
              반복 안 함
            </button>
            <button
              type="button"
              onClick={() => setRecurrence({ freq: "daily" })}
              className={"rounded-full border px-2 py-0.5 text-[11px] font-semibold " + (task.recurrence?.freq === "daily" ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 text-slate-500")}
            >
              매일
            </button>
            {WEEKDAY_LABELS.map((d, idx) => (
              <button
                key={d}
                type="button"
                onClick={() => setRecurrence({ freq: "weekly", weekday: idx })}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] font-semibold " +
                  (task.recurrence?.freq === "weekly" && task.recurrence.weekday === idx ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 text-slate-500")
                }
              >
                매주 {d}
              </button>
            ))}
            <select
              value={task.recurrence?.freq === "monthly" ? task.recurrence.day_of_month ?? 1 : ""}
              onChange={(e) => setRecurrence({ freq: "monthly", day_of_month: Number(e.target.value) })}
              className="rounded-lg border border-indigo-200 bg-white px-1.5 py-0.5 text-[11px]"
            >
              <option value="" disabled>
                매월 며칠
              </option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  매월 {d}일
                </option>
              ))}
            </select>
          </div>
        )}

        {holdPrompt && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
            <div className="mb-1.5 text-xs font-semibold text-amber-700">⏸️ 보류로 옮길까요?</div>
            <p className="mb-1.5 text-[11px] text-amber-600">
              단순 보류라면 바로 옮기고, 이슈가 있다면 메모를 남겨서 함께 공유할 수 있어요.
            </p>
            <textarea
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              placeholder="이슈 메모 (선택)"
              rows={2}
              className="mb-1.5 w-full rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setHoldPrompt(false);
                  setIssueNote("");
                }}
                className="rounded-lg px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-100"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => confirmHold(false)}
                className="rounded-lg border border-amber-300 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
              >
                그냥 보류
              </button>
              <button
                type="button"
                onClick={() => confirmHold(true)}
                disabled={!issueNote.trim()}
                className="rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                이슈로 기록
              </button>
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className="mb-1 text-xs font-semibold text-slate-400">담당자 태그</div>
          <div className="flex flex-wrap gap-1.5">
            {team.map((member) => {
              const active = task.assignee_emails.includes(member.email);
              const isOnline = online.includes(member.email);
              return (
                <button
                  key={member.email}
                  onClick={() => toggleAssignee(member.email)}
                  className={
                    "rounded-full border px-2 py-1 text-[11px] font-medium transition " +
                    (active
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-200 text-slate-500 hover:border-slate-300")
                  }
                >
                  {isOnline && <span className="mr-1">🟢</span>}
                  {nameFor(team, member.email)}
                </button>
              );
            })}
          </div>
        </div>

        {ackRequiredEmails.length > 0 && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-blue-600">
                ✅ 업무 확인 ({task.acknowledged_by?.filter((a) => ackRequiredEmails.includes(a.email)).length ?? 0}/{ackRequiredEmails.length})
              </span>
              {iAmAssignee && (
                <label className="flex items-center gap-1 text-[11px] font-medium text-blue-600">
                  <input type="checkbox" checked={!!myAck} onChange={toggleAck} />
                  나 확인함
                </label>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {ackRequiredEmails.map((email) => {
                const ack = task.acknowledged_by?.find((a) => a.email === email);
                return (
                  <div key={email} className="flex items-center justify-between text-[11px]">
                    <span className={ack ? "text-slate-700" : "text-slate-400"}>
                      {ack ? "✅" : "⬜"} {nameFor(team, email)}
                    </span>
                    {ack && <span className="text-slate-400">{timeAgo(ack.time)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-400">📎 첨부파일 ({attachments.length})</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg border border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? "업로드 중..." : "+ 파일 추가"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadAttachment(file);
              }}
            />
          </div>
          {attachments.length > 0 && (
            <div className="flex flex-col gap-1">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px]">
                  <button onClick={() => openAttachment(a)} className="min-w-0 flex-1 truncate text-left text-slate-600 hover:text-blue-600" title={a.file_name}>
                    📄 {a.file_name} <span className="text-slate-300">{formatFileSize(a.file_size)}</span>
                  </button>
                  {(a.uploader_email === currentUserEmail || isAdmin) && (
                    <button onClick={() => removeAttachment(a)} className="shrink-0 text-slate-300 hover:text-red-500">
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 코멘트(위)/처리사항(아래)을 절반씩 나눕니다(요청: "코멘트부분 위아래 반으로 나눠서,
            위에는 코멘트를 넣을 수 있게 해주고, 아래부분은 이 업무가 어떻게 완료되었는지
            처리사항을 기록하도록 해주고"). 바깥 flex-col 컨테이너의 남은 세로 공간을 두
            flex-1 자식이 절반씩 나눠 갖고, 각자 안에서만 스크롤됩니다. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1 text-xs font-semibold text-slate-400">💬 코멘트 ({comments.length})</div>
            <div className="mb-2 min-h-0 flex-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
              {comments.length === 0 && <p className="text-xs text-slate-300">아직 코멘트가 없습니다.</p>}
              <div className="flex flex-col gap-2">
                {comments.map((c) =>
                  c.is_issue ? (
                    <div key={c.id} className="group rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs shadow-sm">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="font-semibold text-amber-700">⚠️ {nameFor(team, c.author_email)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px] text-amber-400">{timeAgo(c.created_at)}</span>
                          {canDeleteComment(c) && (
                            <button onClick={() => deleteComment(c)} title="삭제" className="text-amber-300 opacity-0 hover:text-red-500 group-hover:opacity-100">
                              ✕
                            </button>
                          )}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-amber-800">{c.content}</p>
                    </div>
                  ) : (
                    <div key={c.id} className="group rounded-lg bg-white p-2 text-xs shadow-sm">
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="font-semibold text-slate-600">{nameFor(team, c.author_email)}</span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-300">{timeAgo(c.created_at)}</span>
                          {canDeleteComment(c) && (
                            <button onClick={() => deleteComment(c)} title="삭제" className="text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100">
                              ✕
                            </button>
                          )}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-slate-700">{c.content}</p>
                    </div>
                  )
                )}
              </div>
            </div>

            <form onSubmit={addComment} className="flex gap-1.5">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="코멘트 입력..."
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
              <button
                type="submit"
                disabled={!commentText.trim()}
                className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                등록
              </button>
            </form>
          </div>

          <div className="flex min-h-0 flex-1 flex-col border-t border-slate-100 pt-2">
            <div className="mb-1 text-xs font-semibold text-slate-400">📝 처리사항</div>
            <textarea
              key={task.id}
              defaultValue={task.resolution_note ?? ""}
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if (next !== task.resolution_note) patch({ resolution_note: next });
              }}
              placeholder="이 업무를 어떻게 처리·완료했는지 기록해두면, 완료 후 업무기록·업무 보고서에서 처리 결과를 함께 볼 수 있습니다."
              className="min-h-0 flex-1 resize-none rounded-lg border border-slate-200 bg-white p-2 text-xs outline-none focus:border-blue-300"
            />
          </div>
        </div>

        {canDelete && (
          <button onClick={remove} className="mt-3 text-left text-[11px] text-slate-300 hover:text-red-500">
            🗑️ 이 업무 삭제
          </button>
        )}
      </div>
    </div>
  );
}
