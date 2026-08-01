"use client";

import { useMemo, useState } from "react";
import type { WrStudent } from "@/lib/types";

export default function PrintSelectorClient({ students }: { students: WrStudent[] }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.name.toLowerCase().includes(q));
  }, [students, query]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
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
    </div>
  );
}
