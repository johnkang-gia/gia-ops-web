"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import type { ChatMessage, Department, Task, TeamMember } from "@/lib/types";
import { nameFor, extractMentionedEmails } from "@/lib/teamName";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { deadlineLabel } from "@/lib/deadlineLabel";

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

  // 메시지를 클릭하면 뜨는 "업무로 등록" 작은 팝업 상태입니다.
  const [taskPopup, setTaskPopup] = useState<{ message: ChatMessage; top: number; left: number } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // 실시간 연결 상태를 화면에 보여줍니다("실시간 채팅이 제대로 돌아가는지" 눈으로 확인할 수 있게).
  // 웹소켓이 끊겼다가 다시 붙는 경우(와이파이 전환, 노트북 잠깐 절전 등) Supabase Realtime은
  // 끊겨 있던 동안의 이벤트를 다시 보내주지 않으므로, SUBSCRIBED 상태로 돌아올 때마다 최근
  // 메시지를 다시 불러와서 놓친 메시지가 없도록 채웁니다.
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    function loadRecentMessages() {
      supabase
        .from("messages")
        .select("*")
        .eq("department", department)
        .order("created_at", { ascending: true })
        .limit(100)
        .then(({ data }) => {
          if (!cancelled) setMessages((data as ChatMessage[] | null) ?? []);
        });
    }

    loadRecentMessages();

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
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          // 재연결된 경우(처음 연결이면 어차피 messages가 비어있는 상태와 동일해 무해함) 놓친
          // 메시지를 보충합니다.
          setConnected((wasConnected) => {
            if (!wasConnected) loadRecentMessages();
            return true;
          });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnected(false);
        }
      });

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

    // 예전에는 "@사람" 태그가 있으면 메시지를 곧바로 업무로 자동 등록했는데, 채팅이 실시간으로
    // 활발해지면 태그만 걸린 잡담까지 전부 업무화될 수 있어서 바꿨습니다. 이제는 메시지를 직접
    // 클릭했을 때 뜨는 작은 팝업에서 "업무로 등록"을 눌러야만(그때 AI가 분석) 업무가 됩니다 -
    // 아래 registerAsTask() 참고. @태그는 여전히 하이라이트만 되고, 등록 시 담당자 후보로 쓰입니다.

    // "#부서명" 태그 - 그 부서 채팅방에도 같은 메시지를 그대로 공유합니다.
    const taggedDepts = extractTaggedDepartments(content, departments, department);
    for (const dept of taggedDepts) {
      await supabase.from("messages").insert({ department: dept, author_email: userEmail, content, source_department: department });
    }

    setSending(false);
  }

  function openTaskPopup(e: React.MouseEvent, m: ChatMessage) {
    if (m.content.startsWith("✅ 업무로 등록됨")) return; // 등록 안내 메시지는 다시 등록할 필요 없음
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTaskPopup({ message: m, top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 230) });
  }

  // 팝업에서 "업무로 등록"을 누르면 이 메시지 한 건만 AI에게 보내 제목/담당자/마감일/우선순위를
  // 뽑아내 업무로 등록합니다. AI 호출이 실패해도(네트워크 오류 등) 기존 규칙 기반 파서
  // (parseTaskFromMessage)로 대체해서 등록 자체는 항상 되도록 했습니다.
  async function registerAsTask(m: ChatMessage) {
    setAnalyzing(true);
    const supabase = createClient();
    let title: string;
    let assigneeEmails: string[];
    let dueAt: string | null;
    let priority: "보통" | "긴급" = "보통";
    let aiFailed = false;

    try {
      const res = await fetch("/api/ai/analyze-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: m.content, teamNames: team.filter((t) => t.name).map((t) => t.name) }),
      });
      const data = await res.json();
      if (!res.ok || !data.result) throw new Error(data.error || "AI 분석 실패");
      title = String(data.result.title || m.content).slice(0, 80);
      const namesSet = new Set<string>(data.result.assigneeNames || []);
      assigneeEmails = team.filter((t) => t.name && namesSet.has(t.name)).map((t) => t.email);
      if (assigneeEmails.length === 0) assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = data.result.dueDate ? new Date(`${data.result.dueDate}T23:59:59`).toISOString() : null;
      priority = data.result.priority === "긴급" ? "긴급" : "보통";
    } catch {
      aiFailed = true;
      const parsed = parseTaskFromMessage(m.content);
      title = parsed.cleanTitle.slice(0, 80);
      assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = parsed.dueAt;
    }

    const { data: newTask } = await supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title,
        description: m.content,
        status: "예정",
        priority,
        department,
        owner_email: userEmail,
        assignee_emails: assigneeEmails,
        due_at: dueAt,
        position: Date.now(),
      })
      .select()
      .single();

    if (newTask) {
      onTaskCreated?.(newTask as Task);
      const assigneeLabel = assigneeEmails.length > 0 ? `${assigneeEmails.map((e) => nameFor(team, e)).join(", ")}님` : "담당자 미지정";
      const dl = deadlineLabel(dueAt);
      const deadlineSuffix = dl ? ` (${dl})` : "";
      const aiNote = aiFailed ? " ⚠️AI 분석 실패로 기본 규칙 사용" : " (AI 분석)";
      await supabase.from("messages").insert({
        department,
        author_email: userEmail,
        content: `✅ 업무로 등록됨${aiNote} → ${assigneeLabel}: "${newTask.title}"${deadlineSuffix}`,
      });
    }

    setAnalyzing(false);
    setTaskPopup(null);
  }

  const deptColor = departments.find((d) => d.name === department)?.color || "#3b82f6";

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2 text-[13px] font-bold">
        <span style={{ color: deptColor }}>👥</span>
        <span>[{department}] 부서 그룹 채팅방</span>
        <span className="text-[11px] font-normal opacity-60">({department} 부서원 전원이 참여 중입니다)</span>
        <span
          className={
            "ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold " +
            (connected ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")
          }
          title={connected ? "실시간 연결됨" : "연결이 끊겨 재연결을 시도하는 중입니다"}
        >
          <span className={"h-1.5 w-1.5 rounded-full " + (connected ? "bg-emerald-500" : "animate-pulse bg-amber-500")} />
          {connected ? "실시간 연결됨" : "재연결 중..."}
        </span>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && <p className="text-xs opacity-40">아직 메시지가 없습니다. 첫 메시지를 남겨보세요.</p>}
        <div className="flex flex-col gap-3">
          {messages.map((m) => {
            const linkedTask = tasks.find((t) => t.title === m.content.match(/"([^"]+)"/)?.[1]);
            const isSystemConfirmation = m.content.startsWith("✅ 업무로 등록됨");
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
                  <div
                    onClick={(e) => !isSystemConfirmation && openTaskPopup(e, m)}
                    title={isSystemConfirmation ? undefined : "클릭하면 이 메시지를 업무로 등록할 수 있어요"}
                    className={
                      "glass mt-1 inline-block max-w-full rounded-tl-none px-3 py-1.5 text-[13px] leading-relaxed transition " +
                      (isSystemConfirmation ? "" : "cursor-pointer hover:brightness-95")
                    }
                  >
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

      {/* 메시지를 클릭하면 뜨는 작은 "업무로 등록" 팝업 - 사이드바 부메뉴/업무상황판과 같은
          포탈 패턴이라 채팅창의 overflow-y-auto에 잘리지 않고 항상 위에 떠서 나옵니다. */}
      {taskPopup &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => !analyzing && setTaskPopup(null)} />
            <div
              style={{ position: "fixed", top: taskPopup.top, left: taskPopup.left }}
              className="z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              {analyzing ? (
                <div className="px-2.5 py-2 text-[12px] text-slate-500">🤖 AI가 분석하는 중...</div>
              ) : (
                <button
                  onClick={() => registerAsTask(taskPopup.message)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-blue-600 hover:bg-blue-50"
                >
                  📋 업무로 등록 (AI 분석)
                </button>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
