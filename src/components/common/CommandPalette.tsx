"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import type { NavCategory } from "@/components/NavLinks";
import type { SearchResult } from "@/app/api/search/route";

const TYPE_ICON: Record<SearchResult["type"], string> = {
  student: "🧑‍🎓",
  incident: "📋",
  meeting: "💬",
  event: "🎉",
  task: "🗂️",
  document: "📁",
};

type QuickLink = { href: string; label: string; icon: string };

// UX 점검에서 나온 지적("Cmd+K 커맨드팔레트, 전역 keydown 리스너... 전혀 없음")을 보완합니다.
// 어느 화면에 있든 Cmd+K(맥)/Ctrl+K(윈도우)로 열리는 오버레이 하나로, (1) 메뉴 어디로든 바로
// 이동하고 (2) 기존 통합검색(GlobalSearchBar와 같은 /api/search)까지 한 곳에서 할 수
// 있습니다. 사이드바를 마우스로 훑지 않아도 되므로 키보드 위주로 일하는 사용자에게 특히
// 유용합니다.
export default function CommandPalette({
  categories,
  homeHref,
}: {
  categories: NavCategory[];
  homeHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [open]);

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
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const quickLinks = useMemo<QuickLink[]>(() => {
    const links: QuickLink[] = [{ href: homeHref, label: "홈", icon: "🏠" }];
    categories.forEach((cat) => {
      if (cat.href) links.push({ href: cat.href, label: cat.label, icon: cat.icon });
      cat.items?.forEach((item) => links.push({ href: item.href, label: `${cat.label} · ${item.label}`, icon: item.icon }));
    });
    return links;
  }, [categories, homeHref]);

  const filteredQuickLinks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return quickLinks.slice(0, 8);
    return quickLinks.filter((l) => l.label.toLowerCase().includes(q)).slice(0, 8);
  }, [quickLinks, query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-start justify-center bg-black/40 px-4 pt-24" onClick={() => setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="shell-entry-fade flex w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 메뉴 이동, 학생·사건·회의·행사·업무 검색..."
          className="w-full border-b border-slate-100 px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-96 overflow-y-auto p-1.5">
          {!query.trim() && (
            <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">바로가기</div>
          )}
          {filteredQuickLinks.map((l) => (
            <button
              key={l.href + l.label}
              onClick={() => go(l.href)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
            >
              <span className="shrink-0">{l.icon}</span>
              <span className="truncate">{l.label}</span>
            </button>
          ))}
          {query.trim() && (
            <>
              <div className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">검색 결과</div>
              {loading && <div className="px-2.5 py-2 text-xs text-slate-400">검색 중...</div>}
              {!loading && results.length === 0 && filteredQuickLinks.length === 0 && (
                <div className="px-2.5 py-2 text-xs text-slate-400">결과가 없습니다.</div>
              )}
              {!loading &&
                results.map((r) => (
                  <button
                    key={`${r.type}-${r.id}`}
                    onClick={() => go(r.href)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    <span className="shrink-0">{TYPE_ICON[r.type]}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.title}</span>{" "}
                      <span className="text-[11px] text-slate-400">{r.subtitle}</span>
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
        <div className="border-t border-slate-100 px-4 py-1.5 text-[10px] text-slate-400">
          ⌘K / Ctrl+K로 언제든 열 수 있어요 · Esc로 닫기
        </div>
      </div>
    </div>,
    document.body
  );
}
