"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Proposal, Adopted } from "@/lib/types";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";

type SourceType = "incidents" | "events" | "meetings" | "manual" | "complaint";

function oneLine(text: string, maxLen = 50) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

const SCAN_LABEL: Record<string, string> = {
  incidents: "📋 사건",
  events: "🎉 행사",
  meetings: "💬 회의",
};

// 사건기록/회의기록/AI매뉴얼 화면 오른쪽에 붙는 공용 AI 제안 패널입니다. 같은 source(사건 등)에
// 속한 "검토대기(proposals)"와 "채택예정(adopted)" 항목을 한 화면에서 바로 처리할 수 있게 해서,
// 기록 입력 → 제안함 → 채택예정을 계속 오갈 필요가 없도록 합니다. 승인/보류/삭제/발행/AI검증 로직은
// ProposalsClient·AdoptedClient와 동일한 API를 그대로 호출합니다.
export default function AiSourcePanel({
  source,
  scanType,
}: {
  source: SourceType;
  scanType?: "incidents" | "events" | "meetings";
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [adopted, setAdopted] = useState<Adopted[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    // 이 패널이 실제로 화면에 그리는 항목만 가져옵니다(불필요한 대용량 컬럼을 빼서 전송량을 줄임).
    const PROPOSAL_COLS =
      "id, source, date, target_doc, category, final_text, remediation, parent_msg, student_edu, legal_basis";
    const ADOPTED_COLS =
      "id, source, date, target_doc, category, specific_text, guide, legal_basis, review_result, review_count";

    async function load() {
      setLoading(true);
      const [p, a] = await Promise.all([
        supabase
          .from("proposals")
          .select(PROPOSAL_COLS)
          .eq("source", source)
          .eq("status", "검토대기")
          .order("date", { ascending: false }),
        supabase
          .from("adopted")
          .select(ADOPTED_COLS)
          .eq("source", source)
          .eq("publish", false)
          .order("date", { ascending: false }),
      ]);
      if (cancelled) return;
      setProposals((p.data as Proposal[]) ?? []);
      setAdopted((a.data as Adopted[]) ?? []);
      setLoading(false);
    }
    load();

    // Postgres 쪽에서 이 source에 해당하는 행만 골라서 보내주도록 filter를 걸어, 다른 화면(다른
    // source)에서 일어난 변경 이벤트까지 매번 이 패널로 내려받아 걸러내는 낭비를 없앱니다.
    const channel = supabase
      .channel(`ai-source-panel-${source}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "proposals", filter: `source=eq.${source}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Proposal;
          setProposals((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((it) => it.id !== row.id);
            const next = payload.new as Proposal;
            const stillPending = next.status === "검토대기";
            const exists = prev.some((it) => it.id === next.id);
            if (!stillPending) return prev.filter((it) => it.id !== next.id);
            const merged = exists ? prev.map((it) => (it.id === next.id ? next : it)) : [next, ...prev];
            return [...merged].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "adopted", filter: `source=eq.${source}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Adopted;
          setAdopted((prev) => {
            if (payload.eventType === "DELETE") return prev.filter((it) => it.id !== row.id);
            const next = payload.new as Adopted;
            const stillPending = !next.publish;
            const exists = prev.some((it) => it.id === next.id);
            if (!stillPending) return prev.filter((it) => it.id !== next.id);
            const merged = exists ? prev.map((it) => (it.id === next.id ? next : it)) : [next, ...prev];
            return [...merged].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [source]);

  async function runScan() {
    if (!scanType) return;
    setScanBusy(true);
    setScanMsg("");
    const res = await fetch("/api/ai/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: scanType }),
    });
    const data = await res.json();
    setScanBusy(false);
    if (!res.ok) {
      setScanMsg(`오류: ${data.error || "분석에 실패했습니다."}`);
      return;
    }
    setScanMsg(
      data.created > 0
        ? `${data.created}건에서 새 제안을 만들었습니다. 더 있으면 다시 눌러주세요.`
        : "아직 분석하지 않은 기록이 없습니다."
    );
  }

  async function saveProposalText(id: string) {
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

  async function decideProposal(id: string, decision: "승인" | "보류" | "삭제") {
    if (decision === "삭제" && !(await confirmAction("이 제안을 삭제할까요?", { danger: true }))) return;
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
      notify(data.error || "처리하지 못했습니다.", "error");
    }
  }

  async function saveAdoptedText(id: string) {
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

  async function publishAdopted(id: string) {
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

  async function runReview(id: string) {
    setBusyId(id);
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
      setAdopted((prev) => prev.map((it) => (it.id === id ? (data.item as Adopted) : it)));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">🤖 AI 제안</h2>
          {scanType && (
            <button
              onClick={runScan}
              disabled={scanBusy}
              className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {scanBusy ? "분석 중..." : `${SCAN_LABEL[scanType]} 새 기록 분석`}
            </button>
          )}
        </div>
        {scanMsg && <p className="mb-2 text-[11px] text-slate-500">{scanMsg}</p>}
      </div>

      {loading && <p className="text-xs text-slate-400">불러오는 중...</p>}

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">📝 검토대기 ({proposals.length})</div>
        <div className="flex flex-col gap-1.5">
          {!loading && proposals.length === 0 && (
            <div className="rounded-lg bg-white p-2.5 text-[11px] text-slate-400 shadow-sm">없음</div>
          )}
          {proposals.map((it) => {
            const expanded = expandedId === `p-${it.id}`;
            const draft = drafts[it.id] ?? it.final_text;
            const busy = busyId === it.id;
            return (
              <div key={it.id} className="g-panel-solid shadow-sm">
                <button
                  onClick={() => setExpandedId(expanded ? null : `p-${it.id}`)}
                  className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left"
                >
                  <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                    {it.target_doc}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium leading-snug">{oneLine(it.final_text)}</span>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 px-2.5 py-2 text-xs">
                    <div className="mb-1.5 text-[10px] text-slate-400">항목: {it.category}</div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      rows={3}
                      className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                    {[
                      ["보완/재발방지 옵션", it.remediation],
                      ["학부모 안내 멘트", it.parent_msg],
                      ["학생 교육 방법", it.student_edu],
                      ["관련법령", it.legal_basis],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string} className="mb-1.5">
                          <div className="text-[10px] text-slate-400">{label}</div>
                          <div className="whitespace-pre-wrap text-[11px] text-slate-600">{value}</div>
                        </div>
                      ))}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button
                        onClick={() => saveProposalText(it.id)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => decideProposal(it.id, "승인")}
                        disabled={busy}
                        className="rounded-lg bg-gia-navy px-2 py-1 text-[11px] font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                      >
                        승인
                      </button>
                      <button
                        onClick={() => decideProposal(it.id, "보류")}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        보류
                      </button>
                      <button
                        onClick={() => decideProposal(it.id, "삭제")}
                        disabled={busy}
                        className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
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

      <div>
        <div className="mb-1.5 text-xs font-semibold text-slate-500">📬 채택예정 ({adopted.length})</div>
        <div className="flex flex-col gap-1.5">
          {!loading && adopted.length === 0 && (
            <div className="rounded-lg bg-white p-2.5 text-[11px] text-slate-400 shadow-sm">없음</div>
          )}
          {adopted.map((it) => {
            const expanded = expandedId === `a-${it.id}`;
            const draft = drafts[it.id] ?? it.specific_text;
            const busy = busyId === it.id;
            return (
              <div key={it.id} className="g-panel-solid shadow-sm">
                <button
                  onClick={() => setExpandedId(expanded ? null : `a-${it.id}`)}
                  className="flex w-full items-start gap-1.5 px-2.5 py-2 text-left"
                >
                  <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
                    {it.target_doc}
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-medium leading-snug">{oneLine(it.specific_text)}</span>
                  {it.review_count > 0 && (
                    <span className="shrink-0 rounded-full bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-600">
                      🔍{it.review_count}
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 px-2.5 py-2 text-xs">
                    <div className="mb-1.5 text-[10px] text-slate-400">항목: {it.category}</div>
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
                      rows={3}
                      className="mb-2 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
                    />
                    {[
                      ["AI 작성 가이드", it.guide],
                      ["관련법령", it.legal_basis],
                    ]
                      .filter(([, v]) => v)
                      .map(([label, value]) => (
                        <div key={label as string} className="mb-1.5">
                          <div className="text-[10px] text-slate-400">{label}</div>
                          <div className="whitespace-pre-wrap text-[11px] text-slate-600">{value}</div>
                        </div>
                      ))}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <button
                        onClick={() => saveAdoptedText(it.id)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => runReview(it.id)}
                        disabled={busy}
                        className="rounded-lg border border-purple-200 px-2 py-1 text-[11px] font-semibold text-purple-600 hover:bg-purple-50 disabled:opacity-50"
                      >
                        {it.review_count > 0 ? "🔍 다시 검증" : "🔍 AI 검증"}
                      </button>
                      <button
                        onClick={() => publishAdopted(it.id)}
                        disabled={busy}
                        className="rounded-lg bg-gia-navy px-2 py-1 text-[11px] font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                      >
                        발행
                      </button>
                    </div>
                    {it.review_result && (
                      <div className="mt-2 rounded-lg border border-purple-200 bg-purple-50 p-2 text-[11px]">
                        {it.review_result.reviewedText !== draft && (
                          <p className="mb-1 font-semibold text-amber-700">⚠️ 검증 이후 수정됨 - 다시 검증하세요</p>
                        )}
                        {it.review_result.summary && (
                          <p className="mb-1 whitespace-pre-wrap text-purple-900">{it.review_result.summary}</p>
                        )}
                        {it.review_result.blindSpots?.length > 0 && (
                          <div className="mb-1">
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
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
