"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { WrReport, WrStudent, WrTerm } from "@/lib/types";
import { getWeekRange } from "@/lib/weeklyReport/week";
import ReportFormModal from "./ReportFormModal";

export default function StudentReportBoard({
  students,
  term,
  userEmail,
  mode,
  subjectName,
  emptyMessage,
}: {
  students: WrStudent[];
  term: WrTerm | null;
  userEmail: string;
  mode: "homeroom" | "subject" | "admin" | "archive";
  subjectName: string; // '담임' 또는 실제 과목명
  emptyMessage?: string;
}) {
  const [reports, setReports] = useState<WrReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WrStudent | null>(null);
  const studentIds = useMemo(() => students.map((s) => s.id), [students]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (studentIds.length === 0) {
        setReports([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const supabase = createClient();
      let query = supabase.from("wr_reports").select("*").in("student_id", studentIds);
      if (term) query = query.eq("term_id", term.id);
      const { data } = await query;
      if (!cancelled) {
        setReports((data as WrReport[] | null) ?? []);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentIds, term]);

  function reportsForStudent(studentId: string) {
    return reports.filter((r) => r.student_id === studentId);
  }

  function myWeekStatus(studentId: string) {
    const { start, end } = getWeekRange();
    const mine = reportsForStudent(studentId).filter((r) => r.subject === subjectName && !r.is_archived);
    const current = mine.find((r) => r.report_date >= start && r.report_date <= end);
    return current?.status ?? null; // 'draft' | 'published' | null(미작성)
  }

  function badgesForStudent(studentId: string) {
    const { start, end } = getWeekRange();
    const mine = reportsForStudent(studentId).filter((r) => r.subject === subjectName && !r.is_archived);
    const current = mine.find((r) => r.report_date >= start && r.report_date <= end);
    return current?.eval_badges ?? null;
  }

  function handleSaved(report: WrReport) {
    setReports((prev) => {
      const exists = prev.some((r) => r.id === report.id);
      return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
    });
  }

  if (loading) {
    return <p className="text-sm text-slate-400">불러오는 중...</p>;
  }

  if (students.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        {emptyMessage ?? "표시할 학생이 없습니다."}
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {students.map((student) => {
          const status = myWeekStatus(student.id);
          const badges = badgesForStudent(student.id);
          const allBadgeValues = badges ? Object.values(badges).flat() : [];
          const warning = allBadgeValues.includes("warning") || allBadgeValues.includes("bad");
          const excellent = allBadgeValues.includes("excellent");
          return (
            <button
              key={student.id}
              onClick={() => setSelected(student)}
              className={
                "flex flex-col gap-1.5 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md " +
                (warning ? "border-amber-300" : "border-slate-200")
              }
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">{student.name}</span>
                <span className="text-[11px] text-slate-400">
                  {student.grade}학년 {student.class_name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                {status === "published" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">✅ 발행됨</span>}
                {status === "draft" && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-600">📝 임시저장</span>}
                {!status && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">미작성</span>}
                {excellent && <span>🌟</span>}
                {warning && <span>⚠️</span>}
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <ReportFormModal
          student={selected}
          reports={reportsForStudent(selected.id)}
          termId={term?.id ?? null}
          userEmail={userEmail}
          mode={mode}
          mySubject={subjectName}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
