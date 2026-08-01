"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import type { ChatMessage, Department, Task, TeamMember } from "@/lib/types";
import { nameFor, extractMentionedEmails } from "@/lib/teamName";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// 메시지에서 "#부서명" 태그를 찾아, 지금 보고 있는 부서를 제외한 실제 부서명과 매칭합니다.
function extractTaggedDepartments(text: string, departments: Department[], current: string): string[] {
  const tags = [...text.matchAll(/#([가-힣a-zA-Z0-9]+)/g)].map((m) => m[1]);
  return departments.filter((d) => d.name !== current && tags.includes(d.name)).map((d) => d.name);
}

// @이름 / #부서명 토큰을 부서색으로 하이라이트해서 렌더링합니다(참조 소스코드의 renderMessageText).
function renderMessageText(text: string, departments: Department[]) {
  const parts = text.split(/(@\S+|#\S+)/);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      return (
        <span key={i} className="rounded bg-blue-100 px-1 py-0.5 font-semibold text-blue-700">
          {part}
        </span>
      );
    }
    if (part.startsWith("#")) {
      const dept = departments.find((d) => d.name === part.slice(1));
      const color = dept?.color || "#f59e0b";
      return (
        <span key={i} style={{ backgroundColor: color + "22", color }} className="rounded px-1 py-0.5 font-semibold">
          {part}
        </span>
      );
    }
    return part;
  });
}

export default function ChatPanel({
  department,
  departments,
  team,
  userEmail,
  tasks,
  onTaskCreated,
}: {
  department: string;
  departments: Department[];
  team: TeamMember[];
  userEmail: string;
  tasks: Task[];
  onTaskCreated?: (task: Task) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [showHashMenu, setShowHashMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [hashFilter, setHashFilter] = useState("");

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("messages")
      .select("*")
      .eq("department", department)
      .order("created_at", { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) setMessages((data as ChatMessage[] | null) ?? []);
      });

    const channel = supabase
      .channel(`messages-${department}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `department=eq.${department}` },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as ChatMessage;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [department]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const filteredUsers = team.filter((m) => m.name && m.name.includes(mentionFilter)).slice(0, 8);
  const filteredDepartments = departments.filter((d) => d.name !== department && d.name.includes(hashFilter));

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setText(val);
    const cursor = e.target.selectionStart || 0;
    const before = val.slice(0, cursor);

    const mentionMatch = before.match(/@(\S*)$/);
    if (mentionMatch) {
      setShowMentionMenu(true);
      setMentionFilter(mentionMatch[1]);
      setShowHashMenu(false);
      return;
    }
    setShowMentionMenu(false);

    const hashMatch = before.match(/#(\S*)$/);
    if (hashMatch) {
      setShowHashMenu(true);
      setHashFilter(hashMatch[1]);
    } else {
      setShowHashMenu(false);
    }
  }

  function selectToken(value: string, isHash: boolean) {
    if (!inputRef.current) return;
    const cursor = inputRef.current.selectionStart || 0;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);
    const newBefore = isHash ? before.replace(/#\S*$/, `#${value} `) : before.replace(/@\S*$/, `@${value} `);
    setText(newBefore + after);
    setShowMentionMenu(false);
    setShowHashMenu(false);
    inputRef.current.focus();
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    setShowMentionMenu(false);
    setShowHashMenu(false);
    const supabase = createClient();

    await supabase.from("messages").insert({ department, author_email: userEmail, content });

    // "@사람" 태그 - 즉시 업무로 전환하고, 등록됐다는 안내 메시지를 채팅에 남깁니다.
    const mentioned = extractMentionedEmails(content, team);
    if (mentioned.length > 0) {
      const { data: newTask } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: content.length > 80 ? content.slice(0, 80) + "…" : content,
          status: "예정",
          priority: "보통",
          department,
          owner_email: userEmail,
          assignee_emails: mentioned,
          position: Date.now(),
        })
        .select()
        .single();
      if (newTask) {
        onTaskCreated?.(newTask as Task);
        await supabase.from("messages").insert({
          department,
          author_email: userEmail,
          content: `✅ 업무로 등록됨 → ${mentioned.map((e) => nameFor(team, e)).join(", ")}님 태그: "${newTask.title}"`,
        });
      }
    }

    // "#부서명" 태그 - 그 부서 채팅방에도 같은 메시지를 그대로 공유합니다.
    const taggedDepts = extractTaggedDepartments(content, departments, department);
    for (const dept of taggedDepts) {
      await supabase.from("messages").insert({ department: dept, author_email: userEmail, content, source_department: department });
    }

    setSending(false);
  }

  const deptColor = departments.find((d) => d.name === department)?.color || "#3b82f6";

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 text-[13px] font-bold">
        <span style={{ color: deptColor }}>👥</span>
        <span>[{department}] 부서 그룹 채팅방</span>
        <span className="text-[11px] font-normal opacity-60">({department} 부서원 전원이 참여 중입니다)</span>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-xs opacity-40">아직 메시지가 없습니다. 첫 메시지를 남겨보세요.</p>}
        <div className="flex flex-col gap-3">
          {messages.map((m) => {
            const linkedTask = tasks.find((t) => t.title === m.content.match(/"([^"]+)"$/)?.[1]);
            return (
              <div key={m.id} className="flex gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm">👤</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-sm font-semibold">{nameFor(team, m.author_email)}</span>
                    <span className="text-[11px] opacity-50">{timeStr(m.created_at)}</span>
                    {linkedTask && (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        💼 업무 ({linkedTask.acknowledged_by?.length ?? 0}/{linkedTask.assignee_emails.length})
                      </span>
                    )}
                  </div>
                  {m.source_department && <div className="mt-0.5 text-[10px] font-medium text-indigo-500">🔁 {m.source_department}에서 공유됨</div>}
                  <div className="glass mt-1 inline-block max-w-full rounded-tl-none px-3 py-1.5 text-[13px] leading-relaxed">
                    {renderMessageText(m.content, departments)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative border-t border-black/5 p-2.5">
        {showMentionMenu && filteredUsers.length > 0 && (
          <div className="glass absolute bottom-full left-2.5 z-20 mb-1.5 max-h-48 w-56 overflow-y-auto p-1.5">
            <div className="px-2 py-1 text-[11px] opacity-60">개인 호출 (@)</div>
            {filteredUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => selectToken(u.name || u.email, false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-blue-50"
              >
                <span className="font-semibold">{u.name}</span>
              </button>
            ))}
          </div>
        )}
        {showHashMenu && filteredDepartments.length > 0 && (
          <div className="glass absolute bottom-full left-2.5 z-20 mb-1.5 max-h-48 w-56 overflow-y-auto p-1.5">
            <div className="px-2 py-1 text-[11px] opacity-60">단체/부서 공지 (#)</div>
            {filteredDepartments.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => selectToken(d.name, true)}
                style={{ color: d.color }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
              >
                <span className="font-semibold">{d.name}</span>
                <span className="text-[11px] opacity-60">전체 알림</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={sendMessage} className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2">
          <input
            ref={inputRef}
            value={text}
            onChange={handleInputChange}
            placeholder="메시지 보내기 (@개인호출, #부서단체공지)"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500 text-white transition hover:bg-blue-600 disabled:opacity-50"
          >
            ➤
          </button>
        </form>
      </div>
    </div>
  );
}
