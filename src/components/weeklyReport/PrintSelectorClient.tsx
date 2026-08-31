"use client";

import { useMemo, useState } from "react";
import type { Term, WrStudent } from "@/lib/types";

export default function PrintSelectorClient({ students, terms }: { students: WrStudent[]; terms: Term[] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [termId, setTermId] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q) || (s.name_en ?? "").toLowerCase().includes(q));
  }, [students, query]);

  return (
    <div className="g-panel-solid p-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="학생 이름 검색..."
        className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        size={8}
      >
        {filtered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.grade}학년 {s.class_name} - {s.name}
            {s.name_en ? ` (${s.name_en})` : ""}
          </option>
        ))}
      </select>
      <a
        href={selectedId ? `/api/weekly-report/pdf?studentId=${selectedId}` : undefined}
        target="_blank"
        rel="noreferrer"
        className={
          "inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white " +
          (selectedId ? "bg-wr-primary hover:bg-wr-primary-2" : "pointer-events-none bg-slate-300")
        }
      >
        🖨️ 발행된 리포트 PDF 열기
      </a>

      <div className="mt-4 border-t border-dashed border-slate-200 pt-3">
        <p className="mb-1.5 text-xs font-semibold text-slate-500">📚 학기 종합 PDF</p>
        <p className="mb-2 text-[11px] text-slate-400">
          학기를 고르면 그 학기 동안 발행된 모든 리포트를 과목별로 모아 한 번에 볼 수 있습니다.
        </p>
        <select
          value={termId}
          onChange={(e) => setTermId(e.target.value)}
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">학기 선택...</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.year} {t.term_type} ({t.status})
            </option>
          ))}
        </select>
        <a
          href={selectedId && termId ? `/api/weekly-report/pdf?studentId=${selectedId}&termId=${termId}&mode=term` : undefined}
          target="_blank"
          rel="noreferrer"
          className={
            "inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white " +
            (selectedId && termId ? "bg-indigo-500 hover:bg-indigo-600" : "pointer-events-none bg-slate-300")
          }
        >
          📚 학기 종합 PDF 열기
        </a>
      </div>
    </div>
  );
}
