"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import type { GoogleChatMirrorMessage, GoogleChatMirrorSourceKey, Task, TeamMember } from "@/lib/types";
import { extractMentionedEmails } from "@/lib/teamName";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { friendlyError } from "@/lib/errorMessage";

function timeStr(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
}

// 날짜 구분선에 쓰는 표시입니다 - 오늘/어제는 그렇게 쓰고, 그 외에는 "8월 6일 (수)" 형식으로
// 보여줍니다(요청: "날짜별로 구분이 되도록 해줄 수 있어?").
function dateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "오늘";
  if (sameDay(d, yesterday)) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

// 같은 날짜인지 그룹 나누기용으로 비교할 키(연-월-일)입니다.
function dateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// 구글챗 두 방(출결알림/선생님요청)을 읽기전용으로 실시간 미러링해서 보여줍니다(요청: "구글챗과
// 이 앱을 왔다갔다 하지않고 이앱에서 모든 업무작업이 이루어지도록"). 실제 수신은
// /api/google-chat/webhook이 Google Workspace Events API(Pub/Sub)로부터 받아
// google_chat_mirror_messages 테이블에 저장하고, 여기서는 그 결과를 실시간 구독해서 보여주기만
// 합니다(답장은 여전히 구글챗에서 - 이 패널은 답장 입력창이 없는 읽기전용입니다). 메시지마다
// ChatPanel의 "업무로 등록" 버튼과 같은 패턴을 재사용해 바로 업무카드로 만들 수 있습니다.
export default function GoogleChatMirrorPanel({
  sourceKey,
  title,
  icon,
  messages,
  team,
  userEmail,
  department,
  onTaskCreated,
}: {
  sourceKey: GoogleChatMirrorSourceKey;
  title: string;
  icon: string;
  messages: GoogleChatMirrorMessage[];
  team: TeamMember[];
  userEmail: string;
  department: string;
  onTaskCreated?: (task: Task) => void;
}) {
  const items = useMemo(
    () =>
      messages
        .filter((m) => m.source_key === sourceKey)
        .sort((a, b) => a.created_at_google.localeCompare(b.created_at_google)),
    [messages, sourceKey]
  );
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ChatPanel.registerAsTask()와 같은 흐름입니다 - 이 메시지 한 건만 AI에게 보내 제목/담당자/
  // 마감일/우선순위를 뽑아 업무로 등록합니다. AI 호출이 실패해도 규칙 기반 파서로 대체해서
  // 등록 자체는 항상 되도록 했습니다.
  async function registerAsTask(m: GoogleChatMirrorMessage) {
    setRegisteringId(m.id);
    setError(null);
    const supabase = createClient();
    let taskTitle: string;
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
      taskTitle = String(data.result.title || m.content).slice(0, 80);
      const namesSet = new Set<string>(data.result.assigneeNames || []);
      assigneeEmails = team.filter((t) => t.name && namesSet.has(t.name)).map((t) => t.email);
      if (assigneeEmails.length === 0) assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = data.result.dueDate ? new Date(`${data.result.dueDate}T23:59:59`).toISOString() : null;
      priority = data.result.priority === "긴급" ? "긴급" : "보통";
    } catch {
      aiFailed = true;
      const parsed = parseTaskFromMessage(m.content);
      taskTitle = parsed.cleanTitle.slice(0, 80);
      assigneeEmails = extractMentionedEmails(m.content, team);
      dueAt = parsed.dueAt;
    }
    void aiFailed;

    try {
      const description = (m.sender_display_name ? `[구글챗] ${m.sender_display_name}: ` : "[구글챗] ") + m.content;
      const { data: newTask, error: taskError } = await supabase
        .from("tasks")
        .insert({
          case_id: genCaseId("TSK"),
          title: taskTitle,
          description,
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
      if (taskError || !newTask) throw new Error(taskError?.message || "업무를 저장하지 못했습니다.");

      // 한 번 등록된 메시지는 표시를 남겨 중복 등록을 막습니다.
      await supabase.from("google_chat_mirror_messages").update({ task_id: newTask.id }).eq("id", m.id);

      onTaskCreated?.(newTask as Task);
    } catch (err) {
      setError(friendlyError("업무를 등록하지 못했습니다.", err));
    } finally {
      setRegisteringId(null);
    }
  }

  return (
    <div className="glass flex h-full flex-col overflow-hidden p-2.5">
      <div className="mb-1.5 flex shrink-0 items-center justify-between text-[12px] font-bold text-blue-600">
        <span>
          {icon} {title}
        </span>
        <span className="rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] text-slate-500">{items.length}건</span>
      </div>
      {error && <p className="mb-1 shrink-0 text-[10px] text-red-500">{error}</p>}
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 text-center text-[11px] leading-relaxed opacity-40">
          아직 연동 전입니다. 구글챗 연동을 마치면 이 방의 메시지가 여기 실시간으로 보여요.
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto pr-1">
          {items.map((m, i) => {
            const showDateDivider = i === 0 || dateKey(m.created_at_google) !== dateKey(items[i - 1].created_at_google);
            return (
              <div key={m.id}>
                {showDateDivider && (
                  <div className="sticky top-0 z-10 my-1 flex items-center gap-2 first:mt-0">
                    <div className="h-px flex-1 bg-black/5" />
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {dateLabel(m.created_at_google)}
                    </span>
                    <div className="h-px flex-1 bg-black/5" />
                  </div>
                )}
                <div className="rounded-lg bg-black/[0.02] px-2 py-1.5 text-[11px]">
                  <div className="mb-0.5 flex items-center justify-between gap-1 text-[10px] text-slate-400">
                    <span className="truncate font-semibold text-slate-500">{m.sender_display_name || "구글챗"}</span>
                    <span className="shrink-0">{timeStr(m.created_at_google)}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-slate-700">{m.content}</p>
                  {m.task_id ? (
                    <span className="mt-1 inline-block rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                      ✅ 업무 등록됨
                    </span>
                  ) : (
                    <div className="group relative mt-1 inline-block">
                      <button
                        type="button"
                        onClick={() => registerAsTask(m)}
                        disabled={registeringId === m.id}
                        className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-[11px] text-blue-600 transition hover:bg-blue-100 disabled:opacity-50"
                      >
                        {registeringId === m.id ? "⏳" : "🔧"}
                      </button>
                      {/* 아이콘만 두고, 호버 시에만 작은 글씨로 설명을 띄웁니다(요청: "아이콘만
                          표시하고 마우스를 아이콘에 호버링할때 '업무등록'글씨만 작게 뜨도록"). */}
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                        {registeringId === m.id ? "등록 중..." : "업무등록"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
