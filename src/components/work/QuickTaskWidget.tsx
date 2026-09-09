"use client";

import { realPeople } from "@/lib/taskAck";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import { parseTaskFromMessage } from "@/lib/parseTaskFromMessage";
import { deadlineLabel } from "@/lib/deadlineLabel";
import { nameFor } from "@/lib/teamName";
import type { Task, TaskModeColor, TaskRecurrence, TeamMember, WorkTag } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";
import AcademicItemDialog from "@/components/academic/AcademicItemDialog";
import type { ChecklistTemplate, Term } from "@/lib/types";

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
  prefillDay = null,
  prefillRange = null,
  onPrefillUsed,
  tags,
  onTagsChanged,
}: {
  department: string;
  team: TeamMember[];
  currentUserEmail: string;
  onTaskCreated?: (task: Task) => void;
  modeColorMap: Map<string, string>;
  isAdmin: boolean;
  onModeColorChange: (mode: TaskModeColor["mode"], color: string) => void;
  /**
   * 달력에서 누른 날짜(YYYY-MM-DD). 그 날 마감으로 미리 채웁니다.
   *
   * 날짜를 눌렀는데 아무 일도 안 일어나면 사람은 달력이 «보기만 하는 것»이라고 배웁니다.
   * 그러면 등록은 계속 위쪽 입력칸에서만 하고, 달력은 장식이 됩니다.
   */
  prefillDay?: string | null;
  /**
   * 달력에서 **끌어서** 고른 기간. 시작일과 끝날이 함께 옵니다.
   *
   * 며칠에 걸친 일을 하루짜리로만 등록하게 하면, 달력에는 끝나는 날에 점 하나만 찍히고
   * 「그 주가 통째로 잡혀 있다」는 사실이 어디에도 안 남습니다.
   */
  prefillRange?: { from: string; to: string } | null;
  onPrefillUsed?: () => void;
  /** 색 이름표. 달력에서 색만 보고 무슨 일인지 알아보라고 답니다. */
  tags: WorkTag[];
  /** 태그를 새로 만들었을 때. 위에서 목록을 다시 읽습니다. */
  onTagsChanged?: () => void;
}) {
  const notify = useToast();
  const [mode, setMode] = useState<Mode>("나");
  const [showPicker, setShowPicker] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [urgent, setUrgent] = useState(false);

  // ── 학사 등록 ───────────────────────────────────────────────────────────
  //
  // 되풀이되는 학교 일(학기시작 2주 전 안내문, 매달 안전점검)은 **업무가 아니라 일정**이라
  // 여기서 등록하면 학사일정에 들어가야 합니다. 지금까지는 업무보드에서 학사일정 화면으로
  // 넘어가야 했고, 넘어가야 하는 일은 대개 안 하게 됩니다 - 그래서 매번 손으로 업무를
  // 만들고, 손으로 만드는 일은 바쁜 주에 빠집니다.
  //
  // 규칙·날짜 계산은 학사일정 화면과 **같은 팝업**을 그대로 씁니다. 여기에 비슷한 창을 하나
  // 더 만들면 두 창이 서로 다른 답을 내기 시작합니다.
  const [showAcademic, setShowAcademic] = useState(false);
  const [academicTerm, setAcademicTerm] = useState<Term | null>(null);
  const [academicTemplates, setAcademicTemplates] = useState<ChecklistTemplate[]>([]);
  const [academicLoading, setAcademicLoading] = useState(false);

  async function openAcademic() {
    setShowAcademic(true);
    // 팝업이 쓸 것: 진행중 학기(날짜 계산의 바탕)와 이미 있는 규칙(기준으로 고를 후보).
    // 업무보드를 열 때마다 미리 읽지 않습니다 - 누르는 사람만 쓰는 자료입니다.
    if (academicTerm || academicLoading) return;
    setAcademicLoading(true);
    const supabase = createClient();
    const [{ data: terms, error: tErr }, { data: tpl }] = await Promise.all([
      supabase.from("terms").select("*").eq("is_current", true).limit(1),
      supabase.from("academic_checklist_templates").select("*").order("sort_order", { ascending: true }),
    ]);
    setAcademicLoading(false);
    if (tErr) {
      // 조용히 넘어가지 않습니다. 학기를 못 읽으면 「학기시작 2주 전」이 계산되지 않는데,
      // 팝업만 열리면 사람은 화면이 고장 난 줄 압니다.
      notify(`학기 정보를 읽지 못했습니다: ${tErr.message}`, "error");
      return;
    }
    setAcademicTerm(((terms as Term[] | null) ?? [])[0] ?? null);
    setAcademicTemplates((tpl as ChecklistTemplate[] | null) ?? []);
  }
  const [submitting, setSubmitting] = useState(false);

  // 오늘/내일/이번주 뱃지 + 정확한 날짜/시간 입력 (요청 #6)
  const [quickBadge, setQuickBadge] = useState<"오늘" | "내일" | "이번주" | null>(null);
  const [dateStr, setDateStr] = useState("");
  const [timeStr, setTimeStr] = useState("");
  /** 여러 날짜리의 시작일. 비어 있으면 하루짜리입니다. */
  const [startOn, setStartOn] = useState("");
  const [tagId, setTagId] = useState<string | null>(null);
  const [addingTag, setAddingTag] = useState(false);

  // 달력에서 날짜를 누르면 그 날로 채우고 입력칸에 커서를 둡니다.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!prefillDay) return;
    setDateStr(prefillDay);
    setStartOn("");
    setQuickBadge(null);
    inputRef.current?.focus();
    onPrefillUsed?.();
  }, [prefillDay, onPrefillUsed]);

  // 끌어서 고른 기간. 끝날이 마감이고 시작일이 따로 남습니다.
  useEffect(() => {
    if (!prefillRange) return;
    setStartOn(prefillRange.from);
    setDateStr(prefillRange.to);
    setQuickBadge(null);
    inputRef.current?.focus();
    onPrefillUsed?.();
  }, [prefillRange, onPrefillUsed]);

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
        // 시작일은 마감보다 뒤일 수 없습니다. 뒤면 달력에서 그 일정이 아예 안 보이는데
        // 오류도 안 나고 그냥 사라집니다.
        start_on: startOn && (!dueAt || startOn <= dueAt.slice(0, 10)) ? startOn : null,
        tag_id: tagId,
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
    setStartOn("");
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
        {/* 학사는 **반복 왼쪽**입니다. 되풀이되는 일을 등록하려던 사람이 🔁 반복을 누르기
            전에 「이건 학사일정이구나」를 먼저 보게 하려는 자리입니다. */}
        <button
          type="button"
          onClick={() => void openAcademic()}
          title="되풀이되는 학교 일정으로 등록합니다 (학기시작 2주 전 · 매년 · 매달 · 매주). 학사일정에 바로 반영됩니다."
          className="ml-auto flex items-center gap-1 rounded-full bg-black/5 px-2 py-1 text-[11px] font-bold text-slate-400 transition hover:bg-blue-100 hover:text-blue-700"
        >
          🎓 학사
        </button>
        <button
          type="button"
          onClick={() => setRecurrenceOpen((v) => !v)}
          title="반복 업무로 등록 (완료될 때마다 다음 회차가 자동으로 생깁니다)"
          className={
            "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition " +
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
        {/* 끌어서 고른 기간. **보여주고 지울 수 있어야** 합니다 - 잘못 끌었을 때 되돌릴
            자리가 없으면 등록 자체를 포기하게 됩니다. */}
        {startOn && (
          <span className="flex items-center gap-1 rounded-lg bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">
            {startOn.slice(5)} ~ {(dateStr || "").slice(5)} 기간
            <button type="button" onClick={() => setStartOn("")} className="text-teal-500 hover:text-red-500" title="하루짜리로">
              ✕
            </button>
          </span>
        )}
        {(dateStr || timeStr || startOn) && (
          <button
            type="button"
            onClick={() => {
              setDateStr("");
              setTimeStr("");
              setStartOn("");
              setQuickBadge(null);
            }}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            지우기
          </button>
        )}
      </div>

      {/* ── 색 이름표 ────────────────────────────────────────────────
          칸에 뜨는 것이 전부 회색 상자면 무슨 일인지 열어봐야 압니다. 색을 입히면 훑는
          것만으로 행사인지 정산인지 갈립니다. 하나만 고릅니다 - 여러 개를 붙이면 달력
          막대를 무슨 색으로 칠할지 다시 정해야 하고, 그 규칙을 아무도 기억 못 합니다. */}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-slate-400">태그</span>
        {tags.map((t) => {
          const on = tagId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTagId(on ? null : t.id)}
              style={on ? { backgroundColor: t.color, color: "#fff" } : { color: t.color, borderColor: t.color + "66" }}
              className={"rounded-full px-2 py-0.5 text-[10px] font-bold transition " + (on ? "" : "border bg-white hover:bg-slate-50")}
            >
              {t.name}
            </button>
          );
        })}
        {addingTag ? (
          <NewTagForm
            onDone={async (name, color) => {
              setAddingTag(false);
              if (!name.trim()) return;
              const { data, error } = await createClient()
                .from("work_tags")
                .insert({ name: name.trim(), color, created_by: currentUserEmail })
                .select()
                .single();
              // 조용히 넘기면 「눌렀는데 아무 일도 없다」가 됩니다.
              if (error || !data) return notify("태그를 만들지 못했습니다: " + (error?.message ?? "알 수 없는 이유"), "error");
              setTagId((data as WorkTag).id);
              onTagsChanged?.();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] text-slate-400 hover:border-slate-400"
          >
            ＋ 태그
          </button>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          ref={inputRef}
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

      {/* 학사일정 화면과 **같은 팝업**입니다. 여기서 등록한 것은 곧바로 학사일정에 들어가고,
          때가 되면 크론이 업무보드로 올려줍니다. */}
      {showAcademic && (
        <AcademicItemDialog
          currentTerm={academicTerm}
          templateCount={academicTemplates.length}
          templates={academicTemplates}
          onClose={() => setShowAcademic(false)}
          onSaved={(msg) => {
            notify(msg, "success");
            // 방금 만든 것이 다음에 열 때 「기준으로 고를 후보」에 나오도록 다시 읽습니다.
            setAcademicTerm(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * 새 태그 만들기 - 이름 하나와 색 하나.
 *
 * 관리 화면을 따로 두지 않은 이유: 태그는 **필요해지는 순간에** 만들게 해야 만들어집니다.
 * 「설정에 가서 미리 만들어두세요」로 두면 아무도 안 만들고, 다들 회색 상자로 남깁니다.
 */
function NewTagForm({ onDone }: { onDone: (name: string, color: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  return (
    <span className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-1.5 py-0.5">
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        title="색 고르기"
        className="h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
      />
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) onDone(name, color);
          if (e.key === "Escape") onDone("", color);
        }}
        onBlur={() => onDone(name, color)}
        placeholder="태그 이름"
        className="w-16 text-[10px] outline-none"
      />
    </span>
  );
}
