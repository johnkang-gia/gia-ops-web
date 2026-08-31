"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BadgeValue, EvalBadges, EvalCategory, WrReport, WrStudent } from "@/lib/types";
import { BADGE_OPTIONS, EVAL_CATEGORIES, EVAL_LABELS, LEGACY_EVAL_LABELS, initialBadges } from "@/lib/weeklyReport/badges";
import { getPeriodRange, periodLabel } from "@/lib/weeklyReport/week";
import { useToast } from "@/components/common/ToastProvider";
import { useLang, useT } from "@/components/common/LanguageProvider";
import { classLabel } from "@/lib/i18nLabels";

type SubjectReportInfo = { current?: WrReport; previous?: WrReport; latest?: WrReport };

function buildSubjectMap(reports: WrReport[]): Record<string, SubjectReportInfo> {
  const { start } = getPeriodRange();
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

// 칸 이름을 DB 칼럼 이름과 **똑같이** 맞춥니다.
//
// 예전에는 teacher_note를 화면에서 teacherNote로 부르느라, 항목을 도는 코드와 종합 의견을
// 다루는 코드가 따로 있었습니다. 이름이 하나면 EVAL_CATEGORIES 한 바퀴로 셋 다 그려집니다.
type FormState = {
  academic: string;
  behavior: string;
  teacher_note: string;
  evalBadges: EvalBadges;
};

const BLANK_FORM: FormState = {
  academic: "",
  behavior: "",
  teacher_note: "",
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

  const notify = useToast();
  const t = useT();
  const { lang } = useLang();
  // 담임 리포트 탭은 과목명 자리에 "담임"이라는 값이 들어갑니다. DB에 저장되는 값이라 그대로
  // 두고, 화면에 보여줄 때만 영어로 바꿉니다(실제 과목명은 학교에서 정한 이름 그대로 씁니다).
  const tabLabel = (tab: string) => (tab === "담임" ? t("담임", "Homeroom") : tab);
  const [activeTab, setActiveTab] = useState(mySubject);
  const [formData, setFormData] = useState<FormState>(BLANK_FORM);
  const [existingReportId, setExistingReportId] = useState<string | null>(null);
  // 지금 고치고 있는 리포트의 report_date.
  //
  // **왜 필요한가:** 저장 열쇠가 (학생, 과목, report_date)입니다. 그런데 예전에는 저장할 때마다
  // report_date에 **그날 날짜**를 넣었습니다. 월요일에 쓰고 수요일에 이어 쓰면 열쇠가 달라져
  // upsert가 안 묶이고 **같은 기간 같은 과목 리포트가 두 줄**이 됩니다. 화면은 최근 것만
  // 보여주므로 월요일에 쓴 글이 조용히 사라진 것처럼 보이고, 통계의 '작성 건수'는 부풀려집니다.
  //
  // 주 단위일 때도 있던 문제인데, 2주로 늘리면 갈라질 수 있는 날이 7일에서 14일로 늘어납니다.
  // 그래서 **이미 있는 리포트를 고칠 때는 그 리포트의 날짜를 그대로** 쓰고, 새로 쓸 때만
  // 기간의 첫날로 시작합니다.
  const [existingReportDate, setExistingReportDate] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatusMsg, setSaveStatusMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; text: string }[]>([]);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 저장이 실패한 이유. 예전에는 "실패" 넉 자뿐이라 선생님이 무엇을 해야 할지 몰랐습니다.
  const [saveError, setSaveError] = useState<string | null>(null);
  // 어느 탭의 내용을 마지막으로 불러왔는지. 쓰는 중에 서버 값이 덮어쓰는 것을 막는 데 씁니다.
  const lastLoadedTab = useRef<string>("");

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
    // 쓰는 중에는 서버 값으로 덮어쓰지 않습니다.
    //
    // 자동 저장이 끝나면 onSaved → 부모 갱신 → subjectMap 변경 → 이 효과가 다시 돌면서
    // formData를 **서버에서 온 값으로 되돌립니다.** 저장이 오가는 그 1~2초 사이에 선생님이
    // 계속 타이핑하고 있었다면 그 글자들이 사라집니다. 네트워크가 느릴수록 더 많이 사라지고,
    // 사람은 자기가 오타를 낸 줄 압니다.
    //
    // 탭을 바꾼 경우에는 당연히 새로 불러와야 하므로, "같은 탭인데 아직 안 쓴 게 있는" 때만
    // 건너뜁니다.
    if (isDirty && lastLoadedTab.current === activeTab) return;
    lastLoadedTab.current = activeTab;

    const info = subjectMap[activeTab];
    const target = isArchiveMode ? info?.latest : info?.current;
    if (target) {
      setFormData({
        academic: target.academic ?? "",
        behavior: target.behavior ?? "",
        teacher_note: target.teacher_note ?? "",
        evalBadges: target.eval_badges && Object.keys(target.eval_badges).length ? target.eval_badges : initialBadges(),
      });
      setExistingReportId(target.id);
      setExistingReportDate(target.report_date);
    } else {
      setFormData(BLANK_FORM);
      setExistingReportId(null);
      setExistingReportDate(null);
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
      // 작성 시점 학생의 학년/반을 함께 저장합니다(연도-학기-학년-반 통합 검색용 스냅샷).
      class_id: student.class_id,
      grade: student.grade,
      subject: mode === "admin" || mode === "archive" ? activeTab : mySubject,
      // 3개 항목만 씁니다. improvement·participation·social은 **일부러 안 보냅니다** -
      // upsert는 보낸 칸만 고치므로, 예전에 쌓인 그 칸들의 글이 그대로 남습니다.
      // 빈 문자열로 덮으면 지난 기록이 사라집니다.
      academic: formData.academic,
      behavior: formData.behavior,
      teacher_note: formData.teacher_note,
      eval_badges: formData.evalBadges,
      status,
      // report_date는 **"쓴 날"이 아니라 "어느 기간의 리포트인가"** 입니다.
      //
      // 이 값이 저장 열쇠의 일부(학생, 과목, report_date)입니다. 예전처럼 그날 날짜를 넣으면,
      // 월요일에 쓰고 수요일에 이어 쓸 때 열쇠가 달라져 upsert가 안 묶이고 **같은 기간 같은
      // 과목 리포트가 두 줄**이 됩니다. 화면은 최근 것만 보여주므로 월요일에 쓴 글이 조용히
      // 사라진 것처럼 보이고, 통계의 작성 건수는 부풀려집니다.
      //
      //   · 이미 있는 리포트를 고치는 중이면 → 그 리포트의 날짜 그대로 (같은 줄을 고침)
      //   · 이 기간에 처음 쓰는 것이면    → 기간의 첫날 (다음에 이어 써도 같은 줄)
      //
      // 기간 첫날을 쓰면 오전 9시 전후의 UTC 문제도 함께 사라집니다 - 하루가 밀리든 말든
      // 같은 기간이면 같은 값이 나옵니다.
      report_date: existingReportDate ?? getPeriodRange().start,
    };

    // 같은 학생·과목·주(report_date) 리포트는 upsert로 저장합니다 - 담임/과목교사가 동시에
    // 같은 학생 리포트를 처음 열거나(또는 같은 사람이 두 탭으로) 거의 동시에 저장해도, DB의
    // 고유 제약(student_id, subject, report_date)이 하나로 합쳐줘서 중복 행이 생기지 않습니다.
    const { data, error } = await supabase
      .from("wr_reports")
      .upsert(payload, { onConflict: "student_id,subject,report_date" })
      .select()
      .single();
    if (!error && data) {
      setExistingReportId((data as WrReport).id);
      setExistingReportDate((data as WrReport).report_date);
      setSaveError(null);
      return data as WrReport;
    }

    // 실패한 이유를 반드시 남깁니다.
    //
    // 예전에는 그냥 `return null`이라 화면에 "자동 저장 실패" 넉 자만 떴습니다. 선생님은
    // 왜인지도, 다시 시도해야 하는지도 알 수 없고, 그대로 창을 닫으면 **쓴 글이 사라집니다.**
    // 오늘만 같은 종류(오류를 삼키는 코드)를 세 번 고쳤습니다 - 여기가 네 번째입니다.
    //
    // 특히 42P10("no unique or exclusion constraint matching the ON CONFLICT")은
    // (student_id, subject, report_date) 유일 인덱스가 없을 때 나옵니다. 그 경우엔
    // **모든 선생님의 모든 저장이 실패**하므로, 사람이 읽고 바로 알아챌 수 있게 적어둡니다.
    const msg = error?.message ?? "알 수 없는 오류";
    setSaveError(
      error?.code === "42P10"
        ? "저장 규칙(유일 인덱스)이 없어 저장되지 않습니다. 관리자에게 알려주세요. — 20260828000000_wr_reports_scale.sql"
        : msg
    );
    return null;
  }

  // 3초 자동 저장(임시저장 상태로)
  useEffect(() => {
    if (!isDirty || isReadOnly) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatusMsg(t("저장 중...", "Saving..."));
    autoSaveTimer.current = setTimeout(async () => {
      const saved = await persist("draft");
      if (saved) {
        setSaveStatusMsg(
          `${t("자동 저장됨", "Auto-saved")}: ${new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ko-KR")}`
        );
        setIsDirty(false);
        onSaved(saved);
      } else {
        setSaveStatusMsg(t("자동 저장 실패", "Auto-save failed"));
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
      if (!formData.academic.trim() || !formData.behavior.trim() || !formData.teacher_note.trim()) {
        notify(
          t(
            "발행하려면 모든 항목을 작성해야 합니다. 작성 중이라면 임시저장을 이용해주세요.",
            "All sections must be filled in before publishing. Use Save Draft if you are still writing."
          ),
          "error"
        );
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
      notify(t("저장에 실패했습니다.", "Could not save."), "error");
    }
  }

  function saveTemplate() {
    if (!formData.teacher_note.trim()) {
      notify(t("저장할 종합 의견을 먼저 작성해주세요.", "Write the comment first, then save it as a snippet."), "error");
      return;
    }
    const next = [...templates, { id: Date.now().toString(), text: formData.teacher_note }];
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
            <h3 className="flex flex-wrap items-center gap-2 text-base font-bold">
              📄 {t("리포트 열람 및 작성", "View / Write Report")}
              {/* 지금이 어느 기간인지 제목 옆에 적습니다. 2주에 한 번 쓰기로 바뀌었으므로,
                  "이번 것을 이미 썼는지"를 선생님이 날짜로 확인할 수 있어야 합니다. */}
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-600">
                {periodLabel()} ({t("2주", "2 weeks")})
              </span>
              {existingReportId && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-400">
                  #{existingReportId.slice(0, 8)}
                </span>
              )}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {classLabel(student.grade, student.class_name, lang)} &middot;{" "}
              <strong className="text-blue-600">
                {lang === "en" && student.name_en ? student.name_en : student.name}
                {student.name_en && (
                  <span className="font-normal"> ({lang === "en" ? student.name : student.name_en})</span>
                )}
              </strong>
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
              {tabLabel(tab)}
              {tab === mySubject && mode !== "admin" && !isArchiveMode && (
                <span className="rounded bg-blue-100 px-1 py-0.5 text-[10px] text-blue-600">{t("내 권한", "Mine")}</span>
              )}
              {isArchiveMode && (
                <span className="rounded bg-slate-200 px-1 py-0.5 text-[10px] text-slate-600">{t("보관됨", "Archived")}</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4">
          {isReadOnly && (
            <div className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {t(
                `현재 다른 과목(${tabLabel(activeTab)}) 리포트를 열람 중입니다. 읽기 전용입니다.`,
                `You are viewing another teacher's report for ${tabLabel(activeTab)}. It is read-only.`
              )}
            </div>
          )}

          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            <div className="text-slate-600">
              <strong>{t("뱃지 평가 안내", "Badge guide")}</strong>
              <div className="mt-0.5 font-normal text-slate-400">
                {t(
                  "항목별로 해당하는 뱃지를 클릭해 복수 선택할 수 있습니다.",
                  "Click the badges that apply to each item. You can pick more than one."
                )}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div>{t("🌟 탁월: 매우 우수한 성취", "🌟 Excellent: outstanding achievement")}</div>
              <div>{t("🟢 양호: 정상적인 성취(기본값)", "🟢 Good: normal achievement (default)")}</div>
              <div>{t("⚠️ 지도요망: 약간의 지도 필요", "⚠️ Needs attention: some guidance needed")}</div>
              <div>{t("🚨 집중지도: 집중 관리 필요", "🚨 Poor: requires close attention")}</div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {EVAL_CATEGORIES.map((cat) => (
              <div key={cat}>
                <label className="text-sm font-semibold text-slate-700">
                  {t(EVAL_LABELS[cat].ko, EVAL_LABELS[cat].en)}
                  <em className="ml-1.5 text-xs font-normal not-italic text-slate-400">{EVAL_LABELS[cat].hint}</em>
                </label>
                {/* 종합 의견 칸에만 상용구(자주 쓰는 문장) 단추가 붙습니다.
                    학부모께 그대로 나가는 글이라 매번 처음부터 쓰기가 가장 부담스러운 칸입니다. */}
                {cat === "teacher_note" && !isReadOnly && (
                  <>
                    <button
                      type="button"
                      onClick={saveTemplate}
                      className="float-right rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100"
                    >
                      🔖 {t("현재 내용 상용구로 저장", "Save as snippet")}
                    </button>
                    {templates.length > 0 && (
                      <div className="mb-1.5 mt-1.5 flex flex-wrap gap-1.5">
                        {templates.map((tpl) => (
                          <div
                            key={tpl.id}
                            className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600"
                          >
                            <span
                              className="cursor-pointer"
                              onClick={() =>
                                updateField("teacher_note", formData.teacher_note + (formData.teacher_note ? "\n" : "") + tpl.text)
                              }
                            >
                              {tpl.text.length > 15 ? tpl.text.slice(0, 15) + "…" : tpl.text}
                            </span>
                            <button onClick={() => deleteTemplate(tpl.id)} className="text-indigo-300 hover:text-red-500">
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
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
                          "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-60 " +
                          (checked ? "font-semibold" : "border-slate-300 bg-white text-slate-500")
                        }
                        style={checked ? { borderColor: b.border, backgroundColor: b.bg, color: b.color } : undefined}
                      >
                        <span>{b.emoji}</span>
                        {t(b.label, b.enLabel)}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  rows={cat === "teacher_note" ? 4 : 3}
                  value={formData[cat]}
                  onChange={(e) => updateField(cat, e.target.value)}
                  disabled={isReadOnly}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                />
              </div>
            ))}
          </div>

          {showHistory && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <h4 className="mb-2 flex items-center gap-1.5 font-semibold text-slate-700">
                🕐 {t("지난 기간 리포트", "Previous report")} {previousReport ? `(${previousReport.report_date})` : ""}
              </h4>
              {previousReport ? (
                <div className="flex flex-col gap-1 text-slate-600">
                  {EVAL_CATEGORIES.map((cat) =>
                    previousReport[cat] ? (
                      <p key={cat}>
                        <strong>{t(EVAL_LABELS[cat].ko, EVAL_LABELS[cat].en)}:</strong> {previousReport[cat]}
                      </p>
                    ) : null
                  )}
                  {/* 항목을 3개로 줄이기 전에 쓴 기록은 옛 칸에 글이 남아 있습니다.
                      새 서식에 없다고 감추면, 선생님이 지난 학기에 적어둔 관찰이 사라진 것처럼
                      보입니다. 있으면 '이전 서식'이라고 밝히고 그대로 보여줍니다. */}
                  {(Object.keys(LEGACY_EVAL_LABELS) as (keyof typeof LEGACY_EVAL_LABELS)[]).some(
                    (k) => previousReport[k]
                  ) && (
                    <div className="mt-1.5 border-t border-slate-200 pt-1.5">
                      <p className="mb-1 text-[11px] font-semibold text-slate-400">
                        {t("이전 서식(5항목)에 적힌 내용", "Written in the old 5-item format")}
                      </p>
                      {(Object.keys(LEGACY_EVAL_LABELS) as (keyof typeof LEGACY_EVAL_LABELS)[]).map((k) =>
                        previousReport[k] ? (
                          <p key={k}>
                            <strong>{t(LEGACY_EVAL_LABELS[k].ko, LEGACY_EVAL_LABELS[k].en)}:</strong> {previousReport[k]}
                          </p>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-center text-slate-400">{t("지난 기간 리포트가 없습니다.", "There is no report from the previous period.")}</p>
              )}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
                {t("취소", "Cancel")}
              </button>
              <span className="text-xs italic text-slate-400">{saveStatusMsg}</span>
              {/* 저장이 실패했으면 이유를 그 자리에서 보여줍니다. 선생님이 쓴 글을 잃지 않고
                  다시 시도하거나 관리자에게 알릴 수 있어야 합니다. */}
              {saveError && (
                <span className="rounded bg-red-50 px-2 py-1 text-[11px] font-semibold leading-snug text-red-600">
                  ⚠️ 저장 실패: {saveError}
                  <br />
                  <span className="font-normal">창을 닫지 마시고 잠시 뒤 다시 시도하거나, 내용을 따로 복사해 두세요.</span>
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                {showHistory ? t("과거 기록 닫기", "Hide history") : t("지난 기간 기록 보기", "Show previous period")}
              </button>
              {!isReadOnly && (
                <>
                  <button
                    disabled={isSaving}
                    onClick={() => handleSave("draft")}
                    className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                  >
                    {t("임시저장", "Save draft")}
                  </button>
                  <button
                    disabled={isSaving}
                    onClick={() => handleSave("published")}
                    className="rounded-lg bg-wr-primary px-3 py-2 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50"
                  >
                    {t("발행하기", "Publish")}
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
