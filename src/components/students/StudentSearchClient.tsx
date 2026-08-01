"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { WrStudent } from "@/lib/types";

// 통합 학생 검색 - 이름으로 찾으면 동명이인이 있어도 학년/반/학번을 함께 보여줘서 정확한
// 학생을 고를 수 있습니다. 클릭하면 그 학생의 통합 프로필(/students/[id])로 이동합니다.
export default function StudentSearchClient({ students }: { students: WrStudent[] }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return students;
    return students.filter((s) => s.name.includes(q) || s.student_no.includes(q));
  }, [students, query]);

  return (
    <div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="학생 이름 또는 학번으로 검색"
        className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {results.length === 0 && <p className="text-sm text-slate-400">검색 결과가 없습니다.</p>}

      <div className="flex flex-col gap-1.5">
        {results.map((s) => (
          <Link
            key={s.id}
            href={`/students/${s.id}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-gia-navy hover:bg-gia-gold-soft/10"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">{s.name}</span>
              <span className="text-xs text-slate-400">
                {s.grade}학년 {s.class_name}반
              </span>
            </div>
            <span className="text-[11px] text-slate-400">{s.student_no}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
