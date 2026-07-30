"use client";

import { useState } from "react";
import type { Proposal } from "@/lib/types";

export default function AiManualClient() {
  const [targetDoc, setTargetDoc] = useState<"학부모용" | "실무자용">("실무자용");
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Proposal | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawText.trim()) return;
    setSubmitting(true);
    setError("");
    setResult(null);
    const res = await fetch("/api/ai/manual-draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rawText, targetDoc }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "제안을 만들지 못했습니다.");
      return;
    }
    setResult(data.proposal as Proposal);
    setRawText("");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">AI 매뉴얼</h1>
      <p className="mb-4 text-xs text-slate-500">
        규정이나 매뉴얼로 만들고 싶은 내용을 편하게 글로 쓰면, AI가 정식 문서 문구로 다듬고 관련
        법령까지 찾아서 제안을 만듭니다. 제안함의 &quot;AI매뉴얼제안&quot; 탭에서 검토·승인하면
        매뉴얼(운영계획안/실무자매뉴얼)에 바로 반영할 수 있습니다.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <label className="mb-3 flex flex-col gap-1 text-xs text-slate-500">
          어느 문서에 반영할까요?
          <select
            value={targetDoc}
            onChange={(e) => setTargetDoc(e.target.value as "학부모용" | "실무자용")}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="실무자용">실무자용 (GIA 실무자매뉴얼)</option>
            <option value="학부모용">학부모용 (GIA 운영계획안)</option>
          </select>
        </label>

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
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? "AI가 정리하는 중..." : "AI로 제안 만들기"}
        </button>
      </form>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-emerald-800">
            제안이 만들어졌습니다 - 제안함에 저장됐어요
          </div>
          <div className="mb-2 text-xs text-emerald-700">
            항목(카테고리): {result.category} · 대상 문서: {result.target_doc}
          </div>
          <div className="mb-3 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">
            {result.final_text}
          </div>
          {result.legal_basis && (
            <div className="mb-1 text-xs text-slate-600">관련 법령: {result.legal_basis}</div>
          )}
          <a
            href="/proposals"
            className="mt-2 inline-block text-xs font-semibold text-emerald-700 underline"
          >
            제안함에서 확인/승인하기 →
          </a>
        </div>
      )}
    </div>
  );
}
