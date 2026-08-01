"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { genCaseId } from "@/lib/caseId";
import type { Task, TaskStatus } from "@/lib/types";
import TaskCard from "./TaskCard";
import TaskDetailPanel from "./TaskDetailPanel";

const STATUS_ORDER: TaskStatus[] = ["예정", "진행중", "완료", "보류"];
const STATUS_STYLE: Record<TaskStatus, { header: string; drop: string }> = {
  예정: { header: "text-slate-600", drop: "bg-slate-50" },
  진행중: { header: "text-blue-600", drop: "bg-blue-50" },
  완료: { header: "text-emerald-600", drop: "bg-emerald-50" },
  보류: { header: "text-amber-600", drop: "bg-amber-50" },
};

function shortName(email: string) {
  return email.split("@")[0];
}

export default function WorkBoardClient({
  initialTasks,
  team,
  userEmail,
}: {
  initialTasks: Task[];
  team: string[];
  userEmail: string;
}) {
  const [tasks, setTasks] = useRealtimeTable<Task>("tasks", initialTasks);
  const online = useOnlineUsers(userEmail);

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"보통" | "긴급">("보통");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showCompletedAll, setShowCompletedAll] = useState(false);

  const grouped = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = { 예정: [], 진행중: [], 완료: [], 보류: [] };
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    for (const t of tasks) {
      if (t.status === "완료" && !showCompletedAll && new Date(t.updated_at).getTime() < fourteenDaysAgo) continue;
      map[t.status].push(t);
    }
    for (const s of STATUS_ORDER) map[s].sort((a, b) => a.position - b.position);
    return map;
  }, [tasks, showCompletedAll]);

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title: title.trim(),
        status: "예정",
        priority,
        owner_email: userEmail,
        assignee_emails: assignees,
        position: Date.now(),
      })
      .select()
      .single();
    if (data) setTasks((prev) => [...prev, data as Task]);
    setTitle("");
    setPriority("보통");
    setAssignees([]);
    setSaving(false);
  }

  async function changeStatus(taskId: string, status: TaskStatus) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    const position = Date.now();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, position } : t)));
    const supabase = createClient();
    await supabase.from("tasks").update({ status, position }).eq("id", taskId);
  }

  function toggleAssignee(email: string) {
    setAssignees((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-600">🟢 지금 접속 중:</span>
        {online.length === 0 && <span>없음</span>}
        {online.map((email) => (
          <span key={email} className="rounded-full bg-white px-2 py-0.5 shadow-sm">
            {email === userEmail ? "나" : shortName(email)}
          </span>
        ))}
      </div>

      <form onSubmit={addTask} className="mb-5 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="새 업무 등록 (예: 학부모 안내문 발송)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as "보통" | "긴급")}
            className="rounded-lg border border-slate-300 px-2 py-2 text-xs"
          >
            <option value="보통">보통</option>
            <option value="긴급">🔴 긴급</option>
          </select>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            등록
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400">담당자 태그:</span>
          {team.map((email) => {
            const active = assignees.includes(email);
            return (
              <button
                key={email}
                type="button"
                onClick={() => toggleAssignee(email)}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] transition " +
                  (active ? "border-blue-500 bg-blue-500 text-white" : "border-slate-200 text-slate-500 hover:border-slate-300")
                }
              >
                {online.includes(email) && <span className="mr-0.5">🟢</span>}
                {shortName(email)}
              </button>
            );
          })}
        </div>
      </form>

      <div className="mb-2 flex justify-end">
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          <input type="checkbox" checked={showCompletedAll} onChange={(e) => setShowCompletedAll(e.target.checked)} />
          완료된 업무 전체 보기(기본은 최근 14일)
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATUS_ORDER.map((status) => (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverStatus(status);
            }}
            onDragLeave={() => setDragOverStatus((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              const taskId = e.dataTransfer.getData("text/plain");
              changeStatus(taskId, status);
              setDragOverStatus(null);
            }}
            className={
              "flex min-h-[200px] flex-col gap-2 rounded-xl border border-slate-200 p-2 transition " +
              (dragOverStatus === status ? "border-blue-300 " + STATUS_STYLE[status].drop : "bg-white")
            }
          >
            <div className={"flex items-center justify-between px-1 text-xs font-bold " + STATUS_STYLE[status].header}>
              <span>{status}</span>
              <span className="text-slate-300">{grouped[status].length}</span>
            </div>
            {grouped[status].map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={() => setSelectedId(task.id)}
                onDragStartTask={(e, id) => e.dataTransfer.setData("text/plain", id)}
                onStatusChange={(s) => changeStatus(task.id, s)}
              />
            ))}
            {grouped[status].length === 0 && (
              <p className="px-1 text-[11px] text-slate-300">여기로 카드를 끌어다 놓을 수 있어요</p>
            )}
          </div>
        ))}
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          team={team}
          online={online}
          currentUserEmail={userEmail}
          onClose={() => setSelectedId(null)}
          onUpdated={(updated) => setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))}
          onDeleted={(id) => {
            setTasks((prev) => prev.filter((t) => t.id !== id));
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
