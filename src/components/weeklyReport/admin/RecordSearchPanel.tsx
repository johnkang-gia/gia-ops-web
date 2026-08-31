"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Term, WrClass, WrReport } from "@/lib/types";

type ResultRow = WrReport & { wr_students: { name: string } | null };

// "연도-학기-학년-반" 조합으로 그동안 쓰인 주간 학생 관찰기록을 통합 검색합니다. wr_reports에
// 작성 시점 학년/반 스냅샷(class_id/grade)이 함께 저장되어 있어서(마이그레이션으로 기존 기록도
// 소급 반영됨), 재학 이력을 따로 조인하지 않고 바로 필터링할 수 있습니다.
export default function RecordSearchPanel({ terms, classes }: { terms: Term[]; classes: WrClass[] }) {
  const [termId, setTermId] = useState("");
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<ResultRow[]>([]);

  const grades = useMemo(() => [...new Set(classes.map((c) => c.grade).filter((g): g is string => !!g))], [classes]);
  const classesInGrade = useMemo(
    () => (grade ? classes.filter((c) => c.grade === grade) : classes),
    [classes, grade]
  );

  async function handleSearch() {
    setLoading(true);
    setSearched(true);
    const supabase = createClient();
    let query = supabase
      .from("wr_reports")
      .select("*, wr_students(name)")
      .order("report_date", { ascending: false })
      .limit(100);
    if (termId) query = query.eq("term_id", termId);
    if (grade) query = query.eq("grade", grade);
    if (classId) query = query.eq("class_id", classId);
    const { data } = await query;
    setResults((data as ResultRow[] | null) ?? []);
    setLoading(false);
  }

  return (
    <div className="g-panel-solid p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-bold text-slate-700">🔍 연도-학기-학년-반 통합 검색</h2>
      <p className="mb-3 text-[11px] text-slate-400">
        조건을 고르지 않으면 전체에서 검색합니다. 최근 100건까지 표시됩니다.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <select
          value={termId}
          onChange={(e) => setTermId(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">전체 연도·학기</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.year} {t.term_type}
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => {
            setGrade(e.target.value);
            setClassId("");
          }}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">전체 학년</option>
          {grades.map((g) => (
            <option key={g} value={g}>
              {g}학년
            </option>
          ))}
        </select>
        <select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
        >
          <option value="">전체 반</option>
          {classesInGrade.map((c) => (
            <option key={c.id} value={c.id}>
              {c.grade}학년 {c.class_name}
            </option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="rounded-lg bg-wr-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-wr-primary-2 disabled:opacity-50"
        >
          {loading ? "검색 중..." : "검색"}
        </button>
      </div>

      {searched && (
        <div className="flex flex-col gap-1.5">
          {results.length === 0 && !loading && (
            <p className="rounded-lg bg-slate-50 p-3 text-center text-xs text-slate-400">조건에 맞는 기록이 없습니다.</p>
          )}
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/weekly-report/students/${r.student_id}`}
              className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs hover:bg-slate-50"
            >
              <span className="shrink-0 font-semibold text-slate-700">{r.wr_students?.name ?? "(알 수 없음)"}</span>
              <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-slate-500">{r.grade ?? "-"}학년</span>
              <span className="shrink-0 text-slate-400">{r.subject}</span>
              <span className="shrink-0 text-slate-400">{r.report_date}</span>
              <span
                className={
                  "shrink-0 rounded-full px-1.5 py-0.5 " +
                  (r.status === "published" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")
                }
              >
                {r.status === "published" ? "발행됨" : "임시저장"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
