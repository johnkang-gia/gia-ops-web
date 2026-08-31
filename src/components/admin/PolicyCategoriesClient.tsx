"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/errorMessage";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type { PolicyCategory, PolicyCategoryStatus, PolicyTargetDoc } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";
import { useConfirm } from "@/components/common/ConfirmProvider";

const GUIDE_SECTIONS = [
  {
    title: "🗂️ 정책 항목이란?",
    lines: [
      "학부모님께 안내하는 운영계획안, 실무자가 참고하는 매뉴얼에 어떤 \"항목\"들이 있어야 하는지 미리 정리해둔 고정 목록입니다.",
      "예전에는 AI가 사건/회의를 분류할 때마다 항목 이름을 자유롭게 새로 지어냈는데, 이제는 이 목록에 있는 항목 중에서만 고르도록 바뀌었습니다 - 항목이 무한정 늘어나지 않고 정리된 상태를 유지합니다.",
      "운영계획안(학부모용)은 GIA시스템 항목 중 학부모께 공개하기 적합한 것들을 추려 만들었고, 매뉴얼(실무자용)은 다른 학교·국제학교의 컴플레인 대응 사례와 규정을 참고해 만들었습니다.",
      "이름/설명/보유상태를 직접 고치거나, 새 항목을 추가하거나, 필요 없는 항목을 지울 수 있습니다. 관리자와 행정직원 모두 편집할 수 있습니다.",
      "사건/회의 기록 화면에서 이 목록 중 하나를 골라 항목을 태그하고, AI 자동 분류·소급 태깅도 이 목록 안에서만 이뤄집니다.",
    ],
  },
];

const STATUS_STYLE: Record<PolicyCategoryStatus, string> = {
  보유: "bg-teal-50 text-teal-700",
  부분보유: "bg-amber-50 text-amber-700",
  미보유: "bg-slate-100 text-slate-500",
};

const STATUSES: PolicyCategoryStatus[] = ["보유", "부분보유", "미보유"];
const TABS: { key: PolicyTargetDoc; label: string; icon: string }[] = [
  { key: "학부모용", label: "운영계획안 (학부모용)", icon: "📘" },
  { key: "실무자용", label: "매뉴얼 (실무자용)", icon: "📗" },
];

type StatusCounts = { 보유: number; 부분보유: number; 미보유: number };
function emptyCounts(): StatusCounts {
  return { 보유: 0, 부분보유: 0, 미보유: 0 };
}

function emptyDraft(target_doc: PolicyTargetDoc) {
  return { target_doc, domain: "", category: "", description: "" };
}

export default function PolicyCategoriesClient({ initialCategories }: { initialCategories: PolicyCategory[] }) {
  const [categories, setCategories] = useRealtimeTable<PolicyCategory>("policy_categories", initialCategories);
  const [tab, setTab] = useState<PolicyTargetDoc>("학부모용");
  const [error, setError] = useState<string | null>(null);
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ category: string; description: string; domain: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState(emptyDraft("학부모용"));
  const confirm = useConfirm();

  // 기존 사건/회의 소급 태깅(요청 확인: "기존 기록도 AI로 훑어서 새 항목에 소급 태깅") - 새
  // 항목 체계 도입 전에 이미 저장된 기록에는 manual_cat/op_plan_cat이 비어 있으므로, 이 버튼을
  // 눌러 배치 단위로 채워 넣습니다. 남은 건수가 0이 될 때까지(또는 최대 50배치까지) 자동으로
  // 이어서 호출합니다.
  const [backfillRunning, setBackfillRunning] = useState<Record<"incidents" | "meetings", boolean>>({
    incidents: false,
    meetings: false,
  });
  const [backfillStatus, setBackfillStatus] = useState<
    Record<"incidents" | "meetings", { processed: number; remaining: number } | null>
  >({ incidents: null, meetings: null });

  async function runBackfill(type: "incidents" | "meetings") {
    setBackfillRunning((prev) => ({ ...prev, [type]: true }));
    setError(null);
    let totalProcessed = 0;
    try {
      for (let i = 0; i < 50; i++) {
        const res = await fetch("/api/ai/backfill-categories", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "소급 태깅에 실패했습니다.");
        totalProcessed += json.processed || 0;
        setBackfillStatus((prev) => ({ ...prev, [type]: { processed: totalProcessed, remaining: json.remaining || 0 } }));
        if (!json.remaining || json.processed === 0) break;
      }
    } catch (err) {
      setError(friendlyError("소급 태깅 중 오류가 발생했습니다.", err));
    } finally {
      setBackfillRunning((prev) => ({ ...prev, [type]: false }));
    }
  }

  function toggleDomain(key: string) {
    setOpenDomains((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const tabItems = useMemo(() => categories.filter((c) => c.target_doc === tab), [categories, tab]);

  const tree = useMemo(() => {
    const domainMap = new Map<string, PolicyCategory[]>();
    for (const c of tabItems) {
      const domain = c.domain || "(미분류)";
      const list = domainMap.get(domain) ?? [];
      list.push(c);
      domainMap.set(domain, list);
    }
    // 요청: "항목들은 기본적으로 가나다순으로 정렬" - 예전에는 시드 데이터에 심어둔 sort_order를
    // 우선했지만, 이제는 구분(도메인)·항목명 모두 한글 가나다순으로만 정렬합니다.
    const domains = [...domainMap.keys()].sort((a, b) => a.localeCompare(b, "ko"));
    return domains.map((domain) => ({
      domain,
      items: domainMap.get(domain)!.sort((a, b) => a.category.localeCompare(b.category, "ko")),
    }));
  }, [tabItems]);

  const summary = useMemo(() => {
    const counts = emptyCounts();
    for (const c of tabItems) counts[c.status]++;
    return counts;
  }, [tabItems]);

  function countOf(items: PolicyCategory[]): StatusCounts {
    const c = emptyCounts();
    for (const it of items) c[it.status]++;
    return c;
  }

  function startEdit(c: PolicyCategory) {
    setEditingId(c.id);
    setEditDraft({ category: c.category, description: c.description ?? "", domain: c.domain });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    if (!editDraft.category.trim()) {
      setError("항목명을 입력해주세요.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("policy_categories")
        .update({
          category: editDraft.category.trim(),
          description: editDraft.description.trim() || null,
          domain: editDraft.domain.trim() || "(미분류)",
        })
        .eq("id", id);
      if (err) throw new Error(err.message);
      setCategories((prev) =>
        prev.map((c) =>
          c.id === id
            ? { ...c, category: editDraft.category.trim(), description: editDraft.description.trim() || null, domain: editDraft.domain.trim() || "(미분류)" }
            : c
        )
      );
      setEditingId(null);
      setEditDraft(null);
    } catch (err) {
      setError(friendlyError("항목을 수정하지 못했습니다.", err));
    } finally {
      setSavingId(null);
    }
  }

  async function updateStatus(id: string, status: PolicyCategoryStatus) {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
    const supabase = createClient();
    const { error: err } = await supabase.from("policy_categories").update({ status }).eq("id", id);
    if (err) setError(friendlyError("보유상태를 변경하지 못했습니다.", err));
  }

  async function removeCategory(c: PolicyCategory) {
    const ok = await confirm(
      `"${c.category}" 항목을 삭제할까요? 이미 이 항목으로 태그된 사건/회의 기록의 태그 값은 그대로 남지만, 더는 이 목록에서 고를 수 없게 됩니다.`,
      { title: "항목 삭제", confirmLabel: "삭제", danger: true }
    );
    if (!ok) return;
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.from("policy_categories").delete().eq("id", c.id);
    if (err) {
      setError(friendlyError("항목을 삭제하지 못했습니다.", err));
      return;
    }
    setCategories((prev) => prev.filter((x) => x.id !== c.id));
  }

  function openAdd() {
    setAddDraft(emptyDraft(tab));
    setAdding(true);
  }

  async function submitAdd() {
    if (!addDraft.category.trim()) {
      setError("항목명을 입력해주세요.");
      return;
    }
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: err } = await supabase
        .from("policy_categories")
        .insert({
          target_doc: addDraft.target_doc,
          domain: addDraft.domain.trim() || "(미분류)",
          category: addDraft.category.trim(),
          description: addDraft.description.trim() || null,
          status: "미보유",
          source: "manual",
          sort_order: tabItems.length + 1,
        })
        .select()
        .single();
      if (err) throw new Error(err.message);
      setCategories((prev) => [...prev, data as PolicyCategory]);
      setAdding(false);
    } catch (err) {
      setError(friendlyError("항목을 추가하지 못했습니다. 같은 이름의 항목이 이미 있는지 확인해주세요.", err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-lg font-bold">🗂️ 정책 항목 관리</h1>
          <p className="text-xs text-slate-500">
            운영계획안(학부모용)과 매뉴얼(실무자용)의 고정 항목 목록입니다. 사건/회의 기록의 항목
            태그와 AI 자동 분류·소급 태깅이 모두 이 목록을 기준으로 이뤄집니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={openAdd}
            className="shrink-0 rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + 새 항목
          </button>
          <GuideButton title="정책 항목 관리 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      <div className="mb-3 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-semibold " +
              (tab === t.key ? "bg-gia-navy text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
            }
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2 text-xs">
        <span className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-700">보유 {summary.보유}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">부분보유 {summary.부분보유}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-500">미보유 {summary.미보유}</span>
      </div>

      {/* 기존 사건/회의 소급 태깅 - 새 항목 체계 도입 전에 이미 저장된 기록에는 항목 태그가
          비어 있으므로, 버튼 하나로 AI가 이 목록 중에서 골라 채워 넣습니다. */}
      <div className="mb-4 g-panel-solid p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">🔄 기존 기록 소급 태깅</p>
        <p className="mb-2 text-[11px] text-slate-400">
          새 항목 체계 도입 전에 저장된 사건/회의에는 항목 태그가 비어 있습니다. AI가 위 고정
          목록 중에서 골라 자동으로 채워 넣습니다(이미 태그된 기록은 건드리지 않습니다).
        </p>
        <div className="flex flex-wrap gap-2">
          {(["incidents", "meetings"] as const).map((t) => (
            <div key={t} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
              <span className="text-xs font-medium text-slate-600">{t === "incidents" ? "사건기록" : "회의기록"}</span>
              <button
                onClick={() => runBackfill(t)}
                disabled={backfillRunning[t]}
                className="rounded-lg bg-gia-navy px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {backfillRunning[t] ? "처리 중..." : "실행"}
              </button>
              {backfillStatus[t] && (
                <span className="text-[11px] text-slate-400">
                  {backfillStatus[t]!.processed}건 처리{backfillStatus[t]!.remaining > 0 ? ` · ${backfillStatus[t]!.remaining}건 남음(다시 눌러 계속)` : " · 완료"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      {adding && (
        <div className="mb-3 rounded-xl border border-gia-navy/30 bg-gia-navy/5 p-3">
          <p className="mb-2 text-xs font-semibold text-gia-navy">
            새 {TABS.find((t) => t.key === addDraft.target_doc)?.label} 항목
          </p>
          <div className="flex flex-col gap-2">
            <input
              value={addDraft.domain}
              onChange={(e) => setAddDraft((d) => ({ ...d, domain: e.target.value }))}
              placeholder="구분(예: 아동보호·안전, 재정)"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <input
              value={addDraft.category}
              onChange={(e) => setAddDraft((d) => ({ ...d, category: e.target.value }))}
              placeholder="항목명"
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <textarea
              value={addDraft.description}
              onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="한줄설명"
              rows={2}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
            />
            <div className="flex justify-end gap-1.5">
              <button onClick={() => setAdding(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                취소
              </button>
              <button onClick={submitAdd} className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">
                추가
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {tree.map(({ domain, items }) => {
          const domainOpen = openDomains.has(domain);
          const domainCounts = countOf(items);
          return (
            <div key={domain} className="overflow-hidden g-panel-solid">
              <button
                type="button"
                onClick={() => toggleDomain(domain)}
                className="flex w-full items-center justify-between gap-2 bg-gia-navy/5 px-4 py-3 text-left hover:bg-gia-navy/10"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-gia-navy">
                  <span className={"inline-block transition-transform " + (domainOpen ? "rotate-90" : "")}>▶</span>
                  {domain}
                  <span className="text-xs font-normal text-slate-400">({items.length}개 항목)</span>
                </span>
                <span className="flex shrink-0 gap-1 text-[10px]">
                  {domainCounts.보유 > 0 && (
                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">보유 {domainCounts.보유}</span>
                  )}
                  {domainCounts.부분보유 > 0 && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">부분 {domainCounts.부분보유}</span>
                  )}
                  {domainCounts.미보유 > 0 && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">미보유 {domainCounts.미보유}</span>
                  )}
                </span>
              </button>

              {domainOpen && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {items.map((c) => (
                    <div key={c.id} className="px-4 py-3">
                      {editingId === c.id && editDraft ? (
                        <div className="flex flex-col gap-2">
                          <input
                            value={editDraft.domain}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, domain: e.target.value } : d))}
                            placeholder="구분"
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                          />
                          <input
                            value={editDraft.category}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, category: e.target.value } : d))}
                            placeholder="항목명"
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-semibold"
                          />
                          <textarea
                            value={editDraft.description}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                            placeholder="한줄설명"
                            rows={2}
                            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setEditingId(null);
                                setEditDraft(null);
                              }}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                            >
                              취소
                            </button>
                            <button
                              onClick={() => saveEdit(c.id)}
                              disabled={savingId === c.id}
                              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {savingId === c.id ? "저장 중..." : "저장"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + STATUS_STYLE[c.status]}>{c.status}</span>
                            {c.source === "gia_system" && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">GIA시스템 연계</span>
                            )}
                            {c.source === "benchmark" && (
                              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600">벤치마킹</span>
                            )}
                            <span className="text-sm font-semibold text-slate-800">{c.category}</span>
                          </div>
                          {c.description && <p className="mb-2 text-xs text-slate-600">{c.description}</p>}
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={c.status}
                              onChange={(e) => updateStatus(c.id, e.target.value as PolicyCategoryStatus)}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                            >
                              {STATUSES.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={() => startEdit(c)}
                              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              ✏️ 수정
                            </button>
                            <button
                              onClick={() => removeCategory(c)}
                              className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-500 hover:bg-red-50"
                            >
                              🗑️ 삭제
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {tabItems.length === 0 && (
          <p className="g-panel-solid p-6 text-center text-sm text-slate-400">
            등록된 항목이 없습니다. &quot;+ 새 항목&quot;으로 추가해보세요.
          </p>
        )}
      </div>
    </div>
  );
}
