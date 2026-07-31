"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type { Todo } from "@/lib/types";

function formatDue(due: string) {
  const d = new Date(due);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sortTodos(items: Todo[]) {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at);
    if (a.due_at) return -1;
    if (b.due_at) return 1;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export default function TodoList({ initialItems, userEmail }: { initialItems: Todo[]; userEmail: string }) {
  const [items, setItems] = useRealtimeTable<Todo>("todos", initialItems);
  const [text, setText] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );

  const sorted = sortTodos(items);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("todos")
      .insert({
        user_email: userEmail,
        text: text.trim(),
        due_at: showTime && dueAt ? new Date(dueAt).toISOString() : null,
      })
      .select()
      .single();
    if (data) setItems((prev) => [data as Todo, ...prev]);
    setText("");
    setDueAt("");
    setShowTime(false);
    setSaving(false);
  }

  async function toggleDone(item: Todo) {
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)));
    const supabase = createClient();
    await supabase.from("todos").update({ done: !item.done }).eq("id", item.id);
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    const supabase = createClient();
    await supabase.from("todos").delete().eq("id", id);
  }

  function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    Notification.requestPermission().then((p) => setPermission(p));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-1">
        <div className="text-xs font-semibold text-slate-500">✅ 할 일</div>
        {permission === "default" && (
          <button onClick={requestPermission} className="shrink-0 text-[10px] font-semibold text-blue-600 underline">
            🔔 알림 켜기
          </button>
        )}
      </div>

      <form onSubmit={addTodo} className="mb-3 flex flex-col gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="할 일 입력"
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        {showTime ? (
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowTime(true)}
            className="text-left text-[11px] text-slate-400 hover:text-blue-600"
          >
            🕐 시간 설정(선택)
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !text.trim()}
          className="rounded-lg bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          추가
        </button>
      </form>

      <div className="flex flex-col gap-1">
        {sorted.length === 0 && <p className="text-xs text-slate-300">등록된 할 일이 없습니다.</p>}
        {sorted.map((it) => (
          <div key={it.id} className="flex items-start gap-1.5 rounded-lg px-1 py-1 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={it.done}
              onChange={() => toggleDone(it)}
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className={"text-xs " + (it.done ? "text-slate-300 line-through" : "text-slate-700")}>
                {it.text}
              </div>
              {it.due_at && (
                <div className={"text-[10px] " + (it.done ? "text-slate-300" : "text-blue-500")}>
                  🕐 {formatDue(it.due_at)}
                </div>
              )}
            </div>
            <button
              onClick={() => remove(it.id)}
              className="shrink-0 text-[10px] text-slate-300 hover:text-red-500"
              aria-label="삭제"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {permission === "denied" && (
        <p className="mt-2 text-[10px] text-slate-300">
          브라우저 알림이 차단되어 있어요. 브라우저 설정에서 이 사이트 알림을 허용하면 시간에 맞춰
          팝업을 받을 수 있어요.
        </p>
      )}
    </div>
  );
}
