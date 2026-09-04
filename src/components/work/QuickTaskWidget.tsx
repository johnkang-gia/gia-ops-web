"use client";

import { realPeople } from "@/lib/taskAck";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { deadlineLabel } from "@/lib/deadlineLabel";
import { nameFor } from "@/lib/teamName";
import type { Task, TaskModeColor, TaskRecurrence, TeamMember } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

type Mode = "나" | "전체" | "공유";

const MODE_META: Record<Mode, { icon: string; hint: string }> = {
  나: { icon: "🙋", hint: "내 업무로 등록" },
  전체: { icon: "👥", hint: "부서원 전체 업무로 등록(모두의 내 업무목록에 표시됨)" },
  공유: { icon: "🏷️", hint: "직접 고른 사람에게만 배정" },
};

const DEFAULT_MODE_COLOR: Record<Mode, string> = { 나: "#3b82f6", 전체: "#8b5cf6", 공유: "#f59e0b" };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 날짜 입력만 있으면 그 날 23:59까지, 시간 입력만 있으면 "오늘 그 시각까지", 둘 다 있으면
// 정확히 그 날짜·시각으로 마감을 정합니다(요청 #6) - 기존 parseTaskFromMessage의 텍스트
// 인식(예: "내일까지")은 이 명시적 입력이 없을 때만 대신 씁니다.
function computeExplicitDueAt(dateStr: string, timeStr: string): string | null {
  if (!dateStr && !timeStr) return null;
  const [y, m, d] = (dateStr || toDateInputValue(new Date())).split("-").map(Number);
  if (timeStr) {
    const [hh, mm] = timeStr.split(":").map(Number);
    return new Date(y, m - 1, d, hh, mm, 0).toISOString();
  }
  return new Date(y, m - 1, d, 23, 59, 59).toISOString();
}

// 채팅으로 업무를 만들면(문장을 AI가 해석) 애매한 문장에서 담당자·마감일이 잘못 추출될 수
// 있고, 실시간 채팅 트래픽에 업무 등록까지 얹혀 있다는 게 사장님 피드백이었습니다. 그래서
// 업무 등록을 채팅과 분리해, 업무상황판과 채팅 사이에 항상 떠 있는 이 위젯으로 옮겼습니다.
// AI 분석 없이(그래서 더 빠르고 항상 정확함) 담당자를 뱃지로 바로 지정합니다: [나]는 내
// 개인 업무, [전체]는 부서원 전원에게 배정되는 팀 업무(모두의 "내 업무목록"에 뜸), [공유]는
// 직접 고른 사람들에게만 배정됩니다. 각 모드의 색은 관리자가 바꿀 수 있고(요청 #4), 그 색이
// 그대로 카드 강조색으로 쓰입니다.
export default function QuickTaskWidget({
  department,
  team,
  currentUserEmail,
  onTaskCreated,
  modeColorMap,
  isAdmin,
  onModeColorChange,
}: {
  department: string;
  team: TeamMember[];
  currentUserEmail: string;
  onTaskCreated?: (task: Task) => void;
  modeColorMap: Map<string, string>;
  isAdmin: boolean;
  onModeColorChange: (mode: TaskModeColor["mode"], color: string) => void;
}) {
  const notify = useToast();
  const [mode, setMode] = useState<Mode>("나");
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 오늘/내일/이번주 뱃지 + 정확한 날짜/시간 입력 (요청 #6)
  const [quickBadge, setQuickBadge] = useState<"오늘" | "내일" | "이번주" | null>(null);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");

  // 반복 업무 - 완료될 때마다 다음 회차를 자동 생성합니다(요청). 매주/매월은 요일/날짜를
  // 추가로 지정하고, 기본값은 오늘 기준(요일/일)로 잡아둡니다.
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [recurrenceFreq, setRecurrenceFreq] = useState<"daily" | "weekly" | "monthly" | null>(null);
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(new Date().getDay());
  const [recurrenceDom, setRecurrenceDom] = useState(new Date().getDate());
  const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

  const preview = useMemo(() => (text.trim() ? parseTaskFromMessage(text) : null), [text]);
  const explicitDueAt = useMemo(() => computeExplicitDueAt(dateStr, timeStr), [dateStr, timeStr]);
  const explicitLabel = explicitDueAt ? deadlineLabel(explicitDueAt) : null;

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

  function pickQuickBadge(key: "오늘" | "내일" | "이번주") {
    if (quickBadge === key) {
      setQuickBadge(null);
      setDateStr("");
      return;
    }
    const now = new Date();
    let target = new Date(now);
    if (key === "내일") target.setDate(target.getDate() + 1);
    if (key === "이번주") {
      const day = now.getDay(); // 0=일 ... 6=토
      const daysUntilSunday = (7 - day) % 7; // 이번주 일요일까지 남은 일수(오늘이 일요일이면 0)
      target.setDate(target.getDate() + daysUntilSunday);
    }
    setDateStr(toDateInputValue(target));
    setQuickBadge(key);
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
    // 등록자 본인은 어떤 모드로 등록하든 항상 담당자(태그)에 포함시킵니다 - 이제 "내 업무목록"과
    // 업무 흐름판(진행대기/진행중/완료)이 모두 "내가 태그되었는가" 하나만 기준으로 삼기 때문에,
    // 내가 등록한 업무가 내 목록에서 빠지지 않으려면 등록 시점에 자기 자신도 태그되어야 합니다
    // ([공유] 모드로 다른 사람만 골라 등록한 경우가 여기 해당됩니다).
    // [전체]는 **사람이 쓰는 계정만** 담습니다. 도서관 노트북과 오리엔테이션 교육용
    // 계정까지 담당자로 들어가면, 아무도 못 누르는 확인이 영영 남습니다.
    const baseAssignees =
      mode === "나" ? [currentUserEmail] : mode === "전체" ? realPeople(team).map((t) => t.email) : selected;
    const assigneeEmails = baseAssignees.includes(currentUserEmail) ? baseAssignees : [...baseAssignees, currentUserEmail];
    const dueAt = explicitDueAt ?? parsed.dueAt;

    const recurrence: TaskRecurrence = recurrenceFreq
      ? recurrenceFreq === "daily"
        ? { freq: "daily" }
        : recurrenceFreq === "weekly"
          ? { freq: "weekly", weekday: recurrenceWeekday }
          : { freq: "monthly", day_of_month: recurrenceDom }
      : null;

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
        due_at: dueAt,
        position: Date.now(),
        origin_mode: mode,
        recurrence,
        recurrence_group_id: recurrence ? crypto.randomUUID() : null,
      })
      .select()
      .single();

    setSubmitting(false);
    if (error || !data) {
      notify("업무를 등록하지 못했습니다: " + (error?.message ?? "알 수 없는 오류"), "error");
      return;
    }
    onTaskCreated?.(data as Task);
    setText("");
    setUrgent(false);
    setQuickBadge(null);
    setDateStr("");
    setTimeStr("");
    setRecurrenceFreq(null);
    setRecurrenceOpen(false);
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
          const color = modeColorMap.get(m) || DEFAULT_MODE_COLOR[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => pickMode(m)}
              title={MODE_META[m].hint}
              style={active ? { backgroundColor: color + "22", color } : undefined}
              className={
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition " +
                (active ? "" : "bg-black/5 text-slate-500 hover:bg-black/10")
              }
            >
              <span className="relative inline-block h-2 w-2 shrink-0 overflow-hidden rounded-full" style={{ backgroundColor: color }}>
                {isAdmin && (
                  <input
                    type="color"
                    value={color}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onModeColorChange(m, e.target.value)}
                    className="absolute -left-1/2 -top-1/2 h-[200%] w-[200%] cursor-pointer opacity-0"
                    title={`${m} 업무 색상 변경 (관리자 전용)`}
                  />
                )}
              </span>
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
          onClick={() => setRecurrenceOpen((v) => !v)}
          title="반복 업무로 등록 (완료될 때마다 다음 회차가 자동으로 생깁니다)"
          className={
            "ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition " +
            (recurrenceFreq ? "bg-indigo-500 text-white" : "bg-black/5 text-slate-400 hover:bg-black/10")
          }
        >
          🔁 반복
        </button>
        <button
          type="button"
          onClick={() => setUrgent((v) => !v)}
          title="긴급 표시"
          className={
            "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition " +
            (urgent ? "bg-red-500 text-white" : "bg-black/5 text-slate-400 hover:bg-black/10")
          }
        >
          🔴 긴급
        </button>
      </div>

      {recurrenceOpen && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-indigo-50/60 p-1.5">
          {(["daily", "weekly", "monthly"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setRecurrenceFreq((prev) => (prev === f ? null : f))}
              className={
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold transition " +
                (recurrenceFreq === f ? "border-indigo-500 bg-indigo-500 text-white" : "border-slate-200 text-slate-500 hover:border-slate-300")
              }
            >
              {f === "daily" ? "매일" : f === "weekly" ? "매주" : "매월"}
            </button>
          ))}
          {recurrenceFreq === "weekly" && (
            <select
              value={recurrenceWeekday}
              onChange={(e) => setRecurrenceWeekday(Number(e.target.value))}
              className="rounded-lg border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px]"
            >
              {WEEKDAY_LABELS.map((d, idx) => (
                <option key={idx} value={idx}>
                  {d}요일
                </option>
              ))}
            </select>
          )}
          {recurrenceFreq === "monthly" && (
            <select
              value={recurrenceDom}
              onChange={(e) => setRecurrenceDom(Number(e.target.value))}
              className="rounded-lg border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px]"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </select>
          )}
          {!recurrenceFreq && <span className="text-[10px] text-indigo-400">주기를 골라주세요 - 이 업무가 완료될 때마다 다음 회차가 자동으로 새로 등록됩니다.</span>}
        </div>
      )}

      {mode === "공유" && showPicker && (
        <div className="flex flex-wrap gap-1 rounded-lg bg-black/[0.03] p-1.5">
          {team.length === 0 && <span className="px-1 text-[11px] opacity-40">태그할 팀원이 없습니다.</span>}
          {/* 담당자 후보에서도 공용 계정을 뺍니다. 고를 수 있으면 결국 골라집니다. */}
          {realPeople(team).map((m) => {
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

      <div className="flex flex-wrap items-center gap-1.5">
        {(["오늘", "내일", "이번주"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => pickQuickBadge(key)}
            className={
              "rounded-full px-2 py-0.5 text-[10px] font-semibold transition " +
              (quickBadge === key ? "bg-amber-500 text-white" : "bg-black/5 text-slate-500 hover:bg-black/10")
            }
          >
            {key}
          </button>
        ))}
        <input
          type="date"
          value={dateStr}
          onChange={(e) => {
            setDateStr(e.target.value);
            setQuickBadge(null);
          }}
          className="rounded-lg border border-black/10 bg-white/70 px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-300"
        />
        <input
          type="time"
          value={timeStr}
          onChange={(e) => {
            setTimeStr(e.target.value);
            setQuickBadge(null);
          }}
          className="rounded-lg border border-black/10 bg-white/70 px-1.5 py-0.5 text-[10px] outline-none focus:border-blue-300"
        />
        {(dateStr || timeStr) && (
          <button
            type="button"
            onClick={() => {
              setDateStr("");
              setTimeStr("");
              setQuickBadge(null);
            }}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            지우기
          </button>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="업무 입력 후 Enter (예: 내일까지 출석부 제출)"
          className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-[12px] outline-none focus:border-blue-300"
        />
        {explicitLabel ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-600">🗓 {explicitLabel}</span>
        ) : (
          preview?.deadlineLabel && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-600">🗓 {preview.deadlineLabel}</span>
          )
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
