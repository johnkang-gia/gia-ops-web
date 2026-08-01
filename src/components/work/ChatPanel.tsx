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

export default function ChatPanel({
  department,
  departments,
  team,
  userEmail,
  onTaskCreated,
}: {
  department: string;
  departments: Department[];
  team: TeamMember[];
  userEmail: string;
  onTaskCreated?: (task: Task) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
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
      await supabase.from("messages").insert({
        department: dept,
        author_email: userEmail,
        content,
        source_department: department,
      });
    }

    setSending(false);
  }

  function insertToken(token: string) {
    setText((prev) => (prev ? prev.replace(/\s*$/, " ") + token + " " : token + " "));
  }

  const otherDepartments = departments.filter((d) => d.name !== department);

  return (
    <div className="flex h-[520px] flex-col rounded-2xl border border-white/70 bg-white/60 shadow-lg shadow-slate-200/40 backdrop-blur-md">
      <div className="border-b border-white/60 px-3 py-2 text-xs font-bold text-slate-600">
        💬 {department} 실시간 채팅
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && <p className="text-xs text-slate-300">아직 메시지가 없습니다. 첫 메시지를 남겨보세요.</p>}
        <div className="flex flex-col gap-2">
          {messages.map((m) => (
            <div key={m.id} className="rounded-lg bg-white/70 p-2 text-xs shadow-sm">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-600">{nameFor(team, m.author_email)}</span>
                <span className="text-[10px] text-slate-300">{timeStr(m.created_at)}</span>
              </div>
              {m.source_department && (
                <div className="mb-1 text-[10px] font-medium text-indigo-400">🔁 {m.source_department}에서 공유됨</div>
              )}
              <p className="whitespace-pre-wrap text-slate-700">{m.content}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/60 px-3 py-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {team
            .filter((m) => m.email !== userEmail && m.name)
            .slice(0, 8)
            .map((member) => (
              <button
                key={member.email}
                type="button"
                onClick={() => insertToken(`@${member.name}`)}
                className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-500 hover:bg-blue-100"
              >
                @{member.name}
              </button>
            ))}
          {otherDepartments.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => insertToken(`#${d.name}`)}
              className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-500 hover:bg-indigo-100"
            >
              #{d.name}
            </button>
          ))}
        </div>
        <form onSubmit={sendMessage} className="flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="메시지 입력... @사람 태그하면 업무로 등록돼요"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white/80 px-2 py-1.5 text-xs"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}
