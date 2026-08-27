"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AppUser } from "@/lib/types";
import Pagination from "@/components/Pagination";

const PAGE_SIZE = 15;

// 학생 검색(StudentSearchClient)과 같은 패턴입니다 - 이름/이메일로 찾아서 클릭하면 그 교직원의
// 통합 프로필(/staff/[email])로 이동합니다.
export default function StaffSearchClient({ staff, homeroomMap = {} }: { staff: AppUser[]; homeroomMap?: Record<string, string> }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter((s) => (s.name ?? "").toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  }, [staff, query]);

  const [page, setPage] = useState(1);
  const pageItems = useMemo(() => results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [results, page]);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [query]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="이름 또는 이메일로 검색"
        className="mb-4 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {results.length === 0 && <p className="shrink-0 text-sm text-slate-400">검색 결과가 없습니다.</p>}

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {pageItems.map((s) => {
          const retired = !!s.leave_date;
          return (
            <Link
              key={s.email}
              href={`/staff/${encodeURIComponent(s.email)}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-gia-navy hover:bg-gia-gold-soft/10"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{s.name || "(이름 미입력)"}</span>
                <span className="text-xs text-slate-400">
                  {[s.department, s.position, homeroomMap[s.email.toLowerCase()] ? `담임 ${homeroomMap[s.email.toLowerCase()]}` : null]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </span>
                {retired && (
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">퇴사</span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">{s.email}</span>
            </Link>
          );
        })}
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
