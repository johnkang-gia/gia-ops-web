"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Proposal, ProposalSourceContext } from "@/lib/types";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";

const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "📝 제안함이란?",
    lines: [
      "사건/행사/회의/AI매뉴얼/예상 문의 등에서 AI가 만든 제안을 검토합니다. 같은 사건에서 나온 학부모용·실무자용 제안은 카드 하나로 묶여 안의 탭으로 전환해서 봅니다.",
      "카드를 펼치지 않아도 목록의 체크박스를 누르면 그 즉시 승인되어 채택예정으로 넘어갑니다.",
      "상단 \"AI 분석 실행\"으로 최근 기록을 스캔해 새 제안을 만들 수 있습니다.",
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

// 그룹화 대상(같은 원본 기록에서 학부모용/실무자용 두 건이 동시에 나올 수 있는 출처)만 source_id로
// 묶습니다. complaint/system은 origin 개념이 다르거나(complaint는 origin 없음, system은 UUID
// 참조) 중복 생성 케이스가 아니라서 그룹화 대상에서 제외합니다.
const GROUPABLE_SOURCES = new Set(["incidents", "events", "meetings", "manual"]);
const TARGET_DOC_ORDER: Record<string, number> = { 학부모용: 0, 실무자용: 1 };

function oneLine(text: string, maxLen = 70) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

// 옵션 필드(remediation/parent_msg/student_edu)는 새로 생성된 제안이면 JSON 배열 문자열로
// 저장되어 있고, 예전에 생성된 제안은 "\n\n[--- 다음 옵션 ---]\n\n" 구분자로 이어붙인 하나의
// 문자열로 저장되어 있습니다(요청 7번: 그 구분자 글자가 화면에 그대로 반복 노출되던 문제). 두
// 형식을 모두 안전하게 배열로 풀어서 카드 형태로 렌더링합니다.
function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  const t = raw.trim();
  if (!t) return [];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter((v) => v.trim());
  } catch {
    // JSON이 아니면 아래에서 예전 구분자 형식으로 시도합니다.
  }
  if (t.includes("다음 옵션")) {
    return t
      .split(/\n*\[-{0,3}\s*다음\s*옵션\s*-{0,3}\]\n*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [t];
}

type CategoryTab = "all" | "incidents" | "events" | "meetings" | "manual" | "complaint" | "system";

type ProposalGroup = {
  key: string;
  source: string;
  sourceId: string | null;
  date: string;
  variants: Proposal[];
};

function groupProposals(items: Proposal[]): ProposalGroup[] {
  const map = new Map<string, ProposalGroup>();
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

export default function ProposalsClient({
  initialItems,
  sourceContext,
}: {
  initialItems: Proposal[];
  sourceContext: Record<string, ProposalSourceContext>;
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [items, setItems] = useState<Proposal[]>(initialItems);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [activeVariant, setActiveVariant] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // 요청 1번: 옵션(보완방안/학부모안내멘트/학생교육방법) 중 하나를 고르면(동그라미 선택 - 한 번에
  // 하나만) 그 문구가 그대로 "최종 채택 내용" 박스에 채워집니다. proposalId별로 지금 어떤 옵션을
  // 골랐는지만 기억해서 라디오 표시를 유지합니다(실제 값은 drafts에 들어갑니다).
  const [selectedOption, setSelectedOption] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState("");
  const [tab, setTab] = useState<CategoryTab>("all");
  const [page, setPage] = useState(1);

  // 분류 탭을 바꾸면 목록이 달라지므로 이전 페이지 번호가 남아있지 않도록 리셋합니다.
  useEffect(() => {
    setPage(1);
  }, [tab]);

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

  // 요청 3번: 목록에서 체크(즉시 채택)하기 전에 사건명과 최종 채택 내용을 한 번 더 보여주고
  // 확인을 받습니다(실수로 잘못 체크해서 바로 채택예정으로 넘어가는 것을 방지).
  async function confirmAndApprove(v: Proposal, title: string) {
    const finalContent = drafts[v.id] ?? v.final_text;
    const ok = await confirmAction(`사건: ${title}\n\n최종 채택 내용:\n${finalContent || "(내용 없음)"}`, {
      title: `"${v.target_doc}"으로 채택예정에 보내시겠습니까?`,
      confirmLabel: "채택예정으로 보내기",
    });
    if (!ok) return;
    decide(v.id, "승인");
  }

  async function decide(id: string, decision: "승인" | "보류" | "삭제") {
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
    } else if (decision === "승인") {
      notify("승인했습니다 - 채택예정으로 옮겨졌습니다.", "success");
    }
  }

  const allGroups = useMemo(() => groupProposals(items), [items]);

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
    { key: "incidents", label: "📋 사건기록제안" },
    { key: "events", label: "🎉 행사기록제안" },
    { key: "meetings", label: "💬 회의록제안" },
    { key: "manual", label: "✨ AI매뉴얼제안" },
    { key: "complaint", label: "🗣️ 예상 문의/컴플레인" },
    { key: "system", label: "🧩 GIA시스템" },
  ];

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="shrink-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">제안함 검토대기 ({allGroups.length}건)</h1>
        <GuideButton title="제안함 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>

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
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        {filteredGroups.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
            {allGroups.length === 0
              ? "검토 대기 중인 제안이 없습니다. 위에서 분석을 실행해보세요."
              : "이 분류에는 검토 대기 중인 제안이 없습니다."}
          </div>
        )}
        {pageGroups.map((g) => {
          const expanded = expandedKey === g.key;
          const ctx = g.sourceId ? sourceContext[`${g.source}:${g.sourceId}`] : undefined;
          const activeTarget = activeVariant[g.key] ?? g.variants[0].target_doc;
          const active = g.variants.find((v) => v.target_doc === activeTarget) ?? g.variants[0];
          const draft = drafts[active.id] ?? active.final_text;
          const busy = busyId === active.id;
          const remediationOptions = parseOptions(active.remediation);
          const parentMsgOptions = parseOptions(active.parent_msg);
          const studentEduOptions = parseOptions(active.student_edu);

          return (
            <div key={g.key} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex w-full items-center gap-2 px-4 py-3 text-left">
                <div className="flex shrink-0 items-center gap-2">
                  {g.variants.map((v) => (
                    <label
                      key={v.id}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500 hover:border-gia-navy hover:text-gia-navy"
                      title={`체크하면 "${v.target_doc}" 제안을 채택예정으로 보낼지 한 번 더 확인합니다.`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={false}
                        disabled={busyId === v.id}
                        onChange={() => confirmAndApprove(v, ctx?.title || oneLine(v.final_text, 40))}
                        className="h-3.5 w-3.5 accent-gia-navy"
                      />
                      {v.target_doc}
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => setExpandedKey(expanded ? null : g.key)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline-block">
                    {SOURCE_LABEL[g.source] ?? g.source}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {ctx ? oneLine(ctx.title, 40) : oneLine(active.final_text)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{g.date}</span>
                  <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
                </button>
              </div>

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
                    <span className="font-semibold text-slate-600">✅ 최종 채택 내용(직접 수정 가능 - 이 내용만 매뉴얼에 반영됩니다)</span>
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [active.id]: e.target.value }))}
                      rows={4}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>

                  {(remediationOptions.length > 0 || parentMsgOptions.length > 0 || studentEduOptions.length > 0) && (
                    <>
                      <hr className="mb-3 border-slate-100" />
                      <p className="mb-2 text-[11px] text-slate-400">
                        옵션 앞 동그라미를 선택하면 그 내용이 위 &quot;최종 채택 내용&quot;에 그대로 채워집니다(직접 수정 가능).
                      </p>
                      <div className="mb-3 flex flex-col gap-3">
                        {(
                          [
                            ["🔧 보완/재발방지 방안 옵션", remediationOptions, "remediation"],
                            ["💬 학부모 안내 멘트 옵션", parentMsgOptions, "parent_msg"],
                            ["🎓 학생 교육 방법 옵션", studentEduOptions, "student_edu"],
                          ] as [string, string[], string][]
                        )
                          .filter(([, opts]) => opts.length > 0)
                          .map(([label, opts, groupKey]) => (
                            <div key={groupKey}>
                              <div className="mb-1.5 text-xs font-semibold text-slate-600">{label}</div>
                              <div className="flex flex-col gap-1.5">
                                {opts.map((opt, i) => {
                                  const optionKey = `${groupKey}-${i}`;
                                  const isSelected = selectedOption[active.id] === optionKey;
                                  return (
                                    <label
                                      key={i}
                                      className={
                                        "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs " +
                                        (isSelected
                                          ? "border-gia-navy bg-blue-50 text-slate-700"
                                          : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200")
                                      }
                                    >
                                      <input
                                        type="radio"
                                        name={`opt-${active.id}`}
                                        checked={isSelected}
                                        onChange={() => {
                                          setSelectedOption((s) => ({ ...s, [active.id]: optionKey }));
                                          setDrafts((d) => ({ ...d, [active.id]: opt }));
                                        }}
                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-gia-navy"
                                      />
                                      <span>
                                        <span className="mr-1 font-semibold text-slate-400">옵션 {i + 1}</span>
                                        <span className="whitespace-pre-wrap">{opt}</span>
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                      </div>
                    </>
                  )}

                  {(active.legal_basis || active.legal_summary || active.benchmark) && (
                    <>
                      <hr className="mb-3 border-slate-100" />
                      <dl className="mb-3 flex flex-col gap-2">
                        {[
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

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => saveText(active.id)}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      내용 저장
                    </button>
                    <button
                      onClick={() => decide(active.id, "승인")}
                      disabled={busy}
                      className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                    >
                      승인
                    </button>
                    <button
                      onClick={() => decide(active.id, "보류")}
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      보류
                    </button>
                    <button
                      onClick={() => decide(active.id, "삭제")}
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
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
