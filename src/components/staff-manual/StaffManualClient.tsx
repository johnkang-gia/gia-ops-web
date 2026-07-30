"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection } from "@/lib/types";
import { toDisplayHtml, htmlToPlainText } from "@/lib/manualHtml";

export default function StaffManualClient({ initialItems }: { initialItems: ManualSection[] }) {
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
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">실무자매뉴얼</h1>
      <p className="mb-4 text-xs text-slate-500">
        학부모님의 문의나 컴플레인이 들어왔을 때 바로 검색해서 참고할 수 있는 실무자용
        응대·절차 매뉴얼입니다. 아래에서 검색하거나, AI로 아직 없는 예상 문의/컴플레인 항목을
        추천받을 수 있습니다. 직접 항목을 추가하거나 자세히 수정하려면{" "}
        <Link href="/manuals" className="font-semibold text-blue-600 underline">
          매뉴얼 편집 화면
        </Link>
        을 이용해주세요.
      </p>

      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-blue-800">
            ✨ AI로 예상 문의/컴플레인 제안받기
          </div>
          <button
            onClick={() => setHintOpen((v) => !v)}
            className="text-xs font-semibold text-blue-600 underline"
          >
            {hintOpen ? "힌트 입력 닫기" : "힌트 입력(선택)"}
          </button>
        </div>
        <p className="mb-2 text-xs text-blue-700">
          아직 매뉴얼에 없는 문의/컴플레인 유형을 AI가 예상해서 제안함에 만들어 둡니다. 회의에서
          GIA 실정에 맞게 수정하고 승인하면, AI가 다시 한번 깔끔하게 정리해서 채택예정에
          올려주고, 확인 후 발행하면 이 매뉴얼에 카테고리로 반영됩니다.
        </p>
        {hintOpen && (
          <textarea
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="예: 최근 학부모님들이 방과후 프로그램 관련 문의를 많이 하셨어요(선택 입력)"
            rows={2}
            className="mb-2 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-sm"
          />
        )}
        <button
          onClick={requestComplaints}
          disabled={generating}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {generating ? "AI가 예상하는 중..." : "제안 만들기"}
        </button>
        {genMsg && <p className="mt-2 text-xs text-blue-800">{genMsg}</p>}
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="🔍 항목명이나 내용으로 검색 (예: 환불, 통학차량, 알레르기)"
        className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

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
  );
}
