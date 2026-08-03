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
  title,
  meta,
}: {
  students: WrStudent[];
  term: WrTerm | null;
  userEmail: string;
  mode: "homeroom" | "subject" | "admin" | "archive";
  subjectName: string; // '담임' 또는 실제 과목명
  emptyMessage?: string;
  title?: string; // 반별 위젯 등에서 카드 상단에 반 이름 + 진행률을 함께 보여줄 때 사용
  meta?: string; // 담임 이름 등 title 아래 보조 설명
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

  // reports를 학생마다 매번 다시 filter()하면(학생 수 x 리포트 수) 리포트가 쌓일수록 렌더링이
  // 느려집니다. 대신 reports가 바뀔 때 딱 한 번만 학생별로 묶어두고(Map), 이번 주 담임/과목
  // 리포트도 미리 찾아둡니다 - 아래 렌더링에서는 이 Map을 O(1)로 조회만 합니다.
  const reportsByStudent = useMemo(() => {
    const map = new Map<string, WrReport[]>();
    for (const r of reports) {
      const list = map.get(r.student_id);
      if (list) list.push(r);
      else map.set(r.student_id, [r]);
    }
    return map;
  }, [reports]);

  const currentWeekByStudent = useMemo(() => {
    const { start, end } = getWeekRange();
    const map = new Map<string, WrReport>();
    for (const r of reports) {
      if (r.subject !== subjectName || r.is_archived) continue;
      if (r.report_date < start || r.report_date > end) continue;
      if (!map.has(r.student_id)) map.set(r.student_id, r); // .find()와 동일하게 첫 매치만
    }
    return map;
  }, [reports, subjectName]);

  function reportsForStudent(studentId: string) {
    return reportsByStudent.get(studentId) ?? [];
  }

  function myWeekStatus(studentId: string) {
    return currentWeekByStudent.get(studentId)?.status ?? null; // 'draft' | 'published' | null(미작성)
  }

  function badgesForStudent(studentId: string) {
    return currentWeekByStudent.get(studentId)?.eval_badges ?? null;
  }

  function handleSaved(report: WrReport) {
    setReports((prev) => {
      const exists = prev.some((r) => r.id === report.id);
      return exists ? prev.map((r) => (r.id === report.id ? report : r)) : [...prev, report];
    });
  }

  // title이 주어지면(반별 위젯 등) 카드 상단에 반 이름 + "이번 주 담임 리포트 작성 X/Y명"
  // 진행률을 함께 보여줍니다 - 관리자가 각 반을 열어보지 않고도 한눈에 진행 상황을 파악할 수
  // 있습니다. loading 중에는 0/전체로 표시됩니다(잠깐 깜빡이는 정도라 별도 처리는 생략).
  const writtenCount = students.filter((s) => myWeekStatus(s.id) !== null).length;

  const grid = loading ? (
    <p className="text-sm text-slate-400">불러오는 중...</p>
  ) : students.length === 0 ? (
    <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
      {emptyMessage ?? "표시할 학생이 없습니다."}
    </p>
  ) : (
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
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 font-semibold leading-tight text-slate-800">
                <span className="block break-words">{student.name}</span>
                {student.name_en && (
                  <span className="block break-words text-[10px] font-normal leading-snug text-slate-400">{student.name_en}</span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400">
                {student.grade}학년 {student.class_name}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {status === "published" && <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-600">✅ 발행됨 Published</span>}
              {status === "draft" && <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-600">📝 임시저장 Draft</span>}
              {!status && <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">미작성 Not started</span>}
              {excellent && <span>🌟</span>}
              {warning && <span>⚠️</span>}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {title ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800">{title}</h3>
              {meta && <p className="text-[11px] text-slate-400">{meta}</p>}
            </div>
            {students.length > 0 && (
              <span
                className={
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                  (writtenCount === students.length
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-amber-50 text-amber-600")
                }
              >
                {writtenCount}/{students.length} 작성
              </span>
            )}
          </div>
          {grid}
        </div>
      ) : (
        grid
      )}

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
