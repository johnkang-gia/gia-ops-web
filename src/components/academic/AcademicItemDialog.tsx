"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ChecklistAnchor, ChecklistTemplate, Term } from "@/lib/types";
import { addDays, meetingDates, ANCHOR_LABEL } from "@/lib/academicChecklist";
import { anchorDate, repeatDates, REPEAT_LABEL, DOW_LABEL, type AnchorNode, type RepeatKind } from "@/lib/academicRepeat";

// 학사일정 항목 추가 팝업 (요청 ④⑤⑥)
//
// 담당자: "항목추가는 팝업창의 형태로 나오고, 특정한 날짜뿐만 아니라 기간, 그리고 이미
//         등록된 날짜를 기준으로 몇 주 전, 몇 일 전 등을 설정할 수 있게 해줘. 왜냐하면,
//         예를 들어 정규학기가 시작하기 2주 전까지 학생 반배정을 완료와 같이 계속해서
//         반복되는 작업들을 설정할 때, 특정 날짜가 아니라 학기를 기준으로 몇 주 전, 몇 일
//         전에 이루어져야 하는지 자동으로 표시가 되고 그것이 자동으로 업무로 등록되어서."
//
// 여기서 갈리는 것이 하나 있는데, 그게 이 화면의 핵심입니다.
//
//   · **이번 학기만** 하는 일 → 항목(academic_checklist_items)에 한 줄.
//   · **매 학기 되풀이**되는 일 → 규칙(academic_checklist_templates)에 한 줄. 그러면 학기가
//     바뀔 때마다 그 학기의 날짜로 항목이 저절로 다시 만들어집니다.
//
// "학기 시작 2주 전"은 날짜가 아니라 **규칙**입니다. 그래서 학기 기준을 고르면 자동으로
// 되풀이 쪽으로 넘어갑니다 - 규칙을 한 학기짜리로 적어두면 다음 학기에 아무 일도 안 일어나
// 결국 손으로 다시 적게 됩니다.

type Mode = "date" | "anchor" | "cycle";

export default function AcademicItemDialog({
  currentTerm,
  templateCount,
  templates = [],
  onClose,
  onSaved,
}: {
  currentTerm: Term | null;
  templateCount: number;
  /** 이미 있는 학사일정 규칙. 「다른 일정 기준」으로 고를 후보이자, 그 날짜를 푸는 근거입니다. */
  templates?: ChecklistTemplate[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("date");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");

  // 날짜 방식
  const [startDate, setStartDate] = useState("");
  const [useRange, setUseRange] = useState(false);
  const [endDate, setEndDate] = useState("");

  // 학기 기준 방식
  const [anchor, setAnchor] = useState<ChecklistAnchor>("term_start");
  /**
   * 기준으로 삼을 **다른 학사일정**. 빈 값이면 학기 시작·종료일 기준입니다.
   *
   * 학교 일은 사슬로 엮여 있습니다 - 「반배정 2주 전에 학생명단 확정」처럼요. 기준을 늘
   * 학기 시작으로만 적으면 반배정이 밀렸을 때 앞 일정은 옛 날짜에 남고, 사람이 두 날짜를
   * 따로 기억해야 합니다.
   */
  const [anchorTemplateId, setAnchorTemplateId] = useState<string>("");

  // 매년·매달·매주
  const [cycleKind, setCycleKind] = useState<RepeatKind>("month");
  const [cycleMonth, setCycleMonth] = useState(3);
  const [cycleDay, setCycleDay] = useState(1);
  const [cycleDow, setCycleDow] = useState(1);
  const [offsetUnit, setOffsetUnit] = useState<"week" | "day">("week");
  const [offsetValue, setOffsetValue] = useState(2);
  const [durationDays, setDurationDays] = useState(0);

  // 회의(요청 ⑤)
  const [needsMeeting, setNeedsMeeting] = useState(false);
  const [meetingCount, setMeetingCount] = useState(2);
  const [meetingInterval, setMeetingInterval] = useState(7);

  // 업무보드 연계
  const [autoTask, setAutoTask] = useState(true);
  const [taskLeadDays, setTaskLeadDays] = useState(7);

  // 반복(요청 ⑥). 학기 기준·주기 방식을 고르면 되풀이가 아닐 수 없습니다.
  const [recurring, setRecurring] = useState(false);
  const isRecurring = mode === "date" ? recurring : true;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const offsetDays = offsetUnit === "week" ? offsetValue * 7 : offsetValue;

  /** 이번 학기 안에서 이 주기가 걸리는 날들. 저장 전에 **몇 건이 생기는지** 보여줍니다. */
  const cycleDates = useMemo(() => {
    if (mode !== "cycle" || !currentTerm?.start_date || !currentTerm?.end_date) return [];
    return repeatDates(
      { kind: cycleKind, month: cycleMonth, day: cycleDay, dow: cycleDow },
      currentTerm.start_date,
      currentTerm.end_date,
    );
  }, [mode, cycleKind, cycleMonth, cycleDay, cycleDow, currentTerm]);

  /** 지금 설정대로라면 이번 학기에는 며칠이 되는지. 저장 전에 눈으로 확인시켜 줍니다. */
  const preview = useMemo(() => {
    if (mode === "date") {
      if (!startDate) return null;
      const end = useRange && endDate ? endDate : null;
      return { start: startDate, end };
    }
    if (mode === "cycle") {
      const first = cycleDates[0];
      if (!first) return null;
      return { start: first, end: durationDays > 0 ? addDays(first, durationDays) : null };
    }
    // 「다른 일정 기준」까지 풀어서 실제 날짜를 냅니다. 계산은 academicRepeat 한 곳에서만
    // 합니다 - 화면과 저장이 각자 세면 미리보기와 실제 날짜가 갈립니다.
    const me: AnchorNode = { id: "__new__", anchor, offsetDays, anchorTemplateId: anchorTemplateId || null };
    const nodes = new Map<string, AnchorNode>(
      templates.map((t) => [
        t.id,
        { id: t.id, anchor: t.anchor, offsetDays: t.offset_days, anchorTemplateId: t.anchor_template_id ?? null },
      ]),
    );
    nodes.set(me.id, me);
    const start = anchorDate(me, nodes, { start: currentTerm?.start_date ?? null, end: currentTerm?.end_date ?? null });
    if (!start) return null;
    return { start, end: durationDays > 0 ? addDays(start, durationDays) : null };
  }, [mode, startDate, useRange, endDate, anchor, anchorTemplateId, templates, currentTerm, offsetDays, durationDays, cycleDates]);

  const meetPreview = useMemo(() => {
    if (!needsMeeting || !preview) return [];
    // 회의는 **마감일**을 기준으로 잡습니다. 기간이 있으면 끝나는 날이 마감입니다.
    return meetingDates(preview.end ?? preview.start, meetingCount, meetingInterval);
  }, [needsMeeting, preview, meetingCount, meetingInterval]);

  async function save() {
    if (!title.trim()) {
      setErr("제목을 입력해주세요.");
      return;
    }
    if (mode === "date" && !startDate) {
      setErr("날짜를 골라주세요.");
      return;
    }
    if (mode === "anchor" && !preview) {
      // 왜 못 정했는지 갈라서 말합니다. 「저장 실패」만 띄우면 사람은 무엇을 고쳐야 할지
      // 모릅니다.
      setErr(
        anchorTemplateId
          ? "기준으로 고른 일정의 날짜를 정할 수 없습니다. 그 일정이 기준 사슬로 서로 물려 있는지 확인해주세요."
          : `진행중 학기에 ${ANCHOR_LABEL[anchor]}이 입력되어 있지 않습니다. 학기 관리에서 먼저 채워주세요.`,
      );
      return;
    }
    if (mode === "cycle" && cycleDates.length === 0) {
      setErr(
        currentTerm?.start_date && currentTerm?.end_date
          ? "이번 학기 안에 걸리는 날이 없습니다. 날짜·요일을 확인해주세요."
          : "진행중 학기에 시작일·종료일이 없어 주기를 계산할 수 없습니다. 학기 관리에서 먼저 채워주세요.",
      );
      return;
    }
    setBusy(true);
    setErr("");
    const supabase = createClient();

    try {
      if (isRecurring) {
        // 매 학기 되풀이 → 규칙으로 저장합니다. 다음 학기에도 저절로 생깁니다.
        //
        // 날짜 방식으로 적었는데 되풀이를 켠 경우: 그 날짜를 이번 학기 시작일 기준
        // "며칠 전"으로 되바꿔 규칙으로 만듭니다. 사람은 날짜로 생각하고 규칙은 상대값이라야
        // 다음 학기에 쓸모가 있기 때문입니다.
        let ruleAnchor = anchor;
        let ruleOffset = offsetDays;
        if (mode === "cycle") {
          // 주기 방식은 학기 기준을 쓰지 않습니다. 칸은 기본값으로 두고 repeat_* 만 씁니다.
          ruleAnchor = "term_start";
          ruleOffset = 0;
        } else if (mode === "date") {
          const base = currentTerm?.start_date;
          if (!base) {
            setErr("진행중 학기에 시작일이 없어 되풀이 규칙으로 만들 수 없습니다. 되풀이를 끄고 이번만 등록해주세요.");
            setBusy(false);
            return;
          }
          ruleAnchor = "term_start";
          ruleOffset = Math.round(
            (new Date(`${base}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000
          );
        }
        const dur =
          mode === "date" && useRange && endDate
            ? Math.max(
                0,
                Math.round(
                  (new Date(`${endDate}T12:00:00`).getTime() - new Date(`${startDate}T12:00:00`).getTime()) / 86400000
                )
              )
            : durationDays;

        const { error } = await supabase.from("academic_checklist_templates").insert({
          title: title.trim(),
          description: description.trim() || null,
          department: department.trim() || null,
          anchor: ruleAnchor,
          offset_days: ruleOffset,
          anchor_template_id: mode === "anchor" && anchorTemplateId ? anchorTemplateId : null,
          repeat_kind: mode === "cycle" ? cycleKind : "term",
          repeat_month: mode === "cycle" && cycleKind === "year" ? cycleMonth : null,
          repeat_day: mode === "cycle" && (cycleKind === "year" || cycleKind === "month") ? cycleDay : null,
          repeat_dow: mode === "cycle" && cycleKind === "week" ? cycleDow : null,
          duration_days: dur,
          needs_meeting: needsMeeting,
          meeting_count: meetingCount,
          meeting_interval_days: meetingInterval,
          auto_task: autoTask,
          task_lead_days: taskLeadDays,
          recurring: true,
          sort_order: templateCount,
        });
        if (error) throw error;
        onSaved(
          mode === "cycle"
            ? `${REPEAT_LABEL[cycleKind]} 되풀이로 등록했습니다. 이번 학기에는 ${cycleDates.length}번 걸립니다.`
            : "매 학기 되풀이되는 일로 등록했습니다. 화면을 새로 고치면 이번 학기 날짜로 항목이 생깁니다.",
        );
      } else {
        // 이번 학기만 → 항목 한 줄.
        const { data, error } = await supabase
          .from("academic_checklist_items")
          .insert({
            title: title.trim(),
            description: description.trim() || null,
            department: department.trim() || null,
            due_date: preview!.start,
            end_date: preview!.end,
            term_id: currentTerm?.id ?? null,
          })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("항목을 만들지 못했습니다.");

        if (needsMeeting && meetPreview.length > 0) {
          const { error: mErr } = await supabase.from("academic_checklist_meetings").insert(
            meetPreview.map((m) => ({
              item_id: data.id,
              term_id: currentTerm?.id ?? null,
              seq: m.seq,
              meet_date: m.date,
              title: `${title.trim()} ${m.seq}차 회의`,
            }))
          );
          if (mErr) throw mErr;
        }
        onSaved(needsMeeting ? `등록했습니다. 회의 ${meetPreview.length}번도 함께 잡았습니다.` : "등록했습니다.");
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-auto rounded-2xl bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <b className="text-base text-slate-800">📅 학사일정 항목 추가</b>
          <button onClick={onClose} className="rounded px-2 text-slate-400 hover:text-slate-700">✕</button>
        </div>

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="무슨 일인가요? (예: 학생 반배정 완료)"
          className="mb-2 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
        />
        <div className="mb-3 flex gap-2">
          <input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="담당 부서(선택)"
            className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="설명(선택)"
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
        </div>

        {/* 언제 ─────────────────────────────────────────────── */}
        <div className="mb-2 flex gap-1.5">
          {(
            [
              ["date", "📆 날짜로"],
              ["anchor", "🎯 학기·다른 일정 기준"],
              ["cycle", "🔁 매년·매달·매주"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-bold " +
                (mode === m ? "bg-slate-800 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "date" ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <label className="flex items-center gap-1 text-[11px] text-slate-600">
                <input type="checkbox" checked={useRange} onChange={(e) => setUseRange(e.target.checked)} />
                기간으로
              </label>
              {useRange && (
                <>
                  <span className="text-xs text-slate-400">~</span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                </>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              걸쳐 있는 일은 <b>기간</b>으로 적어주세요. 하루로 적으면 시작한 날부터 챙겨야 하는데 마지막 날에야
              눈에 띕니다.
            </p>
          </div>
        ) : (
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50/50 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {/* 기준. 학기 시작·종료일이거나, **이미 등록된 다른 학사일정**입니다.
                  뒤엣것을 고르면 그 일정이 밀릴 때 이 일정도 함께 밀립니다 - 사람이 두
                  날짜를 따로 기억하지 않아도 됩니다. */}
              <select
                value={anchorTemplateId ? `t:${anchorTemplateId}` : anchor}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith("t:")) {
                    setAnchorTemplateId(v.slice(2));
                  } else {
                    setAnchorTemplateId("");
                    setAnchor(v as ChecklistAnchor);
                  }
                }}
                className="max-w-48 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="term_start">학기 시작일</option>
                <option value="term_end">학기 종료일</option>
                {templates.length > 0 && (
                  <optgroup label="다른 학사일정">
                    {templates.map((t) => (
                      <option key={t.id} value={`t:${t.id}`}>
                        {t.title}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <input
                type="number"
                min={0}
                value={offsetValue}
                onChange={(e) => setOffsetValue(Math.max(0, Number(e.target.value) || 0))}
                className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <select
                value={offsetUnit}
                onChange={(e) => setOffsetUnit(e.target.value as "week" | "day")}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              >
                <option value="week">주</option>
                <option value="day">일</option>
              </select>
              <span className="text-slate-500">전까지</span>
              <span className="mx-1 h-4 w-px bg-blue-200" />
              <span className="text-slate-500">기간</span>
              <input
                type="number"
                min={0}
                value={durationDays}
                onChange={(e) => setDurationDays(Math.max(0, Number(e.target.value) || 0))}
                className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-500">일</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-blue-700">
              날짜가 아니라 <b>규칙</b>입니다. 학기가 바뀌면 그 학기 날짜로 저절로 다시 만들어집니다 —
              그래서 이 방식은 항상 <b>매 학기 되풀이</b>로 저장됩니다.
              {anchorTemplateId && " 기준 일정이 밀리면 이 일정도 따라 밀립니다."}
            </p>
          </div>
        )}

        {mode === "cycle" && (
          <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/50 p-2.5">
            <div className="mb-2 flex gap-1">
              {(["year", "month", "week"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setCycleKind(k)}
                  className={
                    "rounded-lg px-2.5 py-1 text-xs font-bold " +
                    (cycleKind === k ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-white")
                  }
                >
                  {REPEAT_LABEL[k]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {cycleKind === "year" && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={cycleMonth}
                    onChange={(e) => setCycleMonth(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                  <span className="text-slate-500">월</span>
                </>
              )}
              {(cycleKind === "year" || cycleKind === "month") && (
                <>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={cycleDay}
                    onChange={(e) => setCycleDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                  />
                  <span className="text-slate-500">일</span>
                </>
              )}
              {cycleKind === "week" && (
                <select
                  value={cycleDow}
                  onChange={(e) => setCycleDow(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                >
                  {DOW_LABEL.map((d, i) => (
                    <option key={d} value={i}>
                      {d}요일
                    </option>
                  ))}
                </select>
              )}
              <span className="mx-1 h-4 w-px bg-indigo-200" />
              <span className="text-slate-500">기간</span>
              <input
                type="number"
                min={0}
                value={durationDays}
                onChange={(e) => setDurationDays(Math.max(0, Number(e.target.value) || 0))}
                className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-500">일</span>
            </div>
            {/* 몇 건이 생기는지 **저장 전에** 보여줍니다. 매주로 잘못 골라 스무 건이 한꺼번에
                생기면, 지우는 일이 만드는 일보다 훨씬 번거롭습니다. */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-indigo-700">
              {cycleDates.length > 0 ? (
                <>
                  이번 학기에 <b>{cycleDates.length}번</b> 걸립니다 — {cycleDates.slice(0, 4).join(" · ")}
                  {cycleDates.length > 4 && " …"}
                </>
              ) : currentTerm?.start_date && currentTerm?.end_date ? (
                "이번 학기 안에 걸리는 날이 없습니다."
              ) : (
                "진행중 학기에 시작일·종료일이 없어 계산할 수 없습니다."
              )}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              그 달에 없는 날(2월 31일)은 <b>그 달 마지막 날</b>로 당깁니다. 건너뛰면 그 달만 일이
              사라지는데, 사라진 것은 아무도 못 봅니다.
            </p>
          </div>
        )}

        {/* 회의 ─────────────────────────────────────────────── */}
        <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
          <input type="checkbox" checked={needsMeeting} onChange={(e) => setNeedsMeeting(e.target.checked)} />
          🗣 이 일에는 회의가 필요합니다
        </label>
        {needsMeeting && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <input
                type="number"
                min={1}
                max={12}
                value={meetingCount}
                onChange={(e) => setMeetingCount(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
                className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-600">번,</span>
              <input
                type="number"
                min={1}
                value={meetingInterval}
                onChange={(e) => setMeetingInterval(Math.max(1, Number(e.target.value) || 7))}
                className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-slate-600">일 간격으로</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-800">
              마지막 회의를 <b>마감일</b>에 두고 간격만큼 거슬러 잡습니다. 첫 모임에서 한 주 동안 누가 무엇을
              맡을지 나누고, 다음 모임에서 처리한 일과 결정한 일을 함께 봅니다.
            </p>
            {meetPreview.length > 0 && (
              <p className="mt-1 text-[11px] font-semibold text-amber-900">
                {meetPreview.map((m) => `${m.seq}차 ${m.date}`).join(" · ")}
              </p>
            )}
          </div>
        )}

        {/* 업무보드 · 되풀이 ─────────────────────────────────── */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-slate-200 p-2.5 text-xs">
          <label className="flex items-center gap-1.5 font-semibold text-slate-700">
            <input type="checkbox" checked={autoTask} onChange={(e) => setAutoTask(e.target.checked)} />
            업무보드에 자동 등록
          </label>
          <span className="flex items-center gap-1 text-slate-500">
            마감
            <input
              type="number"
              min={0}
              value={taskLeadDays}
              onChange={(e) => setTaskLeadDays(Math.max(0, Number(e.target.value) || 0))}
              className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
            일 전에
          </span>
          <label
            className={"flex items-center gap-1.5 font-semibold " + (mode === "anchor" ? "text-slate-400" : "text-slate-700")}
            title={mode === "anchor" ? "학기 기준은 규칙이라 항상 되풀이됩니다." : undefined}
          >
            <input
              type="checkbox"
              checked={isRecurring}
              disabled={mode === "anchor"}
              onChange={(e) => setRecurring(e.target.checked)}
            />
            🔁 매 학기 되풀이
          </label>
        </div>

        {preview && (
          <p className="mb-2 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white">
            이번 학기 → {preview.start}
            {preview.end ? ` ~ ${preview.end}` : ""}
            {autoTask && ` · 업무보드에 ${taskLeadDays}일 전 등록`}
          </p>
        )}
        {!preview && mode === "anchor" && (
          <p className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
            진행중 학기에 {ANCHOR_LABEL[anchor]}이 없어 이번 학기 날짜를 계산할 수 없습니다. 규칙은 저장되고,
            학기 날짜를 채우면 그때 항목이 생깁니다.
          </p>
        )}
        {err && <p className="mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">{err}</p>}

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="flex-1 rounded-lg bg-gia-navy px-3 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "저장 중…" : isRecurring ? "매 학기 되풀이로 등록" : "이번 학기에 등록"}
          </button>
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
