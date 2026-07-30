"use client";

import { useState } from "react";
import type { Proposal } from "@/lib/types";

export default function AiManualClient() {
  const [rawText, setRawText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ proposals: Proposal[]; reason: string } | null>(null);

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
    setResult({ proposals: data.proposals as Proposal[], reason: data.reason || "" });
    setRawText("");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">AI 매뉴얼</h1>
      <p className="mb-4 text-xs text-slate-500">
        규정이나 매뉴얼로 만들고 싶은 내용을 편하게 글로 쓰면, AI가 정식 문서 문구로 다듬고 관련
        법령까지 찾아서 제안을 만듭니다. 학부모용 운영계획안과 실무자용 매뉴얼 중 어디에 반영할지도
        내용을 보고 AI가 자동으로 판단해요(예: 차량 탑승·아동 인계·환불 규정처럼 학부모도 알아야
        하는 내용이면 두 문서 모두에, 교사 채용 기준처럼 내부용이면 실무자매뉴얼에만). 제안함의
        &quot;AI매뉴얼제안&quot; 탭에서 검토·승인하면 매뉴얼에 바로 반영됩니다.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
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
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {submitting ? "AI가 정리하는 중..." : "AI로 제안 만들기"}
        </button>
      </form>

      {result && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-emerald-800">
            제안이 만들어졌습니다 - 제안함에 저장됐어요
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
          <a
            href="/proposals"
            className="mt-3 inline-block text-xs font-semibold text-emerald-700 underline"
          >
            제안함에서 확인/승인하기 →
          </a>
        </div>
      )}
    </div>
  );
}
