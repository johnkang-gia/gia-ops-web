"use client";

import { useEffect, useMemo, useState } from "react";
import { getHolidayPreset } from "@hyunbinseo/holidays-kr";
import { createClient } from "@/lib/supabase/client";
import type { ChecklistAnchor, ChecklistItem, ChecklistTemplate, Term } from "@/lib/types";
import { ANCHOR_LABEL, toDateStr } from "@/lib/academicChecklist";
import { friendlyError } from "@/lib/errorMessage";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📅 학사일정이란?",
    lines: [
      "학기 시작(또는 종료) 며칠 전에 무엇을 준비해야 하는지를 달력으로 한눈에 보여주는 화면입니다. 학기 시작 14일 전엔 학생명단 확정, 7일 전엔 교실 물품 점검처럼 D-day 기준으로 자동 계산됩니다.",
      "새 학기가 시작되면 이 페이지를 여는 순간 그 학기 기준으로 항목이 자동으로 다시 채워집니다 - 매번 새로 등록할 필요가 없습니다.",
    ],
  },
  {
    title: "✅ 체크와 메모",
    lines: [
      "체크박스는 직원 누구나 누를 수 있습니다. 완료 표시를 누르면 처리한 사람과 시각이 함께 남습니다.",
      "'메모'에 다음 담당자를 위한 인수인계 내용을 남겨두면, 다음 학기에 같은 항목이 다시 생성될 때 참고할 수 있습니다.",
    ],
  },
  {
    title: "🛠 반복 체크리스트 관리 (관리자 전용)",
    lines: [
      "관리자는 '반복 체크리스트 관리'에서 항목을 새로 만들거나(제목·담당·기준일 며칠 전) 수정·삭제할 수 있습니다. 기준일은 학기 시작일 또는 종료일 중 고를 수 있습니다.",
    ],
  },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dDayLabel(dueDate: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "D-day";
  if (diff > 0) return `D-${diff}`;
  return `D+${-diff}`;
}

const EMPTY_TEMPLATE_FORM = {
  title: "",
  description: "",
  department: "",
  anchor: "term_start" as ChecklistAnchor,
  offset_days: 14,
};

export default function AcademicCalendarClient({
  items: initialItems,
  templates: initialTemplates,
  currentTerm,
  isAdmin,
  currentUserEmail,
}: {
  items: ChecklistItem[];
  templates: ChecklistTemplate[];
  currentTerm: Term | null;
  isAdmin: boolean;
  currentUserEmail: string;
}) {
  const [items, setItems] = useState<ChecklistItem[]>(initialItems);
  const [templates, setTemplates] = useState<ChecklistTemplate[]>(initialTemplates);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-11
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [error, setError] = useState("");
  // 대한민국 공휴일 표시 - 사이드바 메인 달력(DateTimeCard)과 동일한 데이터 소스를 씁니다(요청:
  // "학사일정 달력에도 대한민국 휴일 표시 해줘"). 준비 업무 계획을 세울 때 공휴일도 함께
  // 보여야 실제로 일할 수 있는 날인지 가늠하기 쉽습니다.
  const [holidays, setHolidays] = useState<Record<string, string[]>>({});

  useEffect(() => {
    let cancelled = false;
    getHolidayPreset(String(viewYear))
      .then((preset) => {
        if (!cancelled) setHolidays(preset as Record<string, string[]>);
      })
      .catch(() => {
        if (!cancelled) setHolidays({});
      });
    return () => {
      cancelled = true;
    };
  }, [viewYear]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("academic-checklist-items")
      .on("postgres_changes", { event: "*", schema: "public", table: "academic_checklist_items" }, (payload) => {
        setItems((prev) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            return prev.filter((it) => it.id !== oldId);
          }
          const next = payload.new as ChecklistItem;
          const exists = prev.some((it) => it.id === next.id);
          return exists ? prev.map((it) => (it.id === next.id ? next : it)) : [...prev, next];
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("academic-checklist-templates")
      .on("postgres_changes", { event: "*", schema: "public", table: "academic_checklist_templates" }, (payload) => {
        setTemplates((prev) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id: string }).id;
            return prev.filter((t) => t.id !== oldId);
          }
          const next = payload.new as ChecklistTemplate;
          const exists = prev.some((t) => t.id === next.id);
          const merged = exists ? prev.map((t) => (t.id === next.id ? next : t)) : [...prev, next];
          return [...merged].sort((a, b) => a.sort_order - b.sort_order);
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const it of items) {
      const arr = map.get(it.due_date) ?? [];
      arr.push(it);
      map.set(it.due_date, arr);
    }
    return map;
  }, [items]);

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayKey = toDateStr(now);

  const termStartKey = currentTerm?.start_date ? currentTerm.start_date.slice(0, 10) : null;
  const termEndKey = currentTerm?.end_date ? currentTerm.end_date.slice(0, 10) : null;

  const monthItems = useMemo(() => {
    const monthPrefix = `${viewYear}-${pad2(viewMonth + 1)}`;
    return items.filter((it) => it.due_date.startsWith(monthPrefix)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  }, [items, viewYear, viewMonth]);

  const displayedItems = selectedDate ? monthItems.filter((it) => it.due_date === selectedDate) : monthItems;

  async function toggleDone(item: ChecklistItem) {
    const supabase = createClient();
    const patch = item.done
      ? { done: false, done_by: null, done_at: null }
      : { done: true, done_by: currentUserEmail, done_at: new Date().toISOString() };
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, ...patch } : it)));
    const { error: err } = await supabase.from("academic_checklist_items").update(patch).eq("id", item.id);
    if (err) {
      setItems((prev) => prev.map((it) => (it.id === item.id ? item : it)));
      setError(friendlyError("체크 상태를 바꾸지 못했습니다.", err));
    }
  }

  async function saveNote(item: ChecklistItem, note: string) {
    const supabase = createClient();
    setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, note } : it)));
    const { error: err } = await supabase.from("academic_checklist_items").update({ note }).eq("id", item.id);
    if (err) setError(friendlyError("메모를 저장하지 못했습니다.", err));
  }

  async function addQuickItem() {
    if (!quickTitle.trim() || !quickDate) {
      setError("제목과 날짜를 입력해주세요.");
      return;
    }
    const supabase = createClient();
    setError("");
    const { error: err } = await supabase.from("academic_checklist_items").insert({
      title: quickTitle.trim(),
      due_date: quickDate,
      term_id: currentTerm?.id ?? null,
    });
    if (err) {
      setError(friendlyError("항목을 추가하지 못했습니다.", err));
      return;
    }
    setQuickTitle("");
    setQuickDate("");
    setShowQuickAdd(false);
  }

  function startEditTemplate(t: ChecklistTemplate) {
    setEditingTemplateId(t.id);
    setTemplateForm({
      title: t.title,
      description: t.description ?? "",
      department: t.department ?? "",
      anchor: t.anchor,
      offset_days: t.offset_days,
    });
  }

  function cancelTemplateEdit() {
    setEditingTemplateId(null);
    setTemplateForm(EMPTY_TEMPLATE_FORM);
  }

  async function saveTemplate() {
    if (!templateForm.title.trim()) {
      setError("템플릿 제목을 입력해주세요.");
      return;
    }
    setSavingTemplate(true);
    setError("");
    const supabase = createClient();
    const payload = {
      title: templateForm.title.trim(),
      description: templateForm.description.trim() || null,
      department: templateForm.department.trim() || null,
      anchor: templateForm.anchor,
      offset_days: templateForm.offset_days,
    };
    const res = editingTemplateId
      ? await supabase.from("academic_checklist_templates").update(payload).eq("id", editingTemplateId)
      : await supabase.from("academic_checklist_templates").insert({ ...payload, sort_order: templates.length });
    setSavingTemplate(false);
    if (res.error) {
      setError(friendlyError("템플릿을 저장하지 못했습니다.", res.error));
      return;
    }
    cancelTemplateEdit();
  }

  async function toggleTemplateActive(t: ChecklistTemplate) {
    const supabase = createClient();
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, active: !x.active } : x)));
    const { error: err } = await supabase.from("academic_checklist_templates").update({ active: !t.active }).eq("id", t.id);
    if (err) {
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
      setError(friendlyError("템플릿 상태를 바꾸지 못했습니다.", err));
    }
  }

  async function deleteTemplate(t: ChecklistTemplate) {
    if (!confirm(`"${t.title}" 템플릿을 삭제할까요? 이미 생성된 학기별 항목은 남아있습니다.`)) return;
    const supabase = createClient();
    const { error: err } = await supabase.from("academic_checklist_templates").delete().eq("id", t.id);
    if (err) setError(friendlyError("템플릿을 삭제하지 못했습니다.", err));
  }

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">📅 학사일정</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {currentTerm
              ? `현재 학기: ${currentTerm.year} ${currentTerm.term_type}${currentTerm.start_date ? ` (${currentTerm.start_date} ~ ${currentTerm.end_date ?? "미정"})` : " (기간 미입력)"}`
              : "진행중인 학기가 없습니다 - 학기 관리에서 학기를 등록하면 자동으로 채워집니다."}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowQuickAdd((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            + 항목 추가
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowTemplateManager((v) => !v)}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              🛠 반복 체크리스트 관리
            </button>
          )}
          <GuideButton title="학사일정 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      {error && (
        <div className="mb-2 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
          <button onClick={() => setError("")} className="ml-2 font-semibold hover:underline">
            닫기
          </button>
        </div>
      )}

      {showQuickAdd && (
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <input
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="항목 제목 (예: 학예회 리허설)"
            className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <input
            type="date"
            value={quickDate}
            onChange={(e) => setQuickDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
          />
          <button onClick={addQuickItem} className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
            추가
          </button>
        </div>
      )}

      {showTemplateManager && (
        <div className="mb-3 shrink-0 rounded-xl border border-blue-200 bg-blue-50/40 p-3 shadow-sm">
          <div className="mb-2 text-xs font-bold text-blue-800">
            🛠 반복 체크리스트 템플릿 - 학기 시작(또는 종료) 며칠 전에 이 항목이 자동으로 만들어집니다
          </div>
          <div className="mb-2 flex flex-col gap-1.5 rounded-lg bg-white p-2.5">
            {templates.length === 0 && <p className="text-xs text-slate-400">아직 등록된 템플릿이 없습니다.</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-1.5 text-xs last:border-0">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={t.active} onChange={() => toggleTemplateActive(t)} />
                </label>
                <span className={"flex-1 font-semibold " + (t.active ? "text-slate-700" : "text-slate-300 line-through")}>{t.title}</span>
                {t.department && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{t.department}</span>}
                <span className="text-[11px] text-slate-400">
                  {ANCHOR_LABEL[t.anchor]} {t.offset_days}일 전
                </span>
                <button onClick={() => startEditTemplate(t)} className="text-blue-600 hover:underline">
                  수정
                </button>
                <button onClick={() => deleteTemplate(t)} className="text-red-500 hover:underline">
                  삭제
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-2.5">
            <div className="flex min-w-[9rem] flex-1 flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-500">제목</label>
              <input
                value={templateForm.title}
                onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="예: 학생명단 확정"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div className="flex min-w-[7rem] flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-500">담당(선택)</label>
              <input
                value={templateForm.department}
                onChange={(e) => setTemplateForm((f) => ({ ...f, department: e.target.value }))}
                placeholder="예: 초등부"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-500">기준일</label>
              <select
                value={templateForm.anchor}
                onChange={(e) => setTemplateForm((f) => ({ ...f, anchor: e.target.value as ChecklistAnchor }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              >
                <option value="term_start">학기 시작일</option>
                <option value="term_end">학기 종료일</option>
              </select>
            </div>
            <div className="flex w-24 flex-col gap-1">
              <label className="text-[10px] font-semibold text-slate-500">며칠 전</label>
              <input
                type="number"
                min={0}
                value={templateForm.offset_days}
                onChange={(e) => setTemplateForm((f) => ({ ...f, offset_days: Number(e.target.value) || 0 }))}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
            <button
              onClick={saveTemplate}
              disabled={savingTemplate}
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {editingTemplateId ? "수정 저장" : "+ 템플릿 추가"}
            </button>
            {editingTemplateId && (
              <button onClick={cancelTemplateEdit} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                취소
              </button>
            )}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full flex-col gap-3 overflow-hidden lg:flex-row">
          {/* 달력 */}
          <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:w-[60%]">
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <button
                onClick={() => {
                  const d = new Date(viewYear, viewMonth - 1, 1);
                  setViewYear(d.getFullYear());
                  setViewMonth(d.getMonth());
                  setSelectedDate(null);
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                ◀
              </button>
              <div className="text-sm font-bold text-slate-700">
                {viewYear}년 {viewMonth + 1}월
              </div>
              <button
                onClick={() => {
                  const d = new Date(viewYear, viewMonth + 1, 1);
                  setViewYear(d.getFullYear());
                  setViewMonth(d.getMonth());
                  setSelectedDate(null);
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
              >
                ▶
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-400">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : ""}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-7 gap-1 overflow-y-auto pt-1">
              {cells.map((day, idx) => {
                const dateKey = day ? `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}` : null;
                const dayItems = dateKey ? itemsByDate.get(dateKey) ?? [] : [];
                const isToday = dateKey === todayKey;
                const isTermStart = dateKey === termStartKey;
                const isTermEnd = dateKey === termEndKey;
                const isSelected = dateKey === selectedDate;
                const holidayNames = dateKey ? holidays[dateKey] : undefined;
                const isHoliday = !!holidayNames?.length;
                const col = idx % 7;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={!day}
                    onClick={() => dateKey && setSelectedDate((cur) => (cur === dateKey ? null : dateKey))}
                    title={holidayNames?.join(" · ")}
                    className={
                      "flex min-h-[3.2rem] flex-col items-start gap-0.5 rounded-lg border p-1 text-left align-top " +
                      (!day
                        ? "border-transparent"
                        : isSelected
                          ? "border-blue-400 bg-blue-50"
                          : isHoliday
                            ? "border-red-100 bg-red-50/40 hover:border-red-300"
                            : "border-slate-100 hover:border-slate-300")
                    }
                  >
                    {day && (
                      <>
                        <span
                          className={
                            "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold " +
                            (isToday
                              ? "bg-blue-600 text-white"
                              : isHoliday
                                ? "text-red-500"
                                : col === 0
                                  ? "text-red-400"
                                  : col === 6
                                    ? "text-blue-400"
                                    : "text-slate-500")
                          }
                        >
                          {day}
                        </span>
                        {isHoliday && (
                          <span className="w-full truncate text-[9px] font-bold text-red-500">{holidayNames!.join(" · ")}</span>
                        )}
                        {(isTermStart || isTermEnd) && (
                          <span className="text-[9px] font-bold text-emerald-600">{isTermStart ? "🏫 학기 시작" : "🏁 학기 종료"}</span>
                        )}
                        {dayItems.slice(0, 2).map((it) => (
                          <span
                            key={it.id}
                            className={
                              "w-full truncate rounded px-1 text-[9px] " +
                              (it.done ? "bg-slate-100 text-slate-400 line-through" : "bg-amber-100 text-amber-700")
                            }
                          >
                            {it.title}
                          </span>
                        ))}
                        {dayItems.length > 2 && <span className="text-[9px] text-slate-400">+{dayItems.length - 2}개 더</span>}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 목록 */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex shrink-0 items-center justify-between">
              <h2 className="text-sm font-bold text-slate-700">
                {selectedDate ? `📌 ${selectedDate}` : `${viewYear}년 ${viewMonth + 1}월 전체 (${monthItems.length}건)`}
              </h2>
              {selectedDate && (
                <button onClick={() => setSelectedDate(null)} className="text-[11px] text-blue-600 hover:underline">
                  전체 보기
                </button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {displayedItems.length === 0 ? (
                <p className="text-xs text-slate-400">해당 기간에 등록된 학사 업무가 없습니다.</p>
              ) : (
                <div className="flex flex-col divide-y divide-slate-100">
                  {displayedItems.map((it) => (
                    <ChecklistRow key={it.id} item={it} onToggle={() => toggleDone(it)} onSaveNote={(note) => saveNote(it, note)} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistRow({
  item,
  onToggle,
  onSaveNote,
}: {
  item: ChecklistItem;
  onToggle: () => void;
  onSaveNote: (note: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(item.note ?? "");

  return (
    <div className="py-2 text-xs">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={item.done} onChange={onToggle} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={"font-semibold " + (item.done ? "text-slate-400 line-through" : "text-slate-700")}>{item.title}</span>
            {item.department && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.department}</span>}
            <span className="font-mono text-[10px] text-slate-400">
              {item.due_date} · {dDayLabel(item.due_date)}
            </span>
          </div>
          {item.done && item.done_by && <div className="mt-0.5 text-[10px] text-emerald-600">✅ {item.done_by} 처리</div>}
          {item.description && <p className="mt-0.5 text-[11px] text-slate-500">{item.description}</p>}
          <button onClick={() => setNoteOpen((v) => !v)} className="mt-0.5 text-[10px] text-blue-500 hover:underline">
            {item.note ? "📝 메모 보기/수정" : "+ 메모 남기기"}
          </button>
          {noteOpen && (
            <div className="mt-1 flex gap-1">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="다음 담당자를 위한 메모"
                className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px]"
              />
              <button
                onClick={() => {
                  onSaveNote(noteDraft);
                  setNoteOpen(false);
                }}
                className="rounded-lg bg-gia-navy px-2 py-1 text-[10px] font-semibold text-white"
              >
                저장
              </button>
            </div>
          )}
          {!noteOpen && item.note && <p className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">📝 {item.note}</p>}
        </div>
      </div>
    </div>
  );
}
