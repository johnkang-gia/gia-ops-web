"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Adopted } from "@/lib/types";

function oneLine(text: string, maxLen = 70) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function AdoptedClient({ initialItems }: { initialItems: Adopted[] }) {
  const [items, setItems] = useState<Adopted[]>(initialItems);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("adopted-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adopted" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as Adopted;
            const stillPending = !next.publish;
            const exists = prev.some((it) => it.id === next.id);
            if (!stillPending) {
              return prev.filter((it) => it.id !== next.id);
            }
            const merged = exists
              ? prev.map((it) => (it.id === next.id ? next : it))
              : [next, ...prev];
            return [...merged].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function saveText(id: string) {
    const specificText = drafts[id];
    if (specificText === undefined) return;
    setBusyId(id);
    await fetch("/api/adopted/save-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, specificText }),
    });
    setBusyId(null);
  }

  async function publish(id: string) {
    setBusyId(id);
    if (drafts[id] !== undefined) {
      await fetch("/api/adopted/save-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, specificText: drafts[id] }),
      });
    }
    const res = await fetch("/api/adopted/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "발행하지 못했습니다.");
    }
  }

  async function runReview(id: string) {
    setBusyId(id);
    // 지금 수정 중인 내용 기준으로 검증받도록, 검증 전에 먼저 저장합니다.
    if (drafts[id] !== undefined) {
      await fetch("/api/adopted/save-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, specificText: drafts[id] }),
      });
    }
    const res = await fetch("/api/ai/review-adopted", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      alert(data.error || "AI 검증을 실행하지 못했습니다.");
      return;
    }
    if (data.item) {
      setItems((prev) => prev.map((it) => (it.id === id ? (data.item as Adopted) : it)));
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-lg font-bold">채택예정 ({items.length}건)</h1>
      <p className="mb-4 text-sm text-slate-500">
        제안함에서 승인한 내용이 여기로 옵니다. GIA 실정에 맞게 구체화한 뒤 &quot;발행&quot;을 눌러야
        매뉴얼(운영계획안/실무자매뉴얼)에 실제로 반영됩니다.
      </p>

      <div className="flex flex-col gap-2">
        {items.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            채택예정 항목이 없습니다.
          </div>
        )}
        {items.map((it) => {
          const expanded = expandedId === it.id;
          const draft = drafts[it.id] ?? it.specific_text;
          const busy = busyId === it.id;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  {it.target_doc}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {oneLine(it.specific_text)}
                </span>
                {it.review_count > 0 && (
                  <span className="hidden shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 sm:inline">
                    🔍 검증 {it.review_count}회
                  </span>
                )}
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{it.date}</span>
                <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <div className="mb-2 text-xs text-slate-400">항목(카테고리): {it.category}</div>

                  <label className="mb-3 flex flex-col gap-1 text-xs text-slate-500">
                    구체화한 최종 내용(직접 수정 가능 - 발행 시 이 내용이 매뉴얼에 반영됩니다)
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      rows={4}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>

                  <dl className="mb-3 flex flex-col gap-2">
                    {[
                      ["AI 작성 가이드(구체화할 때 참고)", it.guide],
                      ["AI 제안 원문(참고용, 수정 안 됨)", it.ai_original],
                      ["관련법령/근거", it.legal_basis],
                      ["관련법령 요약", it.legal_summary],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-slate-400">{label}</dt>
                          <dd className="whitespace-pre-wrap text-xs text-slate-600">{value}</dd>
                        </div>
                      ))}
                  </dl>

                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => saveText(it.id)}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      내용 저장
                    </button>
                    <button
                      onClick={() => runReview(it.id)}
                      disabled={busy}
                      className="rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-50 disabled:opacity-50"
                    >
                      {busy ? "처리 중..." : it.review_count > 0 ? "🔍 다시 AI 검증" : "🔍 AI 검증"}
                    </button>
                    <button
                      onClick={() => publish(it.id)}
                      disabled={busy}
                      className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                    >
                      발행
                    </button>
                  </div>

                  {it.review_result && (
                    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-semibold text-purple-800">
                          🔍 AI 비판적 검증 결과 ({it.review_count}회차)
                        </span>
                        {it.review_result.reviewedText !== draft && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            ⚠️ 검증 이후 내용이 수정됨 - 다시 검증해보세요
                          </span>
                        )}
                      </div>
                      {it.review_result.summary && (
                        <p className="mb-2 whitespace-pre-wrap text-purple-900">{it.review_result.summary}</p>
                      )}
                      {it.review_result.potentialComplaints?.length > 0 && (
                        <div className="mb-2">
                          <div className="font-semibold text-purple-700">🗣️ 예상 후속 문의/컴플레인</div>
                          {it.review_result.potentialComplaints.map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                          ))}
                        </div>
                      )}
                      {it.review_result.blindSpots?.length > 0 && (
                        <div className="mb-2">
                          <div className="font-semibold text-red-700">⚠️ 맹점/허점</div>
                          {it.review_result.blindSpots.map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                          ))}
                        </div>
                      )}
                      {it.review_result.suggestions?.length > 0 && (
                        <div>
                          <div className="font-semibold text-purple-700">💡 보완 제안</div>
                          {it.review_result.suggestions.map((line, i) => (
                            <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                          ))}
                        </div>
                      )}
                      {it.review_result.potentialComplaints?.length === 0 &&
                        it.review_result.blindSpots?.length === 0 &&
                        it.review_result.suggestions?.length === 0 && (
                          <p className="text-purple-700">특별히 지적할 점이 없다고 판단했습니다.</p>
                        )}
                      <p className="mt-2 text-purple-400">
                        위 내용을 반영해서 수정한 뒤 다시 검증을 받고, 충분히 보완됐다고 판단되면
                        발행하세요.
                      </p>
                    </div>
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
