"use client";

import { useState } from "react";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type { Proposal, ManualDraft } from "@/lib/types";
import AiSourcePanel from "@/components/ai/AiSourcePanel";
import GuideButton from "@/components/common/GuideButton";
import { useCollapsedPanel } from "@/lib/useCollapsedPanel";
import CollapsedStrip from "@/components/common/CollapsedStrip";

const GUIDE_SECTIONS = [
  {
    title: "🤖 AI 매뉴얼 작성이란?",
    lines: [
      "메모나 초안을 입력하면 AI가 실무자매뉴얼(또는 운영계획안)용 문장으로 다듬어 초안을 만들어줍니다.",
      "생성된 초안은 제안함으로 보내져 검토 후 승인하면 정식 매뉴얼에 반영됩니다.",
    ],
  },
];

function oneLine(text: string, maxLen = 40) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// AI 호출 없이 키워드 겹침만으로 찾은 "관련 있어 보이는 과거 기록"입니다(요청 6번).
type RelatedRecord = { source: "incidents" | "meetings" | "manual_sections"; id: string; label: string; snippet: string };
const SOURCE_LABEL: Record<RelatedRecord["source"], string> = {
  incidents: "사건기록",
  meetings: "회의기록",
  manual_sections: "발행된 매뉴얼",
};

// 왼쪽(과거 작성 이력) · 가운데(입력폼) · 오른쪽(AI 제안) 3단 레이아웃입니다.
export default function AiManualClient({
  initialItems,
  currentUserEmail,
}: {
  initialItems: ManualDraft[];
  currentUserEmail: string;
}) {
  const [drafts] = useRealtimeTable<ManualDraft>("manual_drafts", initialItems);
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ proposals: Proposal[]; reason: string; relatedRecords: RelatedRecord[] } | null>(
    null
  );

  // 좁은 화면 사용자를 위해 목록/AI 패널을 접고 펼 수 있게 합니다(개인별 기억).
  const [leftCollapsed, setLeftCollapsed] = useCollapsedPanel("ai-manual", "list", currentUserEmail);
  const [rightCollapsed, setRightCollapsed] = useCollapsedPanel("ai-manual", "ai", currentUserEmail);
  const gridColsClass =
    leftCollapsed && rightCollapsed
      ? "lg:grid-cols-[40px_1fr_40px]"
      : leftCollapsed
        ? "lg:grid-cols-[40px_1fr_340px]"
        : rightCollapsed
          ? "lg:grid-cols-[300px_1fr_40px]"
          : "lg:grid-cols-[300px_1fr_340px]";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    const res = await fetch("/api/ai/manual-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawText }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "제안을 만들지 못했습니다.");
      return;
    }
    setResult({
      proposals: data.proposals as Proposal[],
      reason: data.reason || "",
      relatedRecords: (data.relatedRecords as RelatedRecord[]) || [],
    });
    setRawText("");
  }

  return (
    <div className={`grid grid-cols-1 gap-4 ${gridColsClass} lg:items-start`}>
      {/* 왼쪽: 과거 작성 이력 */}
      {leftCollapsed ? (
        <div className="order-2 hidden lg:order-1 lg:block">
          <CollapsedStrip label={`작성 이력 (${drafts.length})`} onExpand={() => setLeftCollapsed(false)} />
        </div>
      ) : (
      <div className="order-2 flex flex-col gap-2 lg:order-1">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-bold text-slate-700">작성 이력 ({drafts.length}건)</h1>
          <div className="flex items-center gap-1">
            <GuideButton title="AI 매뉴얼 작성 사용 가이드" sections={GUIDE_SECTIONS} />
            <button
              type="button"
              onClick={() => setLeftCollapsed(true)}
              title="접기"
              className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-50 lg:inline-block"
            >
              ‹
            </button>
          </div>
        </div>
        <div className="flex max-h-[75vh] flex-col gap-1.5 overflow-y-auto lg:max-h-[calc(100vh-8rem)]">
          {drafts.length === 0 && (
            <div className="rounded-lg bg-white p-3 text-xs text-slate-400 shadow-sm">
              아직 작성한 내용이 없습니다.
            </div>
          )}
          {drafts.map((d) => (
            <button
              key={d.id}
              onClick={() => setRawText(d.raw_text)}
              className="flex flex-col gap-0.5 g-panel-solid px-3 py-2 text-left shadow-sm hover:border-slate-300"
            >
              <span className="truncate text-xs font-medium">{oneLine(d.raw_text)}</span>
              <span className="text-[10px] text-slate-400">
                {d.target_doc ?? "분석 대기"} · {d.created_at.slice(0, 10)}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}

      {/* 가운데: 입력폼 */}
      <div className="order-1 lg:order-2">
        <p className="mb-3 text-xs text-slate-500">
          규정이나 매뉴얼로 만들고 싶은 내용을 편하게 글로 쓰면, AI가 정식 문서 문구로 다듬고 관련
          법령까지 찾아서 제안을 만듭니다. 학부모용 운영계획안과 실무자용 매뉴얼 중 어디에 반영할지도
          내용을 보고 AI가 자동으로 판단해요. 오른쪽에서 바로 검토·승인·발행까지 할 수 있습니다.
        </p>

        <form
          onSubmit={handleSubmit}
          className="g-panel-solid p-4 shadow-sm"
        >
          <label className="mb-3 flex flex-col gap-1 text-xs text-slate-500">
            내용 (두서없이 편하게 써도 됩니다)
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={8}
              placeholder="예: 현장학습 갈 때 인솔교사 비율은 학생 10명당 1명 이상으로 하고, 비상연락망은 출발 전에 학부모한테 미리 공지하면 좋겠음. 사고나면..."
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>

          {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !rawText.trim()}
            className="rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            {submitting ? "AI가 정리하는 중..." : "AI로 제안 만들기"}
          </button>
        </form>

        {result && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-emerald-800">
              제안이 만들어졌습니다 - 오른쪽 &quot;검토대기&quot;에서 확인하세요
              {result.proposals.length > 1 && " (학부모용 + 실무자용 두 곳에 반영 예정)"}
            </div>
            {result.reason && (
              <div className="mb-3 text-xs text-emerald-700">AI 판단 이유: {result.reason}</div>
            )}
            <div className="flex flex-col gap-2">
              {result.proposals.map((p) => (
                <div key={p.id} className="rounded-lg bg-white p-3">
                  <div className="mb-1 text-xs font-semibold text-slate-500">
                    {p.target_doc} · {p.category}
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-slate-700">{p.final_text}</div>
                  {p.legal_basis && (
                    <div className="mt-1 text-xs text-slate-500">관련 법령: {p.legal_basis}</div>
                  )}
                </div>
              ))}
            </div>

            {result.relatedRecords.length > 0 && (
              <div className="mt-3 border-t border-emerald-200 pt-3">
                <div className="mb-1.5 text-xs font-semibold text-emerald-800">
                  🔗 관련 있어 보이는 과거 기록
                </div>
                <div className="flex flex-col gap-1">
                  {result.relatedRecords.map((r) => (
                    <div key={`${r.source}-${r.id}`} className="rounded-lg bg-white px-3 py-2 text-xs">
                      <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {SOURCE_LABEL[r.source]}
                      </span>
                      <span className="font-medium text-slate-700">{r.label}</span>
                      {r.snippet && <span className="ml-1.5 text-slate-400">{r.snippet}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 오른쪽: AI 제안 */}
      {rightCollapsed ? (
        <div className="order-3 hidden lg:block">
          <CollapsedStrip label="AI 제안" onExpand={() => setRightCollapsed(false)} />
        </div>
      ) : (
        <div className="order-3 relative">
          <button
            type="button"
            onClick={() => setRightCollapsed(true)}
            title="접기"
            className="absolute -left-2 top-0 z-10 hidden rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-50 lg:inline-block"
          >
            ›
          </button>
          <AiSourcePanel source="manual" />
        </div>
      )}
    </div>
  );
}
