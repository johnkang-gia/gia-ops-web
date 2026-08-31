"use client";

import { useState } from "react";
import type { EducationNews } from "@/lib/types";
import { friendlyError } from "@/lib/errorMessage";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "📰 교육뉴스란?",
    lines: [
      "AI가 웹 검색으로 국제학교·교육정책·교육 트렌드 관련 최신 소식을 찾아 정리합니다.",
      "매주 월·수요일 아침 자동으로 새 회차가 생성되고, \"지금 새로 만들기\"로 필요할 때 바로 새로 만들 수도 있습니다.",
    ],
  },
];

const CATEGORY_COLOR: Record<string, string> = {
  "국제학교 동향": "bg-blue-50 text-blue-700",
  "정책/규제": "bg-amber-50 text-amber-700",
  "교육 트렌드": "bg-teal-50 text-teal-700",
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export default function EducationNewsClient({ initialNews }: { initialNews: EducationNews[] }) {
  const [news, setNews] = useState<EducationNews[]>(initialNews);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialNews[0]?.id ?? null);

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/education-news", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "생성에 실패했습니다.");
      setNews((prev) => [json.row, ...prev]);
      setOpenId(json.row.id ?? null);
    } catch (err) {
      setError(friendlyError("교육뉴스를 새로 만들지 못했습니다.", err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-lg font-bold">📰 교육뉴스</h1>
          <p className="text-xs text-slate-500">
            AI가 웹 검색으로 국제학교·교육정책·교육 트렌드 관련 최신 소식을 찾아 정리합니다. 매주 월·수요일
            아침 자동으로 새 회차가 생성되고, 필요하면 지금 바로 새로 만들 수도 있습니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={generate}
            disabled={generating}
            className="shrink-0 rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {generating ? "검색 중..." : "✨ 지금 새로 만들기"}
          </button>
          <GuideButton title="교육뉴스 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      {news.length === 0 && !generating && (
        <p className="g-panel-solid p-6 text-center text-sm text-slate-400">
          아직 생성된 교육뉴스가 없습니다. &quot;지금 새로 만들기&quot;로 첫 회차를 만들어보세요.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {news.map((n) => {
          const open = openId === n.id;
          return (
            <div key={n.id} className="overflow-hidden g-panel-solid">
              <button
                onClick={() => setOpenId(open ? null : n.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-800">{n.title}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{formatDate(n.published_date)} · {n.items.length}건</div>
                </div>
                <span className="shrink-0 text-slate-300">{open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {n.summary && <p className="mb-3 text-sm text-slate-600">{n.summary}</p>}
                  <div className="flex flex-col gap-3">
                    {n.items.map((it, idx) => (
                      <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span
                            className={
                              "rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                              (CATEGORY_COLOR[it.category] ?? "bg-slate-100 text-slate-600")
                            }
                          >
                            {it.category}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">{it.headline}</span>
                        </div>
                        <p className="mb-1 text-xs text-slate-600">{it.body}</p>
                        {it.source_url && (
                          <a
                            href={it.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-500 hover:underline"
                          >
                            출처: {it.source_name || it.source_url}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
