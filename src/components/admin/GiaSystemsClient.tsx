"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { genCaseId } from "@/lib/caseId";
import { friendlyError } from "@/lib/errorMessage";
import type { GiaSystem } from "@/lib/types";
import GuideButton from "@/components/common/GuideButton";

const GUIDE_SECTIONS = [
  {
    title: "🧩 GIA시스템이란?",
    lines: [
      "다른 공립·사립·국제학교가 일반적으로 갖추는 운영 시스템을 대분류(예: 재정, 인사·교직원, 학사, 운영)→중분류→세부 항목으로 세분화해서, GIA가 이미 갖췄는지(보유/부분보유/미보유) 체크하는 화면입니다.",
      "대분류→중분류→세부 항목 3단 구조입니다. 대분류를 누르면 그 안의 중분류 목록이 펼쳐지고, 중분류를 눌러야 비로소 세부 항목이 보입니다(항목이 많아져도 전체 구조를 한눈에 훑어볼 수 있도록 기본은 모두 접혀 있습니다).",
      "\"✨ AI로 추가/세분화 체크\"는 기존에 잘 정리해둔 항목은 절대 고치거나 지우지 않고, ①GIA에 아직 없는 시스템을 새로 추가하거나 ②이미 있는 항목 중 너무 뭉뚱그려진 것을 더 구체적인 하위 항목으로 쪼갤 수 있는지만 체크해서 제안합니다. 세분화 제안에는 어떤 기존 항목을 세분화한 것인지 함께 표시됩니다.",
      "\"운영관리 제안함으로 보내기\"를 누르면 제안함→채택예정→발행 절차를 그대로 거치고, 발행되는 순간 이 표의 상태가 자동으로 \"보유\"로 바뀝니다.",
      "필요한 서류가 있는 항목은 \"📁 서류함에 만들기\"로 서류함(문서함)에 같은 분류가 적용된 서류를 바로 만들 수 있습니다.",
    ],
  },
];

const STATUS_STYLE: Record<GiaSystem["status"], string> = {
  보유: "bg-teal-50 text-teal-700",
  부분보유: "bg-amber-50 text-amber-700",
  미보유: "bg-slate-100 text-slate-500",
};

const STATUSES: GiaSystem["status"][] = ["보유", "부분보유", "미보유"];

// AI 제안 라우트(gia-systems-suggest/route.ts)의 MAJORS와 순서를 맞춰야 대분류가 매번 같은
// 순서로 나옵니다(요청: "전체적인 시스템 항목을 한눈에 보고 싶어서").
const MAJOR_ORDER = ["재정", "인사·교직원", "학사", "운영", "시설·안전", "입학·홍보", "행정·문서", "정보보안·법무"];

type StatusCounts = { 보유: number; 부분보유: number; 미보유: number };

function emptyCounts(): StatusCounts {
  return { 보유: 0, 부분보유: 0, 미보유: 0 };
}

export default function GiaSystemsClient({ initialSystems }: { initialSystems: GiaSystem[] }) {
  const [systems, setSystems] = useState<GiaSystem[]>(initialSystems);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposedIds, setProposedIds] = useState<Set<string>>(new Set());
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [creatingDocId, setCreatingDocId] = useState<string | null>(null);
  // 항목명/설명 수정(요청: "모든 항목들(시스템의항목들이나...)은 편집 가능하도록") - 관리자·
  // 행정직원 모두 여기서 이름/설명을 직접 고칠 수 있습니다. 대분류/중분류(major/category)는
  // 트리 구조와 AI 매칭 기준이라 실수로 깨지기 쉬워 여기서는 건드리지 않고, 이름/설명만 다룹니다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; description: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // 대분류→중분류→세부 항목 3단 아코디언(요청: "시설안전 항목을 누르면 보안,출입/시설관리
  // 두개의 하위항목이 보이고 그중에서 보안,출입을 누르면 그 하위항목들이 보이게 해줘 -
  // 전체적인 시스템 항목을 한눈에 보고싶어서"). 대분류를 눌러야 그 밑의 중분류 목록이 보이고,
  // 중분류를 눌러야 비로소 세부 항목이 보입니다 - 기본은 전부 접혀있어 전체 구조를 한눈에
  // 훑어볼 수 있습니다.
  const [openMajors, setOpenMajors] = useState<Set<string>>(new Set());
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());

  function toggleMajor(major: string) {
    setOpenMajors((prev) => {
      const next = new Set(prev);
      if (next.has(major)) next.delete(major);
      else next.add(major);
      return next;
    });
  }

  function toggleCategory(key: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 대분류 > 중분류 > 항목 3단 트리로 묶습니다(요청: "대분류항목에서부터 더 들어가서
  // 운영-교직원-교직원계약서 이런식으로 항목을 세분화").
  const tree = useMemo(() => {
    const majorMap = new Map<string, Map<string, GiaSystem[]>>();
    for (const s of systems) {
      const major = s.major || "(미분류)";
      const categoryMap = majorMap.get(major) ?? new Map<string, GiaSystem[]>();
      const list = categoryMap.get(s.category) ?? [];
      list.push(s);
      categoryMap.set(s.category, list);
      majorMap.set(major, categoryMap);
    }
    const majors = [...majorMap.keys()].sort((a, b) => {
      const ia = MAJOR_ORDER.indexOf(a);
      const ib = MAJOR_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    // 요청: "항목들은 기본적으로 가나다순으로 정렬" - 중분류는 이미 가나다순이었지만, 그 안의
    // 세부 항목은 등록된 순서 그대로였어서 여기서도 이름 기준으로 정렬합니다. 대분류 순서는
    // 이전 요청("전체적인 시스템 항목을 한눈에 보고 싶어서")에 따라 고정 순서(MAJOR_ORDER)를
    // 그대로 유지합니다.
    return majors.map((major) => ({
      major,
      categories: [...majorMap.get(major)!.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], "ko"))
        .map(([category, items]) => [category, [...items].sort((a, b) => a.name.localeCompare(b.name, "ko"))] as [string, GiaSystem[]]),
    }));
  }, [systems]);

  const summary = useMemo(() => {
    const counts = emptyCounts();
    for (const s of systems) counts[s.status]++;
    return counts;
  }, [systems]);

  function countOf(items: GiaSystem[]): StatusCounts {
    const c = emptyCounts();
    for (const s of items) c[s.status]++;
    return c;
  }

  async function suggest() {
    setSuggesting(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/gia-systems-suggest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "제안을 생성하지 못했습니다.");
      const rows = (json.rows ?? []) as GiaSystem[];
      if (rows.length === 0) {
        setError("새로 제안할 만한 항목을 찾지 못했습니다(이미 대부분 반영됐거나, 검색 결과가 충분하지 않았습니다).");
      } else {
        setSystems((prev) => [...prev, ...rows]);
      }
    } catch (err) {
      setError(friendlyError("벤치마킹 제안을 받아오지 못했습니다.", err));
    } finally {
      setSuggesting(false);
    }
  }

  async function updateStatus(id: string, status: GiaSystem["status"]) {
    setSystems((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    const supabase = createClient();
    const { error } = await supabase.from("gia_systems").update({ status }).eq("id", id);
    if (error) setError(friendlyError("상태를 변경하지 못했습니다.", error));
  }

  function startEdit(s: GiaSystem) {
    setEditingId(s.id);
    setEditDraft({ name: s.name, description: s.description ?? "" });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    if (!editDraft.name.trim()) {
      setError("항목명을 입력해주세요.");
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("gia_systems")
        .update({ name: editDraft.name.trim(), description: editDraft.description.trim() || null })
        .eq("id", id);
      if (err) throw new Error(err.message);
      setSystems((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name: editDraft.name.trim(), description: editDraft.description.trim() || null } : s))
      );
      setEditingId(null);
      setEditDraft(null);
    } catch (err) {
      setError(friendlyError("항목을 수정하지 못했습니다.", err));
    } finally {
      setSavingId(null);
    }
  }

  async function sendToProposals(s: GiaSystem) {
    setProposingId(s.id);
    try {
      const supabase = createClient();
      const finalText = [s.name, s.description, s.benchmark_school ? `(참고 사례: ${s.benchmark_school})` : null]
        .filter(Boolean)
        .join("\n\n");
      const { error } = await supabase.from("proposals").insert({
        case_id: genCaseId("PRP"),
        source: "system",
        source_id: s.id,
        date: new Date().toISOString().slice(0, 10),
        target_doc: "실무자용",
        category: s.category,
        final_text: finalText,
      });
      if (error) throw new Error(error.message);
      setProposedIds((prev) => new Set(prev).add(s.id));
    } catch (err) {
      setError(friendlyError("운영관리 제안함으로 보내지 못했습니다.", err));
    } finally {
      setProposingId(null);
    }
  }

  // 요청 3번: "필요한 서류가 있다면 서류함에 만들어주고, 서류함에 만들때에도 이 분류를 그대로
  // 적용해서 서류도 자동으로 분류화 되도록". GIA시스템 항목의 major/category(대분류/중분류)를
  // 그대로 documents.category_major/category에 넣어서 만들고, gia_systems.document_id로
  // 연결해두면 다음부터는 새로 만들지 않고 바로 서류함으로 이동할 수 있습니다.
  async function createDocument(s: GiaSystem) {
    setCreatingDocId(s.id);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("documents")
        .insert({
          case_id: genCaseId("DOC"),
          name: s.name,
          category: s.category,
          category_major: s.major,
          gia_system_id: s.id,
          status: "필요",
          notes: `GIA시스템 "${s.major} / ${s.category}" 항목에서 자동 생성됨${s.description ? `\n${s.description}` : ""}`,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const { error: updateErr } = await supabase
        .from("gia_systems")
        .update({ document_id: data.id })
        .eq("id", s.id);
      if (updateErr) throw new Error(updateErr.message);
      setSystems((prev) => prev.map((x) => (x.id === s.id ? { ...x, document_id: data.id } : x)));
    } catch (err) {
      setError(friendlyError("서류함에 만들지 못했습니다.", err));
    } finally {
      setCreatingDocId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-lg font-bold">🧩 GIA시스템</h1>
          <p className="text-xs text-slate-500">
            다른 공립·사립·국제학교가 일반적으로 갖추는 운영 시스템을 대분류→중분류→세부 항목으로
            세분화해서, GIA가 이미 갖췄는지 한눈에 봅니다. &quot;운영관리 제안함으로 보내기&quot;를
            누르면 기존 제안함→채택예정→발행 절차를 그대로 거치고, 발행되는 순간 이 표의 상태가
            자동으로 &quot;보유&quot;로 바뀝니다.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={suggest}
            disabled={suggesting}
            title="기존 항목은 그대로 두고, 새로 추가할 것이나 더 세분화할 것이 있는지만 체크합니다."
            className="shrink-0 rounded-lg bg-gia-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {suggesting ? "검색 중..." : "✨ AI로 추가/세분화 체크"}
          </button>
          <GuideButton title="GIA시스템 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
      </div>

      <div className="mb-4 flex gap-2 text-xs">
        <span className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-700">보유 {summary.보유}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">부분보유 {summary.부분보유}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-500">미보유 {summary.미보유}</span>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

      <div className="flex flex-col gap-2">
        {tree.map(({ major, categories }) => {
          const majorItems = categories.flatMap(([, items]) => items);
          const majorOpen = openMajors.has(major);
          const majorCounts = countOf(majorItems);
          return (
            <div key={major} className="overflow-hidden g-panel-solid">
              <button
                type="button"
                onClick={() => toggleMajor(major)}
                className="flex w-full items-center justify-between gap-2 bg-gia-navy/5 px-4 py-3 text-left hover:bg-gia-navy/10"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-gia-navy">
                  <span className={"inline-block transition-transform " + (majorOpen ? "rotate-90" : "")}>▶</span>
                  {major}
                  <span className="text-xs font-normal text-slate-400">
                    ({categories.length}개 중분류 · {majorItems.length}개 항목)
                  </span>
                </span>
                <span className="flex shrink-0 gap-1 text-[10px]">
                  {majorCounts.보유 > 0 && (
                    <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">보유 {majorCounts.보유}</span>
                  )}
                  {majorCounts.부분보유 > 0 && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">부분 {majorCounts.부분보유}</span>
                  )}
                  {majorCounts.미보유 > 0 && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">미보유 {majorCounts.미보유}</span>
                  )}
                </span>
              </button>

              {majorOpen && (
                <div className="flex flex-col gap-1.5 divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60 p-2">
                  {categories.map(([category, items]) => {
                    const catKey = `${major}::${category}`;
                    const catOpen = openCategories.has(catKey);
                    const catCounts = countOf(items);
                    return (
                      <div key={catKey} className="overflow-hidden g-panel-solid pt-1.5 first:pt-0">
                        <button
                          type="button"
                          onClick={() => toggleCategory(catKey)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
                        >
                          <span className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <span className={"inline-block transition-transform " + (catOpen ? "rotate-90" : "")}>▶</span>
                            {category}
                            <span className="text-[10px] font-normal text-slate-400">({items.length}개)</span>
                          </span>
                          <span className="flex shrink-0 gap-1 text-[10px]">
                            {catCounts.보유 > 0 && (
                              <span className="rounded-full bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">보유 {catCounts.보유}</span>
                            )}
                            {catCounts.부분보유 > 0 && (
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-700">부분 {catCounts.부분보유}</span>
                            )}
                            {catCounts.미보유 > 0 && (
                              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">미보유 {catCounts.미보유}</span>
                            )}
                          </span>
                        </button>

                        {catOpen && (
                          <div className="divide-y divide-slate-100 border-t border-slate-100">
                            {items.map((s) => (
                              <div key={s.id} className="px-4 py-3">
                                {editingId === s.id && editDraft ? (
                                  <div className="flex flex-col gap-2">
                                    <input
                                      value={editDraft.name}
                                      onChange={(e) => setEditDraft((d) => (d ? { ...d, name: e.target.value } : d))}
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
                                        onClick={() => saveEdit(s.id)}
                                        disabled={savingId === s.id}
                                        className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                      >
                                        {savingId === s.id ? "저장 중..." : "저장"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="mb-1 flex flex-wrap items-center gap-2">
                                      <span className={"rounded-full px-2 py-0.5 text-[10px] font-semibold " + STATUS_STYLE[s.status]}>
                                        {s.status}
                                      </span>
                                      {s.source === "ai_suggested" && (
                                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-600">
                                          AI 제안
                                        </span>
                                      )}
                                      <span className="text-sm font-semibold text-slate-800">{s.name}</span>
                                    </div>
                                    {s.refines_name && (
                                      <p className="mb-1 text-[11px] font-medium text-purple-600">
                                        🔍 기존 &quot;{s.refines_name}&quot; 항목을 더 구체적으로 세분화한 제안입니다 (원본 항목은
                                        그대로 유지됩니다).
                                      </p>
                                    )}
                                    {s.description && <p className="mb-1 text-xs text-slate-600">{s.description}</p>}
                                    {s.benchmark_school && (
                                      <p className="mb-2 text-[11px] text-slate-400">참고 사례: {s.benchmark_school}</p>
                                    )}
                                    {s.related_manual_category && (
                                      <p className="mb-2 text-[11px] text-amber-600">
                                        📎 발행된 매뉴얼(&quot;{s.related_manual_target_doc}&quot; · {s.related_manual_category})에
                                        이미 이 시스템 이름이 언급되어 있어요 - 실제로 갖춰져 있다면 상태를 확인해 &quot;보유&quot;로
                                        바꿔주세요.
                                      </p>
                                    )}
                                    <div className="flex flex-wrap items-center gap-2">
                                      <select
                                        value={s.status}
                                        onChange={(e) => updateStatus(s.id, e.target.value as GiaSystem["status"])}
                                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                                      >
                                        {STATUSES.map((st) => (
                                          <option key={st} value={st}>
                                            {st}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => startEdit(s)}
                                        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                                      >
                                        ✏️ 수정
                                      </button>
                                      {s.status === "미보유" &&
                                        (proposedIds.has(s.id) ? (
                                          <Link href="/proposals" className="text-xs font-semibold text-blue-500 hover:underline">
                                            운영관리 제안함에서 확인 →
                                          </Link>
                                        ) : (
                                          <button
                                            onClick={() => sendToProposals(s)}
                                            disabled={proposingId === s.id}
                                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                          >
                                            {proposingId === s.id ? "보내는 중..." : "운영관리 제안함으로 보내기"}
                                          </button>
                                        ))}
                                      {s.document_id ? (
                                        <Link
                                          href="/documents"
                                          className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50"
                                        >
                                          📁 서류함에서 보기 →
                                        </Link>
                                      ) : (
                                        <button
                                          onClick={() => createDocument(s)}
                                          disabled={creatingDocId === s.id}
                                          className="rounded-lg border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                                          title="이 항목에 필요한 서류를 서류함에 같은 분류로 만듭니다."
                                        >
                                          {creatingDocId === s.id ? "만드는 중..." : "📁 서류함에 만들기"}
                                        </button>
                                      )}
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
                </div>
              )}
            </div>
          );
        })}
        {systems.length === 0 && (
          <p className="g-panel-solid p-6 text-center text-sm text-slate-400">
            등록된 시스템이 없습니다. &quot;AI로 추가/세분화 체크&quot;로 시작해보세요.
          </p>
        )}
      </div>
    </div>
  );
}
