"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Task, TaskComment, TaskStatus, TeamMember } from "@/lib/types";
import { nameFor } from "@/lib/teamName";

const STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "완료", "보류"];

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
  team,
  online,
  currentUserEmail,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: Task;
  team: TeamMember[];
  online: string[];
  currentUserEmail: string;
  onClose: () => void;
  onUpdated: (task: Task) => void;
  onDeleted: (id: string) => void;
}) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [dueLocal, setDueLocal] = useState(task.due_at ? task.due_at.slice(0, 16) : "");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("task_comments")
      .select("*")
      .eq("task_id", task.id)
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
          setComments((prev) => [...prev, payload.new as TaskComment]);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [task.id]);

  async function patch(fields: Partial<Task>) {
    onUpdated({ ...task, ...fields });
    const supabase = createClient();
    await supabase.from("tasks").update(fields).eq("id", task.id);
  }

  function toggleAssignee(email: string) {
    const has = task.assignee_emails.includes(email);
    patch({ assignee_emails: has ? task.assignee_emails.filter((e) => e !== email) : [...task.assignee_emails, email] });
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
    await supabase.from("task_comments").insert({ task_id: task.id, author_email: currentUserEmail, content: text });
  }

  async function remove() {
    if (!confirm("이 업무를 삭제할까요? 코멘트도 함께 삭제됩니다.")) return;
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", task.id);
    onDeleted(task.id);
    onClose();
  }

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
            onChange={(e) => patch({ status: e.target.value as TaskStatus })}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {s}
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
          <input
            list="dept-options"
            defaultValue={task.department ?? ""}
            onBlur={(e) => patch({ department: e.target.value.trim() || null })}
            placeholder="부서"
            className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          />
        </div>

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

        <div className="mb-2 text-xs font-semibold text-slate-400">
          💬 코멘트 ({comments.length})
        </div>
        <div className="mb-2 flex-1 overflow-y-auto rounded-lg bg-slate-50 p-2">
          {comments.length === 0 && <p className="text-xs text-slate-300">아직 코멘트가 없습니다.</p>}
          <div className="flex flex-col gap-2">
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg bg-white p-2 text-xs shadow-sm">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-600">{nameFor(team, c.author_email)}</span>
                  <span className="text-[10px] text-slate-300">{timeAgo(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-slate-700">{c.content}</p>
              </div>
            ))}
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
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            등록
          </button>
        </form>

        <button onClick={remove} className="mt-3 text-left text-[11px] text-slate-300 hover:text-red-500">
          🗑️ 이 업무 삭제
        </button>
      </div>
    </div>
  );
}
