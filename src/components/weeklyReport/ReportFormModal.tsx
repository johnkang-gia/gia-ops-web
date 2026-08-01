"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BadgeValue, EvalBadges, EvalCategory, WrReport, WrStudent } from "@/lib/types";
import { BADGE_OPTIONS, EVAL_CATEGORIES, EVAL_LABELS, initialBadges } from "@/lib/weeklyReport/badges";
import { getWeekRange } from "@/lib/weeklyReport/week";

type SubjectReportInfo = { current?: WrReport; previous?: WrReport; latest?: WrReport };

function buildSubjectMap(reports: WrReport[]): Record<string, SubjectReportInfo> {
  const { start } = getWeekRange();
  const bySubject: Record<string, WrReport[]> = {};
  for (const r of reports) {
    (bySubject[r.subject] ||= []).push(r);
  }
  const map: Record<string, SubjectReportInfo> = {};
  for (const [subject, list] of Object.entries(bySubject)) {
    const sorted = [...list].sort((a, b) => b.report_date.localeCompare(a.report_date));
    map[subject] = {
      current: sorted.find((r) => r.report_date >= start),
      previous: sorted.find((r) => r.report_date < start),
      latest: sorted[0],
    };
  }
  return map;
}

const TEMPLATE_KEY = "wr_teacherNoteTemplates";

type FormState = {
  academic: string;
  improvement: string;
  participation: string;
  behavior: string;
  social: string;
  teacherNote: string;
  evalBadges: EvalBadges;
};

const BLANK_FORM: FormState = {
  academic: "",
  improvement: "",
  participation: "",
  behavior: "",
  social: "",
  teacherNote: "",
  evalBadges: initialBadges(),
};

export default function ReportFormModal({
  student,
  reports,
  termId,
  userEmail,
  mode = "homeroom",
  mySubject,
  onClose,
  onSaved,
}: {
  student: WrStudent;
  reports: WrReport[]; // 이 학생의 이번 학기 전체 과목 리포트
  termId: string | null;
  userEmail: string;
  mode?: "homeroom" | "subject" | "admin" | "archive";
  mySubject: string; // '담임' 또는 과목명
  onClose: () => void;
  onSaved: (report: WrReport) => void;
}) {
  const subjectMap = useMemo(() => buildSubjectMap(reports), [reports]);
  const allSubjects = useMemo(() => {
    const set = new Set(Object.keys(subjectMap));
    set.add(mySubject);
    const others = [...set].filter((s) => s !== mySubject);
    return mode === "admin" || mode === "archive" ? [mySubject, ...others] : [mySubject, ...others];
  }, [subjectMap, mySubject, mode]);

  const [activeTab, setActiveTab] = useState(mySubject);
  const [formData, setFormData] = useState<FormState>(BLANK_FORM);
  const [existingReportId, setExistingReportId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatusMsg, setSaveStatusMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; text: string }[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isArchiveMode = mode === "archive";
  const isReadOnly = isArchiveMode || (mode !== "admin" && activeTab !== mySubject);

  useEffect(() => {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) {
      try {
        setTemplates(JSON.parse(saved));
      } catch {
        setTemplates([]);
      }
    }
  }, []);

  useEffect(() => {
    const info = subjectMap[activeTab];
    const target = isArchiveMode ? info?.latest : info?.current;
    if (target) {
      setFormData({
        academic: target.academic ?? "",
        improvement: target.improvement ?? "",
        participation: target.participation ?? "",
        behavior: target.behavior ?? "",
        social: target.social ?? "",
        teacherNote: target.teacher_note ?? "",
        evalBadges: target.eval_badges && Object.keys(target.eval_badges).length ? target.eval_badges : initialBadges(),
      });
      setExistingReportId(target.id);
    } else {
      setFormData(BLANK_FORM);
      setExistingReportId(null);
    }
    setIsDirty(false);
    setSaveStatusMsg("");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, subjectMap]);

  async function persist(status: "draft" | "published") {
    const supabase = createClient();
    const payload = {
      student_id: student.id,
      term_id: termId,
      subject: mode === "admin" || mode === "archive" ? activeTab : mySubject,
      academic: formData.academic,
      improvement: formData.improvement,
      participation: formData.participation,
      behavior: formData.behavior,
      social: formData.social,
      teacher_note: formData.teacherNote,
      eval_badges: formData.evalBadges,
      status,
      report_date: new Date().toISOString().slice(0, 10),
    };

    if (existingReportId) {
      const { data, error } = await supabase
        .from("wr_reports")
        .update(payload)
        .eq("id", existingReportId)
        .select()
        .single();
      if (!error && data) return data as WrReport;
      return null;
    }
    const { data, error } = await supabase.from("wr_reports").insert(payload).select().single();
    if (!error && data) {
      setExistingReportId((data as WrReport).id);
      return data as WrReport;
    }
    return null;
  }

  // 3초 자동 저장(임시저장 상태로)
  useEffect(() => {
    if (!isDirty || isReadOnly) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatusMsg("저장 중...");
    autoSaveTimer.current = setTimeout(async () => {
      const saved = await persist("draft");
      if (saved) {
        setSaveStatusMsg(`자동 저장됨: ${new Date().toLocaleTimeString("ko-KR")}`);
        setIsDirty(false);
        onSaved(saved);
      } else {
        setSaveStatusMsg("자동 저장 실패");
      }
    }, 3000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, isDirty, isReadOnly]);

  function updateField(key: keyof FormState, value: string) {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  }

  function toggleBadge(category: EvalCategory, value: BadgeValue) {
    if (isReadOnly) return;
    setFormData((prev) => {
      let current = [...(prev.evalBadges[category] || [])];
      current = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      if (current.length === 0) current = ["good"];
      return { ...prev, evalBadges: { ...prev.evalBadges, [category]: current } };
    });
    setIsDirty(true);
  }

  async function handleSave(status: "draft" | "published") {
    if (status === "published") {
      if (!formData.academic || !formData.improvement || !formData.participation || !formData.behavior || !formData.social) {
        alert("발행하려면 모든 항목을 작성해야 합니다. 작성 중이라면 임시저장을 이용해주세요.");
        return;
      }
    }
    setIsSaving(true);
    const saved = await persist(status);
    setIsSaving(false);
    if (saved) {
      onSaved(saved);
      onClose();
    } else {
      alert("저장에 실패했습니다.");
    }
  }

  function saveTemplate() {
    if (!formData.teacherNote.trim()) {
      alert("저장할 종합 의견을 먼저 작성해주세요.");
      return;
    }
    const next = [...templates, { id: Date.now().toString(), text: formData.teacherNote }];
    setTemplates(next);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next));
  }

  function deleteTemplate(id: string) {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next));
  }

  const previousReport = subjectMap[activeTab]?.previous;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-slate-200 bg-white p-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold">
              📄 리포트 열람 및 작성
              {existingReportId && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-400">
                  #{existingReportId.slice(0, 8)}
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {student.grade}학년 {student.class_name} - <strong className="text-blue-600">{student.name}</strong> 학생
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4">
          {allSubjects.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={
                "flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium " +
                (activeTab === tab ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500")
              }
            >
              {tab}
              {tab === mySubject && mode !== "admin" && !isArchiveMode && (
                <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] text-blue-600">내 권한</span>
              )}
              {isArchiveMode && <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-600">보관됨</span>}
            </button>
          ))}
        </div>

        <div className="p-4">
          {isReadOnly && (
            <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              현재 다른 과목({activeTab}) 리포트를 열람 중입니다. 읽기 전용입니다.
            </div>
          )}

          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            <strong className="text-slate-600">뱃지 평가 안내:</strong> 항목별로 해당하는 뱃지를 클릭해 복수 선택할 수 있습니다.
            <div className="mt-1.5 grid grid-cols-2 gap-1">
              <span>🌟 탁월: 매우 우수한 성취</span>
              <span>🟢 양호: 정상적인 성취(기본값)</span>
              <span>⚠️ 지도요망: 약간의 지도 필요</span>
              <span>🚨 집중지도: 집중 관리 필요</span>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {EVAL_CATEGORIES.map((cat) => (
              <div key={cat}>
                <label className="text-sm font-semibold text-slate-700">{EVAL_LABELS[cat].ko}</label>
                <div className="mb-1.5 mt-1.5 flex flex-wrap gap-1.5">
                  {BADGE_OPTIONS.map((b) => {
                    const checked = (formData.evalBadges[cat] || []).includes(b.value);
                    return (
                      <button
                        key={b.value}
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => toggleBadge(cat, b.value)}
                        className={
                          "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 " +
                          (checked ? "font-semibold" : "border-slate-300 bg-white text-slate-500")
                        }
                        style={checked ? { borderColor: b.border, backgroundColor: b.bg, color: b.color } : undefined}
                      >
                        <span>{b.emoji}</span>
                        {b.label}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  rows={3}
                  value={formData[cat]}
                  onChange={(e) => updateField(cat, e.target.value)}
                  disabled={isReadOnly}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </div>
            ))}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700">
                  교사 종합 의견 <em className="font-normal text-slate-400">(학부모 리포트에 표시됨)</em>
                </label>
                {!isReadOnly && (
                  <button
                    type="button"
                    onClick={saveTemplate}
                    className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                  >
                    🔖 현재 내용 상용구로 저장
                  </button>
                )}
              </div>
              {!isReadOnly && templates.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">
                      <span
                        className="cursor-pointer"
                        onClick={() => updateField("teacherNote", formData.teacherNote + (formData.teacherNote ? "\n" : "") + t.text)}
                      >
                        {t.text.length > 15 ? t.text.slice(0, 15) + "…" : t.text}
                      </span>
                      <button onClick={() => deleteTemplate(t.id)} className="text-indigo-300 hover:text-red-500">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                rows={4}
                placeholder="학부모님께 전달할 종합적인 코멘트를 작성해주세요."
                value={formData.teacherNote}
                onChange={(e) => updateField("teacherNote", e.target.value)}
                disabled={isReadOnly}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>
          </div>

          {showHistory && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
                🕐 지난 주 리포트 {previousReport ? `(${previousReport.report_date})` : ""}
              </h4>
              {previousReport ? (
                <div className="flex flex-col gap-1 text-slate-600">
                  <p><strong>학업:</strong> {previousReport.academic}</p>
                  <p><strong>보완:</strong> {previousReport.improvement}</p>
                  <p><strong>참여:</strong> {previousReport.participation}</p>
                  <p><strong>태도:</strong> {previousReport.behavior}</p>
                  <p><strong>교우:</strong> {previousReport.social}</p>
                  <p><strong>교사 의견:</strong> {previousReport.teacher_note}</p>
                </div>
              ) : (
                <p className="text-center text-slate-400">지난 주 리포트가 없습니다.</p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                취소
              </button>
              <span className="text-xs italic text-slate-400">{saveStatusMsg}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                {showHistory ? "과거 기록 닫기" : "지난주 기록 보기"}
              </button>
              {!isReadOnly && (
                <>
                  <button
                    disabled={isSaving}
                    onClick={() => handleSave("draft")}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    임시저장
                  </button>
                  <button
                    disabled={isSaving}
                    onClick={() => handleSave("published")}
                    className="rounded-lg bg-wr-primary px-3 py-2 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50"
                  >
                    발행하기
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
