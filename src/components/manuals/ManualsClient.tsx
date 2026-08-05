"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection, ManualReviewFlag, ManualSectionHistory } from "@/lib/types";
import { toDisplayHtml } from "@/lib/manualHtml";
// 빌드 최적화: 리치 텍스트 에디터(tiptap)는 무겁고, 실제로는 "추가"나 "수정"을 눌러야만
// 화면에 나타납니다(요청: "지금까지의 빌드 최적화 해주고"). 항상 정적으로 불러오면 매뉴얼을
// 그냥 읽기만 하는 대다수 방문(목록 조회)에서도 에디터 JS까지 다 받아야 했는데, next/dynamic으로
// 바꿔서 실제로 편집 화면을 열 때만 별도 청크로 내려받도록 했습니다.
const RichTextEditor = dynamic(() => import("@/components/manuals/RichTextEditor"), {
  ssr: false,
  loading: () => <div className="h-24 animate-pulse rounded-lg bg-slate-100" />,
});
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import { useEditPresence } from "@/lib/useEditPresence";

const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "📖 매뉴얼이란?",
    lines: [
      "채택예정에서 발행한 내용이 자동으로 쌓이거나, 직접 항목을 추가·수정·삭제할 수 있습니다. 구글독스처럼 굵게·목록·제목 서식을 적용해 편집할 수 있습니다.",
      "\"PDF로 보기/다운로드\"로 지금 화면의 최신 내용을 인쇄용 PDF로 만들 수 있습니다.",
    ],
  },
];

type TargetDoc = "학부모용" | "실무자용";

const FAQ_CATEGORY = "자주 묻는 질문(FAQ)";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildFaqHtml(faqs: { question: string; answer: string }[]): string {
  return faqs
    .map(
      (f) =>
        `<p><strong>Q. ${escapeHtml(f.question)}</strong></p><p>A. ${escapeHtml(f.answer)}</p>`
    )
    .join("<p></p>");
}

const TABS: { title: string; doc: TargetDoc; icon: string }[] = [
  { title: "GIA 운영계획안 (학부모 배포용)", doc: "학부모용", icon: "📘" },
  { title: "GIA 실무자매뉴얼", doc: "실무자용", icon: "📗" },
];

// 요청 1번(원본 사건/회의 역참조 링크): 매뉴얼 항목에 개별 기록 상세 페이지가 따로 없어서,
// 딱 그 기록으로 바로 이동시키기보다는 해당 기록이 있는 목록 화면으로 연결합니다(간단하지만
// 확실하게 "어디서 왔는지"를 확인할 수 있는 수준의 링크).
const SOURCE_LINK: Record<string, { href: string; label: string }> = {
  incidents: { href: "/records", label: "사건기록" },
  events: { href: "/events", label: "행사기록" },
  meetings: { href: "/meetings", label: "회의기록" },
  manual: { href: "/ai-manual", label: "AI 매뉴얼 작성" },
  complaint: { href: "/proposals?tab=complaint", label: "예상 문의/컴플레인" },
  system: { href: "/admin/gia-systems", label: "GIA시스템" },
};

export default function ManualsClient({
  initialItems,
  initialDoc,
  me,
  recurringCategoryCounts = {},
  initialReviewFlags = [],
  isAdmin = false,
}: {
  initialItems: ManualSection[];
  initialDoc?: TargetDoc;
  me: { email: string; name: string } | null;
  recurringCategoryCounts?: Record<string, number>;
  initialReviewFlags?: ManualReviewFlag[];
  isAdmin?: boolean;
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [items, setItems] = useState<ManualSection[]>(initialItems);
  const [activeDoc, setActiveDoc] = useState<TargetDoc>(initialDoc ?? "학부모용");
  const [page, setPage] = useState(1);

  // 학부모용/실무자용 탭을 바꾸면 목록이 달라지므로 이전 페이지 번호와 도메인 필터가 남아있지
  // 않도록 리셋합니다.
  useEffect(() => {
    setPage(1);
    setDomainFilter("전체");
  }, [activeDoc]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editRequiresSignature, setEditRequiresSignature] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [addingOpen, setAddingOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newRequiresSignature, setNewRequiresSignature] = useState(false);

  const [faqLoading, setFaqLoading] = useState(false);
  const [faqError, setFaqError] = useState("");
  const [faqPreview, setFaqPreview] = useState<{ question: string; answer: string }[] | null>(null);
  const [faqSaving, setFaqSaving] = useState(false);

  // 요청 4번(정책영역 필터), 8번(정기 리뷰 플래그)
  const [domainFilter, setDomainFilter] = useState<string>("전체");
  const [reviewFlags, setReviewFlags] = useState<ManualReviewFlag[]>(initialReviewFlags);
  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);

  // 요청 5번(변경 이력): 항목별로 펼쳤을 때만 조회합니다(평소에는 목록에 아무 부담이 없도록).
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<ManualSectionHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function toggleHistory(sectionId: string) {
    if (historyOpenId === sectionId) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(sectionId);
    setHistoryLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("manual_section_history")
      .select("*")
      .eq("section_id", sectionId)
      .order("changed_at", { ascending: false });
    setHistoryRows((data as ManualSectionHistory[]) ?? []);
    setHistoryLoading(false);
  }

  async function resolveFlag(flagId: string) {
    setResolvingFlagId(flagId);
    const supabase = createClient();
    const { error: resolveErr } = await supabase
      .from("manual_review_flags")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", flagId);
    setResolvingFlagId(null);
    if (resolveErr) {
      notify(resolveErr.message || "처리하지 못했습니다.", "error");
      return;
    }
    setReviewFlags((prev) => prev.filter((f) => f.id !== flagId));
  }

  // 동시접속 안전장치: 지금 이 문서(학부모용/실무자용)에서 다른 사람이 어떤 항목을 편집 중인지
  // 실시간으로 알려줍니다. 편집 버튼을 누르는 순간 자기 편집 상태를 다른 화면에도 알립니다.
  const editors = useEditPresence(`manuals-${activeDoc}`, me, editingId);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("manual-sections-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manual_sections" },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as ManualSection;
            const exists = prev.some((it) => it.id === next.id);
            const merged = exists
              ? prev.map((it) => (it.id === next.id ? next : it))
              : [...prev, next];
            return [...merged].sort(
              (a, b) =>
                a.target_doc.localeCompare(b.target_doc) || a.category.localeCompare(b.category)
            );
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function startEdit(s: ManualSection) {
    setEditingId(s.id);
    setEditCategory(s.category);
    setEditContent(toDisplayHtml(s.content));
    setEditRequiresSignature(Boolean(s.requires_signature));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  async function saveEdit(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/manuals/sections/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        category: editCategory,
        content: editContent,
        requiresSignature: editRequiresSignature,
      }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "저장하지 못했습니다.");
      return;
    }
    setEditingId(null);
  }

  async function deleteSection(id: string) {
    if (!(await confirmAction("이 항목을 삭제할까요? 매뉴얼에서 완전히 사라집니다.", { danger: true }))) return;
    setBusyId(id);
    const res = await fetch(`/api/manuals/sections/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      notify(data.error || "삭제하지 못했습니다.", "error");
    }
  }

  async function createSection(doc: TargetDoc) {
    if (!newCategory.trim()) {
      setError("항목(카테고리) 이름을 입력해주세요.");
      return;
    }
    setAdding(true);
    setError(null);
    const res = await fetch("/api/manuals/sections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetDoc: doc,
        category: newCategory,
        content: newContent,
        requiresSignature: newRequiresSignature,
      }),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setError(data.error || "추가하지 못했습니다.");
      return;
    }
    setAddingOpen(false);
    setNewCategory("");
    setNewContent("");
    setNewRequiresSignature(false);
  }

  async function generateFaq() {
    setFaqLoading(true);
    setFaqError("");
    setFaqPreview(null);
    const res = await fetch("/api/ai/manual-faq", { method: "POST" });
    const data = await res.json();
    setFaqLoading(false);
    if (!res.ok) {
      setFaqError(data.error || "FAQ를 만들지 못했습니다.");
      return;
    }
    setFaqPreview(data.faqs);
  }

  async function saveFaqToManual() {
    if (!faqPreview || faqPreview.length === 0) return;
    setFaqSaving(true);
    setFaqError("");
    const html = buildFaqHtml(faqPreview);
    const existing = items.find((it) => it.target_doc === "학부모용" && it.category === FAQ_CATEGORY);
    const res = existing
      ? await fetch(`/api/manuals/sections/${existing.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: html }),
        })
      : await fetch("/api/manuals/sections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetDoc: "학부모용", category: FAQ_CATEGORY, content: html }),
        });
    const data = await res.json();
    setFaqSaving(false);
    if (!res.ok) {
      setFaqError(data.error || "매뉴얼에 반영하지 못했습니다.");
      return;
    }
    setFaqPreview(null);
  }

  const activeTab = TABS.find((t) => t.doc === activeDoc)!;
  const docItemsAll = items.filter((it) => it.target_doc === activeDoc);
  const availableDomains = Array.from(
    new Set(docItemsAll.map((it) => it.domain).filter((d): d is string => Boolean(d)))
  ).sort();
  const docItems =
    domainFilter === "전체" ? docItemsAll : docItemsAll.filter((it) => it.domain === domainFilter);
  const totalPages = Math.max(1, Math.ceil(docItems.length / PAGE_SIZE));
  const pageItems = useMemo(
    () => docItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [docItems, page]
  );

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col overflow-hidden">
      <div className="shrink-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">매뉴얼</h1>
        <GuideButton title="매뉴얼 사용 가이드" sections={GUIDE_SECTIONS} />
      </div>
      <p className="mb-4 text-sm text-slate-500">
        채택예정에서 발행한 내용이 자동으로 쌓이거나, 아래에서 직접 항목을 추가·수정·삭제할 수
        있습니다. 구글독스처럼 굵게·목록·제목 등 서식을 적용해 편집할 수 있고, 우측 상단
        &quot;PDF로 보기/다운로드&quot;는 지금 이 화면의 최신 내용을 그대로 인쇄용 PDF로
        만들어줍니다.
      </p>

      {isAdmin && reviewFlags.length > 0 && (
        <div className="mb-4 flex flex-col gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-800">
            🔔 정기 리뷰가 필요한 항목이 {reviewFlags.length}건 있어요
          </div>
          {reviewFlags.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs">
              <span className="text-slate-600">
                <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  {f.reason}
                </span>
                {f.detail}
              </span>
              <button
                onClick={() => resolveFlag(f.id)}
                disabled={resolvingFlagId === f.id}
                className="rounded-lg border border-amber-300 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                {resolvingFlagId === f.id ? "처리 중..." : "확인 완료"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.doc}
            onClick={() => {
              setActiveDoc(t.doc);
              setEditingId(null);
              setAddingOpen(false);
              setError(null);
            }}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              activeDoc === t.doc
                ? "border border-b-white border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-700"
            }`}
            style={activeDoc === t.doc ? { marginBottom: "-1px" } : undefined}
          >
            {t.icon} {t.doc}
          </button>
        ))}
      </div>
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">{activeTab.title}</h2>
          <div className="flex flex-wrap items-center gap-2">
            {availableDomains.length > 0 && (
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-600"
              >
                <option value="전체">전체 정책영역</option>
                {availableDomains.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
            {activeDoc === "학부모용" && (
              <button
                onClick={generateFaq}
                disabled={faqLoading}
                className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 disabled:opacity-50"
              >
                {faqLoading ? "AI가 만드는 중..." : "❓ FAQ 자동 생성"}
              </button>
            )}
            <button
              onClick={() => {
                setAddingOpen((v) => !v);
                setNewCategory("");
                setNewContent("");
                setNewRequiresSignature(false);
                setError(null);
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              + 새 항목 추가
            </button>
            <a
              href={`/api/manuals/pdf?doc=${encodeURIComponent(activeDoc)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2"
            >
              🖨️ PDF로 보기/다운로드
            </a>
          </div>
        </div>

        {faqError && <p className="mb-3 text-sm text-red-600">{faqError}</p>}

        {faqPreview && (
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <div className="mb-2 text-sm font-semibold text-blue-800">
              AI가 만든 FAQ 미리보기 ({faqPreview.length}개) - 반영하면 &quot;{FAQ_CATEGORY}&quot; 항목으로 저장됩니다
            </div>
            <div className="mb-3 flex max-h-80 flex-col gap-2 overflow-y-auto">
              {faqPreview.map((f, i) => (
                <div key={i} className="rounded-lg bg-white p-2 text-xs">
                  <div className="font-semibold text-slate-700">Q. {f.question}</div>
                  <div className="mt-1 text-slate-600">A. {f.answer}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={saveFaqToManual}
                disabled={faqSaving}
                className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
              >
                {faqSaving ? "반영 중..." : "매뉴얼에 반영"}
              </button>
              <button
                onClick={() => setFaqPreview(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {addingOpen && (
          <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="항목(카테고리) 이름 - 예: 사건 대응 절차"
              className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
            <RichTextEditor content={newContent} onChange={setNewContent} minHeight="8rem" />
            {activeDoc === "학부모용" && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={newRequiresSignature}
                  onChange={(e) => setNewRequiresSignature(e.target.checked)}
                />
                ✍️ 서명이 필요한 항목이에요(환불 규정, 안전 수칙 등 - PDF에 서명란이 자동으로 들어갑니다)
              </label>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => createSection(activeDoc)}
                disabled={adding}
                className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
              >
                {adding ? "추가 중..." : "추가"}
              </button>
              <button
                onClick={() => setAddingOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </div>
        )}
        </div>

        <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
          {docItems.length === 0 && !addingOpen && (
            <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
              아직 항목이 없습니다.
            </div>
          )}
          {pageItems.map((s) => {
            const isEditing = editingId === s.id;
            const busy = busyId === s.id;
            const otherEditors = editors.filter((e) => e.itemId === s.id);
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                {otherEditors.length > 0 && !isEditing && (
                  <div className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700">
                    ✏️ {otherEditors.map((e) => e.name).join(", ")}님이 지금 이 항목을 편집 중이에요 - 같이 수정하면 나중에 저장한 내용이 덮어쓸 수 있어요.
                  </div>
                )}
                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-semibold"
                    />
                    <RichTextEditor content={editContent} onChange={setEditContent} minHeight="10rem" />
                    {activeDoc === "학부모용" && (
                      <label className="flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={editRequiresSignature}
                          onChange={(e) => setEditRequiresSignature(e.target.checked)}
                        />
                        ✍️ 서명이 필요한 항목이에요(환불 규정, 안전 수칙 등 - PDF에 서명란이 자동으로 들어갑니다)
                      </label>
                    )}
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={busy}
                        className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                      >
                        {busy ? "저장 중..." : "저장"}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold">{s.category}</div>
                        {s.requires_signature && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                            ✍️ 서명 필요
                          </span>
                        )}
                        {s.domain && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            🏷️ {s.domain}
                          </span>
                        )}
                        {recurringCategoryCounts[s.category] && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                            🔥 최근 90일 반복 사건 {recurringCategoryCounts[s.category]}건
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => toggleHistory(s.id)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          {historyOpenId === s.id ? "이력 닫기" : "변경 이력"}
                        </button>
                        <button
                          onClick={() => startEdit(s)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => deleteSection(s.id)}
                          disabled={busy}
                          className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                    {s.content ? (
                      <div
                        className="prose prose-sm max-w-none text-xs text-slate-600"
                        dangerouslySetInnerHTML={{ __html: toDisplayHtml(s.content) }}
                      />
                    ) : (
                      <p className="text-xs text-slate-400">(내용 없음)</p>
                    )}

                    {s.sources && s.sources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                        {s.sources.map((src, i) => {
                          const link = SOURCE_LINK[src.source];
                          return link ? (
                            <a
                              key={`${src.source}-${src.source_id}-${i}`}
                              href={link.href}
                              className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
                            >
                              🔗 {link.label} · {src.source_id}
                            </a>
                          ) : null;
                        })}
                      </div>
                    )}

                    {historyOpenId === s.id && (
                      <div className="mt-2 rounded-lg bg-slate-50 p-2.5">
                        {historyLoading ? (
                          <p className="text-xs text-slate-400">불러오는 중...</p>
                        ) : historyRows.length === 0 ? (
                          <p className="text-xs text-slate-400">이전 변경 이력이 없습니다(현재가 첫 버전).</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {historyRows.map((h) => (
                              <div key={h.id} className="rounded-lg bg-white p-2 text-xs">
                                <div className="mb-1 text-[10px] font-semibold text-slate-400">
                                  {new Date(h.changed_at).toLocaleString("ko-KR")}
                                  {h.changed_by ? ` · ${h.changed_by}` : ""} 이전 내용
                                </div>
                                <div
                                  className="prose prose-sm max-w-none text-xs text-slate-500"
                                  dangerouslySetInnerHTML={{ __html: toDisplayHtml(h.content) }}
                                />
                              </div>
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
        <div className="shrink-0">
          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </div>
      </section>
    </div>
  );
}
