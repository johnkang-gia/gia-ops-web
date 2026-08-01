"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { WrStudent } from "@/lib/types";

export default function StudentsListClient({ students }: { students: WrStudent[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.grade ?? "").toLowerCase().includes(q) ||
        (s.class_name ?? "").toLowerCase().includes(q)
    );
  }, [students, query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름/학년/반으로 검색..."
        className="mb-3 w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-400">
            <tr>
              <th className="px-3 py-2">이름</th>
              <th className="px-3 py-2">학년</th>
              <th className="px-3 py-2">반</th>
              <th className="px-3 py-2">보호자 연락처</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link href={`/weekly-report/students/${s.id}`} className="font-medium text-blue-600 hover:underline">
                    {s.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-slate-500">{s.grade ?? "-"}</td>
                <td className="px-3 py-2 text-slate-500">{s.class_name ?? "-"}</td>
                <td className="px-3 py-2 text-slate-400">{s.parent_phone ?? "-"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                  검색 결과가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
