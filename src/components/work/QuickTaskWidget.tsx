"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { nameFor } from "@/lib/teamName";
import type { Task, TeamMember } from "@/lib/types";

type Mode = "나" | "전체" | "공유";

const MODE_META: Record<Mode, { icon: string; hint: string }> = {
  나: { icon: "🙋", hint: "내 업무로 등록" },
  전체: { icon: "👥", hint: "부서원 전체 업무로 등록(모두의 내 업무목록에 표시됨)" },
  공유: { icon: "🏷️", hint: "직접 고른 사람에게만 배정" },
};

// 채팅으로 업무를 만들면(문장을 AI가 해석) 애매한 문장에서 담당자·마감일이 잘못 추출될 수
// 있고, 실시간 채팅 트래픽에 업무 등록까지 얹혀 있다는 게 사장님 피드백이었습니다. 그래서
// 업무 등록을 채팅과 분리해, 업무상황판과 채팅 사이에 항상 떠 있는 이 위젯으로 옮겼습니다.
// AI 분석 없이(그래서 더 빠르고 항상 정확함) 담당자를 뱃지로 바로 지정합니다: [나]는 내
// 개인 업무, [전체]는 부서원 전원에게 배정되는 팀 업무(모두의 "내 업무목록"에 뜸), [공유]는
// 직접 고른 사람들에게만 배정됩니다. "내일까지"처럼 문장에 마감 표현이 있으면
// parseTaskFromMessage(채팅 @태그 자동등록에서 쓰던 것과 동일)가 자동으로 인식합니다.
export default function QuickTaskWidget({
  department,
  team,
  currentUserEmail,
  onTaskCreated,
}: {
  department: string;
  team: TeamMember[];
  currentUserEmail: string;
  onTaskCreated?: (task: Task) => void;
}) {
  const [mode, setMode] = useState<Mode>("나");
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const preview = useMemo(() => (text.trim() ? parseTaskFromMessage(text) : null), [text]);

  function pickMode(next: Mode) {
    if (next === "공유") {
      setShowPicker((prev) => (mode === "공유" ? !prev : true));
      setMode("공유");
    } else {
      setMode(next);
      setShowPicker(false);
    }
  }

  function toggleMember(email: string) {
    setSelected((prev) => (prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = text.trim();
    if (!raw || submitting) return;
    if (mode === "공유" && selected.length === 0) {
      setShowPicker(true);
      return;
    }

    setSubmitting(true);
    const parsed = parseTaskFromMessage(raw);
    const assigneeEmails = mode === "나" ? [currentUserEmail] : mode === "전체" ? team.map((t) => t.email) : selected;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        case_id: genCaseId("TSK"),
        title: parsed.cleanTitle.slice(0, 80),
        status: "예정",
        priority: urgent ? "긴급" : "보통",
        department,
        owner_email: currentUserEmail,
        assignee_emails: assigneeEmails,
        due_at: parsed.dueAt,
        position: Date.now(),
      })
      .select()
      .single();

    setSubmitting(false);
    if (error || !data) {
      alert("업무를 등록하지 못했습니다: " + (error?.message ?? "알 수 없는 오류"));
      return;
    }
    onTaskCreated?.(data as Task);
    setText("");
    setUrgent(false);
    if (mode === "공유") {
      setSelected([]);
      setShowPicker(false);
    }
  }

  return (
    <div className="glass flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {(["나", "전체", "공유"] as Mode[]).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => pickMode(m)}
              title={MODE_META[m].hint}
              className={
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (active ? "bg-blue-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
              }
            >
              <span>{MODE_META[m].icon}</span>
              {m}
              {m === "공유" && selected.length > 0 && (
                <span className={"rounded-full px-1 text-[10px] " + (active ? "bg-white/25" : "bg-blue-500 text-white")}>{selected.length}</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setUrgent((v) => !v)}
          title="긴급 표시"
          className={
            "ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition " +
            (urgent ? "bg-red-500 text-white" : "bg-black/5 text-slate-400 hover:bg-black/10")
          }
        >
          🔴 긴급
        </button>
      </div>

      {mode === "공유" && showPicker && (
        <div className="flex flex-wrap gap-1 rounded-lg bg-black/[0.03] p-1.5">
          {team.length === 0 && <span className="px-1 text-[11px] opacity-40">태그할 팀원이 없습니다.</span>}
          {team.map((m) => {
            const active = selected.includes(m.email);
            return (
              <button
                key={m.email}
                type="button"
                onClick={() => toggleMember(m.email)}
                className={
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition " +
                  (active ? "border-blue-500 bg-blue-500 text-white" : "border-slate-200 text-slate-500 hover:border-slate-300")
                }
              >
                {nameFor(team, m.email)}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="업무 입력 후 Enter (예: 내일까지 출석부 제출)"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-[12px] outline-none focus:border-blue-300"
        />
        {preview?.deadlineLabel && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-600">🗓 {preview.deadlineLabel}</span>
        )}
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-blue-600 disabled:opacity-50"
        >
          등록
        </button>
      </form>
    </div>
  );
}
