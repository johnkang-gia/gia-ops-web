"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Adopted, ProposalSourceContext } from "@/lib/types";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useToast } from "@/components/common/ToastProvider";
import { useConfirm } from "@/components/common/ConfirmProvider";

const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "📬 채택예정이란?",
    lines: [
      "제안함에서 승인한 내용이 여기로 옵니다. GIA 실정에 맞게 구체화한 뒤 발행해야 매뉴얼(운영계획안/실무자매뉴얼)에 실제로 반영됩니다.",
      "학부모용·실무자용이 함께 있는 카드는 \"통합발행\"으로 운영계획안·실무자매뉴얼에 한 번에 반영하세요. 운영계획안에 넣기엔 사소한 사건은 \"실무자발행\"으로 실무자매뉴얼에만 반영할 수 있습니다.",
      "발행 전 AI 검증 버튼으로 내용을 한 번 더 비판적으로 점검할 수 있고, 실수로 승인했거나 다시 검토하고 싶으면 \"되돌리기\"로 제안함으로 되돌릴 수 있습니다(발행 전까지만 가능).",
    ],
  },
];

const SOURCE_LABEL: Record<string, string> = {
  incidents: "📋 사건",
  events: "🎉 행사",
  meetings: "💬 회의",
  manual: "✨ AI매뉴얼",
  complaint: "🗣️ 예상 문의/컴플레인",
  system: "🧩 GIA시스템",
};

// 제안함(ProposalsClient)과 동일하게, 같은 원본 기록에서 학부모용/실무자용 두 건이 함께 채택된
// 경우 카드 하나로 묶어서 안의 탭으로 전환해서 봅니다(요청: "채택예정도 제안함처럼 깔끔하게").
const GROUPABLE_SOURCES = new Set(["incidents", "events", "meetings", "manual"]);
const TARGET_DOC_ORDER: Record<string, number> = { 학부모용: 0, 실무자용: 1 };

function oneLine(text: string, maxLen = 70) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

type CategoryTab = "all" | "incidents" | "events" | "meetings" | "manual" | "complaint" | "system";

type AdoptedGroup = {
  key: string;
  source: string;
  sourceId: string | null;
  date: string;
  variants: Adopted[];
};

function groupAdopted(items: Adopted[]): AdoptedGroup[] {
  const map = new Map<string, AdoptedGroup>();
  for (const it of items) {
    const groupKey =
      it.source_id && GROUPABLE_SOURCES.has(it.source) ? `${it.source}:${it.source_id}` : `${it.source}:id:${it.id}`;
    const existing = map.get(groupKey);
    if (existing) {
      existing.variants.push(it);
      if (it.date > existing.date) existing.date = it.date;
    } else {
      map.set(groupKey, { key: groupKey, source: it.source, sourceId: it.source_id, date: it.date, variants: [it] });
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.variants.sort((a, b) => (TARGET_DOC_ORDER[a.target_doc] ?? 9) - (TARGET_DOC_ORDER[b.target_doc] ?? 9));
  }
  groups.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return groups;
}

export default function AdoptedClient({
  initialItems,
  sourceContext,
}: {
  initialItems: Adopted[];
  sourceContext: Record<string, ProposalSourceContext>;
}) {
  const notify = useToast();
  const confirmAction = useConfirm();
  const [items, setItems] = useState<Adopted[]>(initialItems);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [activeVariant, setActiveVariant] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<CategoryTab>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [tab]);

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
      notify(data.error || "발행하지 못했습니다.", "error");
    }
  }

  // 요청: "발행에서 통합발행과 실무자발행 두가지로만 나눠줘 - 운영계획안에 들어가는 내용은
  // 자동으로 실무자매뉴얼에 들어가야 하기 때문이야". 학부모용/실무자용 두 변형이 함께 있는
  // 그룹은 각 변형이 이미 자기 문서에 맞는 문구를 갖고 있으므로, 통합발행은 그 둘을 한 번에
  // 발행합니다. 사건이 사소해서 운영계획안(학부모용)에는 넣지 않고 실무자매뉴얼에만 남기고
  // 싶은 경우를 위해 실무자발행(실무자용만 발행)도 따로 둡니다.
  async function publishGroup(g: AdoptedGroup, mode: "all" | "staffOnly") {
    const targets = mode === "all" ? g.variants : g.variants.filter((v) => v.target_doc === "실무자용");
    if (targets.length === 0) {
      notify("발행할 실무자용 항목이 없습니다.", "error");
      return;
    }
    setBusyId(g.key);
    for (const v of targets) {
      if (drafts[v.id] !== undefined) {
        await fetch("/api/adopted/save-text", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: v.id, specificText: drafts[v.id] }),
        });
      }
    }
    let hadError = false;
    for (const v of targets) {
      const res = await fetch("/api/adopted/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: v.id }),
      });
      if (!res.ok) {
        hadError = true;
        const data = await res.json().catch(() => ({}));
        notify(data.error || "발행하지 못했습니다.", "error");
      }
    }
    setBusyId(null);
    if (!hadError) {
      notify(
        mode === "all" ? "운영계획안·실무자매뉴얼 둘 다 발행했습니다." : "실무자매뉴얼에만 발행했습니다.",
        "success"
      );
    }
  }

  // 요청 4번: 실수로 승인했거나 다시 검토하고 싶을 때, 채택예정 항목을 제안함(검토대기)으로
  // 되돌립니다. 발행된 항목은 이미 매뉴얼에 합쳐져 들어갔으므로 되돌릴 수 없습니다.
  async function revert(it: Adopted, title: string) {
    if (
      !(await confirmAction(`사건: ${title}\n\n현재 내용:\n${it.specific_text || "(내용 없음)"}`, {
        title: "제안함(검토대기)으로 되돌릴까요?",
        confirmLabel: "되돌리기",
      }))
    )
      return;
    setBusyId(it.id);
    const res = await fetch("/api/adopted/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: it.id }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify(data.error || "되돌리지 못했습니다.", "error");
      return;
    }
    notify("제안함으로 되돌렸습니다.", "success");
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
      notify(data.error || "AI 검증을 실행하지 못했습니다.", "error");
      return;
    }
    if (data.item) {
      setItems((prev) => prev.map((it) => (it.id === id ? (data.item as Adopted) : it)));
    }
  }

  const allGroups = useMemo(() => groupAdopted(items), [items]);

  const categoryCounts = {
    all: allGroups.length,
    incidents: allGroups.filter((g) => g.source === "incidents").length,
    events: allGroups.filter((g) => g.source === "events").length,
    meetings: allGroups.filter((g) => g.source === "meetings").length,
    manual: allGroups.filter((g) => g.source === "manual").length,
    complaint: allGroups.filter((g) => g.source === "complaint").length,
    system: allGroups.filter((g) => g.source === "system").length,
  };
  const filteredGroups = tab === "all" ? allGroups : allGroups.filter((g) => g.source === tab);
  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const pageGroups = useMemo(
    () => filteredGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredGroups, page]
  );
  const CATEGORY_TABS: { key: CategoryTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "incidents", label: "📋 사건" },
    { key: "events", label: "🎉 행사" },
    { key: "meetings", label: "💬 회의" },
    { key: "manual", label: "✨ AI매뉴얼" },
    { key: "complaint", label: "🗣️ 예상 문의/컴플레인" },
    { key: "system", label: "🧩 GIA시스템" },
  ];

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">채택예정 ({allGroups.length}건)</h1>
          <GuideButton title="채택예정 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-sm text-slate-500">
          제안함에서 승인한 내용이 여기로 옵니다. GIA 실정에 맞게 구체화한 뒤 &quot;발행&quot;을 눌러야
          매뉴얼(운영계획안/실무자매뉴얼)에 실제로 반영됩니다.
        </p>

        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
          {CATEGORY_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition " +
                (tab === t.key
                  ? "border-gia-navy text-gia-navy"
                  : "border-transparent text-slate-400 hover:text-slate-600")
              }
            >
              {t.label} ({categoryCounts[t.key]})
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
          {filteredGroups.length === 0 && (
            <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
              {allGroups.length === 0
                ? "채택예정 항목이 없습니다."
                : "이 분류에는 채택예정 항목이 없습니다."}
            </div>
          )}
          {pageGroups.map((g) => {
            const expanded = expandedKey === g.key;
            const ctx = g.sourceId ? sourceContext[`${g.source}:${g.sourceId}`] : undefined;
            const activeTarget = activeVariant[g.key] ?? g.variants[0].target_doc;
            const active = g.variants.find((v) => v.target_doc === activeTarget) ?? g.variants[0];
            const draft = drafts[active.id] ?? active.specific_text;
            const busy = busyId === active.id || busyId === g.key;

            return (
              <div key={g.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <button
                  onClick={() => setExpandedKey(expanded ? null : g.key)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left"
                >
                  <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline-block">
                    {SOURCE_LABEL[g.source] ?? g.source}
                  </span>
                  {g.variants.length > 1 && (
                    <span className="hidden shrink-0 gap-1 sm:flex">
                      {g.variants.map((v) => (
                        <span
                          key={v.id}
                          className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-600"
                        >
                          {v.target_doc}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {ctx ? oneLine(ctx.title, 40) : oneLine(active.specific_text)}
                  </span>
                  {active.review_count > 0 && (
                    <span className="hidden shrink-0 rounded-full bg-purple-50 px-2 py-0.5 text-xs text-purple-600 sm:inline">
                      🔍 검증 {active.review_count}회
                    </span>
                  )}
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{g.date}</span>
                  <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
                </button>

                {expanded && (
                  <div className="border-t border-slate-100 px-4 py-3 text-sm">
                    {ctx && (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="mb-1 text-xs font-semibold text-slate-500">📌 사건 개요 · {ctx.date}</div>
                        <div className="text-xs font-medium text-slate-700">{ctx.title}</div>
                        {ctx.detail && (
                          <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-slate-500">
                            {ctx.detail}
                          </div>
                        )}
                      </div>
                    )}

                    {g.variants.length > 1 && (
                      <div className="mb-3 flex gap-1 rounded-lg bg-slate-100 p-1">
                        {g.variants.map((v) => (
                          <button
                            key={v.id}
                            onClick={() => setActiveVariant((s) => ({ ...s, [g.key]: v.target_doc }))}
                            className={
                              "flex-1 rounded-md px-2 py-1 text-xs font-semibold transition " +
                              (activeTarget === v.target_doc
                                ? "bg-white text-gia-navy shadow-sm"
                                : "text-slate-500 hover:text-slate-700")
                            }
                          >
                            {v.target_doc}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                        {active.target_doc}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        항목: {active.category}
                      </span>
                    </div>

                    <hr className="mb-3 border-slate-100" />

                    <label className="mb-3 flex flex-col gap-1 text-xs text-slate-500">
                      <span className="font-semibold text-slate-600">
                        ✅ 구체화한 최종 내용(직접 수정 가능 - 발행 시 이 내용이 매뉴얼에 반영됩니다)
                      </span>
                      <textarea
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [active.id]: e.target.value }))}
                        rows={4}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </label>

                    {(active.guide || active.ai_original || active.legal_basis || active.legal_summary || active.benchmark) && (
                      <>
                        <hr className="mb-3 border-slate-100" />
                        <dl className="mb-3 flex flex-col gap-2">
                          {[
                            ["AI 작성 가이드(구체화할 때 참고)", active.guide],
                            ["AI 제안 원문(참고용, 수정 안 됨)", active.ai_original],
                            ["⚖️ 관련법령/근거", active.legal_basis],
                            ["📖 관련법령 요약", active.legal_summary],
                            ["🏫 타 사립교육기관 참고사례", active.benchmark],
                          ]
                            .filter(([, v]) => v)
                            .map(([label, value]) => (
                              <div key={label as string}>
                                <dt className="text-xs text-slate-400">{label}</dt>
                                <dd className="whitespace-pre-wrap text-xs text-slate-600">{value}</dd>
                              </div>
                            ))}
                        </dl>
                      </>
                    )}

                    <hr className="mb-3 border-slate-100" />

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => saveText(active.id)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        내용 저장
                      </button>
                      <button
                        onClick={() => runReview(active.id)}
                        disabled={busy}
                        className="rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-50 disabled:opacity-50"
                      >
                        {busy
                          ? "처리 중..."
                          : active.target_doc === "학부모용"
                          ? active.review_count > 0
                            ? "🔍 다시 학부모 관점 검증"
                            : "🔍 학부모 관점 AI 검증"
                          : active.review_count > 0
                          ? "🔍 다시 AI 검증"
                          : "🔍 AI 검증"}
                      </button>
                      {g.variants.length > 1 ? (
                        <>
                          <button
                            onClick={() => publishGroup(g, "all")}
                            disabled={busy}
                            className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                            title="운영계획안(학부모용)·실무자매뉴얼(실무자용)을 함께 발행합니다."
                          >
                            통합발행
                          </button>
                          <button
                            onClick={() => publishGroup(g, "staffOnly")}
                            disabled={busy}
                            className="rounded-lg border border-gia-navy px-3 py-1.5 text-xs font-semibold text-gia-navy hover:bg-blue-50 disabled:opacity-50"
                            title="운영계획안에는 반영하지 않고 실무자매뉴얼에만 발행합니다."
                          >
                            실무자발행
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => publish(active.id)}
                          disabled={busy}
                          className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                        >
                          발행
                        </button>
                      )}
                      <button
                        onClick={() => revert(active, ctx?.title || oneLine(active.specific_text, 40))}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                        title="제안함(검토대기)으로 되돌립니다."
                      >
                        ↩️ 되돌리기
                      </button>
                    </div>

                    {active.review_result && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-xs">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-semibold text-purple-800">
                            🔍 AI 비판적 검증 결과 ({active.review_count}회차)
                          </span>
                          {active.review_result.reviewedText !== draft && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              ⚠️ 검증 이후 내용이 수정됨 - 다시 검증해보세요
                            </span>
                          )}
                        </div>
                        {active.review_result.summary && (
                          <p className="mb-2 whitespace-pre-wrap text-purple-900">{active.review_result.summary}</p>
                        )}
                        {active.review_result.potentialComplaints?.length > 0 && (
                          <div className="mb-2">
                            <div className="font-semibold text-purple-700">🗣️ 예상 후속 문의/컴플레인</div>
                            {active.review_result.potentialComplaints.map((line, i) => (
                              <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                            ))}
                          </div>
                        )}
                        {active.review_result.blindSpots?.length > 0 && (
                          <div className="mb-2">
                            <div className="font-semibold text-red-700">⚠️ 맹점/허점</div>
                            {active.review_result.blindSpots.map((line, i) => (
                              <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                            ))}
                          </div>
                        )}
                        {active.review_result.suggestions?.length > 0 && (
                          <div>
                            <div className="font-semibold text-purple-700">💡 보완 제안</div>
                            {active.review_result.suggestions.map((line, i) => (
                              <p key={i} className="whitespace-pre-wrap text-slate-600">{line}</p>
                            ))}
                          </div>
                        )}
                        {active.review_result.potentialComplaints?.length === 0 &&
                          active.review_result.blindSpots?.length === 0 &&
                          active.review_result.suggestions?.length === 0 && (
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
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
