"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Proposal } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  incidents: "📋 사건",
  events: "🎉 행사",
  meetings: "💬 회의",
  manual: "✨ AI매뉴얼",
  complaint: "🗣️ 예상 문의/컴플레인",
};

function oneLine(text: string, maxLen = 70) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

type CategoryTab = "all" | "incidents" | "events" | "meetings" | "manual" | "complaint";

export default function ProposalsClient({ initialItems }: { initialItems: Proposal[] }) {
  const [items, setItems] = useState<Proposal[]>(initialItems);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState("");
  const [tab, setTab] = useState<CategoryTab>("all");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("proposals-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "proposals" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as Proposal;
            const stillPending = next.status === "검토대기";
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

  async function runScan(type: "incidents" | "events" | "meetings") {
    setScanBusy(type);
    setScanMsg("");
    const res = await fetch("/api/ai/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const data = await res.json();
    setScanBusy(null);
    if (!res.ok) {
      setScanMsg(`오류: ${data.error || "스캔에 실패했습니다."}`);
      return;
    }
    setScanMsg(
      data.created > 0
        ? `${SOURCE_LABEL[type]} ${data.created}건에서 새 제안을 만들었습니다. 대기 중인 기록이 더 있으면 다시 눌러주세요.`
        : `${SOURCE_LABEL[type]} 중 아직 분석하지 않은 기록이 없습니다.`
    );
  }

  async function saveText(id: string) {
    const finalText = drafts[id];
    if (finalText === undefined) return;
    setBusyId(id);
    await fetch("/api/proposals/save-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, finalText }),
    });
    setBusyId(null);
  }

  async function decide(id: string, decision: "승인" | "보류" | "삭제") {
    if (decision === "삭제" && !confirm("이 제안을 삭제할까요?")) return;
    setBusyId(id);
    if (drafts[id] !== undefined) {
      await fetch("/api/proposals/save-text", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, finalText: drafts[id] }),
      });
    }
    const res = await fetch("/api/proposals/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "처리하지 못했습니다.");
    }
  }

  const categoryCounts = {
    all: items.length,
    incidents: items.filter((it) => it.source === "incidents").length,
    events: items.filter((it) => it.source === "events").length,
    meetings: items.filter((it) => it.source === "meetings").length,
    manual: items.filter((it) => it.source === "manual").length,
    complaint: items.filter((it) => it.source === "complaint").length,
  };
  const filteredItems = tab === "all" ? items : items.filter((it) => it.source === tab);
  const CATEGORY_TABS: { key: CategoryTab; label: string }[] = [
    { key: "all", label: "전체" },
    { key: "incidents", label: "📋 사건기록제안" },
    { key: "events", label: "🎉 행사기록제안" },
    { key: "meetings", label: "💬 회의록제안" },
    { key: "manual", label: "✨ AI매뉴얼제안" },
    { key: "complaint", label: "🗣️ 예상 문의/컴플레인" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-lg font-bold">제안함 검토대기 ({items.length}건)</h1>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700">AI 분석 실행</div>
        <p className="mb-3 text-xs text-slate-500">
          아직 분석하지 않은 사건/행사/회의를 한 번에 최대 5건씩 AI로 분석해 제안을 만듭니다. 남은 기록이
          많으면 여러 번 눌러주세요.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["incidents", "events", "meetings"] as const).map((type) => (
            <button
              key={type}
              onClick={() => runScan(type)}
              disabled={scanBusy !== null}
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {scanBusy === type ? "분석 중..." : `${SOURCE_LABEL[type]} 분석하기`}
            </button>
          ))}
        </div>
        {scanMsg && <p className="mt-2 text-xs text-slate-600">{scanMsg}</p>}
      </div>

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

      <div className="flex flex-col gap-2">
        {filteredItems.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            {items.length === 0
              ? "검토 대기 중인 제안이 없습니다. 위에서 분석을 실행해보세요."
              : "이 분류에는 검토 대기 중인 제안이 없습니다."}
          </div>
        )}
        {filteredItems.map((it) => {
          const expanded = expandedId === it.id;
          const draft = drafts[it.id] ?? it.final_text;
          const busy = busyId === it.id;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline-block">
                  {SOURCE_LABEL[it.source] ?? it.source}
                </span>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                  {it.target_doc}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{oneLine(it.final_text)}</span>
                <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{it.date}</span>
                <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <div className="mb-2 text-xs text-slate-400">항목(카테고리): {it.category}</div>

                  <label className="mb-3 flex flex-col gap-1 text-xs text-slate-500">
                    최종 채택 내용(직접 수정 가능 - 이 내용만 매뉴얼에 반영됩니다)
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      rows={4}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>

                  <dl className="mb-3 flex flex-col gap-2">
                    {[
                      ["보완/재발방지 방안 옵션", it.remediation],
                      ["학부모 안내 멘트 옵션", it.parent_msg],
                      ["학생 교육 방법 옵션", it.student_edu],
                      ["관련법령/근거", it.legal_basis],
                      ["관련법령 요약", it.legal_summary],
                      ["타 사립교육기관 참고사례", it.benchmark],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string}>
                          <dt className="text-xs text-slate-400">{label}</dt>
                          <dd className="whitespace-pre-wrap text-xs text-slate-600">{value}</dd>
                        </div>
                      ))}
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => saveText(it.id)}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      내용 저장
                    </button>
                    <button
                      onClick={() => decide(it.id, "승인")}
                      disabled={busy}
                      className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => decide(it.id, "보류")}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      보류
                    </button>
                    <button
                      onClick={() => decide(it.id, "삭제")}
                      disabled={busy}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      삭제
                    </button>
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
