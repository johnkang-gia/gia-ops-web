"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection, WrStudent } from "@/lib/types";
import { toDisplayHtml, htmlToPlainText } from "@/lib/manualHtml";
import StudentQuickLookup from "./StudentQuickLookup";
import GuideButton from "@/components/common/GuideButton";
import { useCollapsedPanel } from "@/lib/useCollapsedPanel";
import CollapsedStrip from "@/components/common/CollapsedStrip";

const GUIDE_SECTIONS = [
  {
    title: "📚 실무자매뉴얼이란?",
    lines: ["발행된 실무자용 매뉴얼을 검색·조회하는 화면입니다. 오른쪽에서 학생을 검색하면 그 학생의 인적사항과 관련 기록도 함께 확인할 수 있습니다."],
  },
];

export default function StaffManualClient({
  initialItems,
  students,
  currentUserEmail,
}: {
  initialItems: ManualSection[];
  students: WrStudent[];
  currentUserEmail: string;
}) {
  const [items, setItems] = useState<ManualSection[]>(initialItems);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 좁은 화면 사용자를 위해 좌(매뉴얼 검색)/우(학생 검색) 패널을 접고 펼 수 있게 합니다(개인별 기억).
  const [leftCollapsed, setLeftCollapsed] = useCollapsedPanel("staff-manual", "manual", currentUserEmail);
  const [rightCollapsed, setRightCollapsed] = useCollapsedPanel("staff-manual", "student", currentUserEmail);
  const gridColsClass =
    leftCollapsed && rightCollapsed
      ? "lg:grid-cols-[40px_40px]"
      : leftCollapsed
        ? "lg:grid-cols-[40px_1fr]"
        : rightCollapsed
          ? "lg:grid-cols-[1fr_40px]"
          : "lg:grid-cols-2";

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mb-3 shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">실무자매뉴얼</h1>
          <GuideButton title="실무자매뉴얼 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
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
          화면을 반으로 나눴습니다. 좁은 화면에서는 각 절반을 접어서 볼 수 있습니다(개인별 기억). */}
      <div className={`grid flex-1 grid-cols-1 gap-4 overflow-hidden ${gridColsClass}`}>
        {leftCollapsed ? (
          <div className="hidden lg:block">
            <CollapsedStrip label="매뉴얼 검색" onExpand={() => setLeftCollapsed(false)} />
          </div>
        ) : (
        <div className="flex flex-col overflow-hidden">
          <div className="mb-1.5 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setLeftCollapsed(true)}
              title="접기"
              className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-50 lg:inline-block"
            >
              ‹
            </button>
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
        )}

        {rightCollapsed ? (
          <div className="hidden lg:block">
            <CollapsedStrip label="학생 검색" onExpand={() => setRightCollapsed(false)} />
          </div>
        ) : (
        <div className="flex flex-col overflow-hidden border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <div className="mb-1.5 flex items-center justify-start">
            <button
              type="button"
              onClick={() => setRightCollapsed(true)}
              title="접기"
              className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-50 lg:inline-block"
            >
              ›
            </button>
          </div>
          <StudentQuickLookup students={students} />
        </div>
        )}
      </div>
    </div>
  );
}
