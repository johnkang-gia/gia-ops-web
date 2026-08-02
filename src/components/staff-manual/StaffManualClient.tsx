"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection, WrStudent } from "@/lib/types";
import { toDisplayHtml, htmlToPlainText } from "@/lib/manualHtml";
import StudentQuickLookup from "./StudentQuickLookup";

export default function StaffManualClient({ initialItems, students }: { initialItems: ManualSection[]; students: WrStudent[] }) {
  const [items, setItems] = useState<ManualSection[]>(initialItems);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [hintOpen, setHintOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState("");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("staff-manual-sections-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_sections" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as ManualSection;
            if (next.target_doc !== "실무자용") {
              return prev.filter((it) => it.id !== next.id);
            }
            const exists = prev.some((it) => it.id === next.id);
            const merged = exists
              ? prev.map((it) => (it.id === next.id ? next : it))
              : [...prev, next];
            return [...merged].sort((a, b) => a.category.localeCompare(b.category));
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const haystack = (it.category + " " + htmlToPlainText(it.content)).toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query]);

  async function requestComplaints() {
    setGenerating(true);
    setGenMsg("");
    const res = await fetch("/api/ai/anticipate-complaints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hint }),
    });
    const data = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setGenMsg(`오류: ${data.error || "제안을 만들지 못했습니다."}`);
      return;
    }
    setGenMsg(
      data.created > 0
        ? `${data.created}개의 예상 문의/컴플레인 제안을 만들었습니다. 제안함에서 검토·승인해주세요.`
        : "이미 있는 항목과 겹치지 않는 새 제안이 없었습니다."
    );
    setHint("");
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-3 shrink-0">
        <h1 className="mb-1 text-lg font-bold">실무자매뉴얼</h1>
        <p className="text-xs text-slate-500">
          전화 응대 중 왼쪽에서 매뉴얼을, 오른쪽에서 학생 정보를 동시에 검색해서 볼 수 있습니다.
          직접 항목을 추가하거나 자세히 수정하려면{" "}
          <Link href="/manuals" className="font-semibold text-blue-600 underline">
            매뉴얼 편집 화면
          </Link>
          을 이용해주세요.
        </p>
      </div>

      {/* 좌: 매뉴얼 검색 / 우: 학생 검색+기록 - 전화 한 통 안에서 둘 다 동시에 열어볼 수 있게
          화면을 반으로 나눴습니다. */}
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
        <div className="flex flex-col overflow-hidden">
          <div className="mb-3 shrink-0 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-blue-800">✨ AI로 예상 문의/컴플레인 제안받기</div>
              <button onClick={() => setHintOpen((v) => !v)} className="text-[11px] font-semibold text-blue-600 underline">
                {hintOpen ? "힌트 입력 닫기" : "힌트 입력(선택)"}
              </button>
            </div>
            {hintOpen && (
              <textarea
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="예: 최근 학부모님들이 방과후 프로그램 관련 문의를 많이 하셨어요(선택 입력)"
                rows={2}
                className="mb-2 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
              />
            )}
            <button
              onClick={requestComplaints}
              disabled={generating}
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {generating ? "AI가 예상하는 중..." : "제안 만들기"}
            </button>
            {genMsg && <p className="mt-2 text-[11px] text-blue-800">{genMsg}</p>}
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 항목명이나 내용으로 검색 (예: 환불, 통학차량, 알레르기)"
            className="mb-3 w-full shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <div className="flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {filteredItems.length === 0 && (
                <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                  {items.length === 0
                    ? "아직 실무자매뉴얼 항목이 없습니다. 위에서 AI 제안을 받아보세요."
                    : "검색 결과가 없습니다."}
                </div>
              )}
              {filteredItems.map((s) => {
                const expanded = expandedId === s.id;
                return (
                  <div key={s.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <button
                      onClick={() => setExpandedId(expanded ? null : s.id)}
                      className="flex w-full items-center gap-2 px-4 py-3 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.category}</span>
                      <span className="shrink-0 text-xs font-bold text-blue-600">
                        {expanded ? "접기 ‹" : "보기 ›"}
                      </span>
                    </button>
                    {expanded && (
                      <div className="border-t border-slate-100 px-4 py-3">
                        {s.content ? (
                          <div
                            className="prose prose-sm max-w-none text-sm text-slate-700"
                            dangerouslySetInnerHTML={{ __html: toDisplayHtml(s.content) }}
                          />
                        ) : (
                          <p className="text-xs text-slate-400">(내용 없음)</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-col overflow-hidden border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <StudentQuickLookup students={students} />
        </div>
      </div>
    </div>
  );
}
