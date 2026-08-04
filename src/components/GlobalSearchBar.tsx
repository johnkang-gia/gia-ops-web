"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchResult } from "@/app/api/search/route";

const TYPE_ICON: Record<SearchResult["type"], string> = {
  student: "🧑‍🎓",
  incident: "📋",
  meeting: "💬",
  event: "🎉",
  task: "🗂️",
  document: "📁",
};

// 학생/사건/회의/행사/업무/서류를 한 화면에서 바로 찾을 수 있는 통합 검색창입니다(요청) -
// 이 시스템은 전부 교내 관계자 전용이라 학부모 노출 걱정 없이 전체를 검색 대상으로 삼되,
// 교사 계정은 API가 알아서 학생 결과만 돌려줍니다(미들웨어의 화면 접근 제한과 동일한 기준).
export default function GlobalSearchBar({ compact = false }: { compact?: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => setResults(data.results ?? []))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function go(r: SearchResult) {
    setOpen(false);
    setQuery("");
    setResults([]);
    router.push(r.href);
  }

  return (
    <div ref={boxRef} className={"relative " + (compact ? "w-full" : "mb-3 w-full")}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="🔍 학생·사건·회의·행사·업무 검색..."
        className="w-full rounded-lg border border-[var(--shell-input-border,#e2e8f0)] bg-[var(--shell-input-bg,#f8fafc)] px-2.5 py-1.5 text-[12px] text-[var(--shell-text,#334155)] outline-none transition-colors placeholder:text-[var(--shell-text-muted,#94a3b8)] focus:border-blue-300 focus:bg-[var(--shell-bg,#ffffff)]"
      />
      {open && query.trim() && (
        <div className="shell-dropdown absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[var(--shell-border,#e2e8f0)] bg-[var(--shell-bg,#ffffff)] shadow-lg">
          {loading && <div className="px-3 py-2 text-[11px] text-[var(--shell-text-muted,#94a3b8)]">검색 중...</div>}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-[var(--shell-text-muted,#94a3b8)]">검색 결과가 없습니다.</div>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={`${r.type}-${r.id}`}
                onClick={() => go(r)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--shell-hover-bg,#f8fafc)]"
              >
                <span className="shrink-0">{TYPE_ICON[r.type]}</span>
                <span className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--shell-text,#334155)]">{r.title}</div>
                  <div className="truncate text-[10px] text-[var(--shell-text-muted,#94a3b8)]">{r.subtitle}</div>
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
