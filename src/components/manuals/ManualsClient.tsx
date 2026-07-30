"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection } from "@/lib/types";
import { toDisplayHtml } from "@/lib/manualHtml";
import RichTextEditor from "@/components/manuals/RichTextEditor";

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

export default function ManualsClient({ initialItems }: { initialItems: ManualSection[] }) {
  const [items, setItems] = useState<ManualSection[]>(initialItems);
  const [activeDoc, setActiveDoc] = useState<TargetDoc>("학부모용");

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
    if (!confirm("이 항목을 삭제할까요? 매뉴얼에서 완전히 사라집니다.")) return;
    setBusyId(id);
    const res = await fetch(`/api/manuals/sections/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "삭제하지 못했습니다.");
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
  const docItems = items.filter((it) => it.target_doc === activeDoc);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-lg font-bold">매뉴얼</h1>
      <p className="mb-4 text-sm text-slate-500">
        채택예정에서 발행한 내용이 자동으로 쌓이거나, 아래에서 직접 항목을 추가·수정·삭제할 수
        있습니다. 구글독스처럼 굵게·목록·제목 등 서식을 적용해 편집할 수 있고, 우측 상단
        &quot;PDF로 보기/다운로드&quot;는 지금 이 화면의 최신 내용을 그대로 인쇄용 PDF로
        만들어줍니다.
      </p>

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

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">{activeTab.title}</h2>
          <div className="flex flex-wrap gap-2">
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
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
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
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
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
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
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

        <div className="flex flex-col gap-2">
          {docItems.length === 0 && !addingOpen && (
            <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
              아직 항목이 없습니다.
            </div>
          )}
          {docItems.map((s) => {
            const isEditing = editingId === s.id;
            const busy = busyId === s.id;
            return (
              <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
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
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold">{s.category}</div>
                        {s.requires_signature && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                            ✍️ 서명 필요
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
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
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
