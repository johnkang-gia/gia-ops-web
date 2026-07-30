"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ManualSection } from "@/lib/types";

type TargetDoc = "학부모용" | "실무자용";

const GROUPS: { title: string; doc: TargetDoc }[] = [
  { title: "GIA 운영계획안 (학부모 배포용)", doc: "학부모용" },
  { title: "GIA 실무자매뉴얼", doc: "실무자용" },
];

export default function ManualsClient({ initialItems }: { initialItems: ManualSection[] }) {
  const [items, setItems] = useState<ManualSection[]>(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editContent, setEditContent] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addingDoc, setAddingDoc] = useState<TargetDoc | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);

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
    setEditContent(s.content);
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
      body: JSON.stringify({ category: editCategory, content: editContent }),
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
      body: JSON.stringify({ targetDoc: doc, category: newCategory, content: newContent }),
    });
    const data = await res.json();
    setAdding(false);
    if (!res.ok) {
      setError(data.error || "추가하지 못했습니다.");
      return;
    }
    setAddingDoc(null);
    setNewCategory("");
    setNewContent("");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-lg font-bold">매뉴얼</h1>
      <p className="mb-6 text-sm text-slate-500">
        채택예정에서 발행한 내용이 자동으로 쌓이거나, 아래에서 직접 항목을 추가·수정·삭제할 수
        있습니다. 우측 상단 &quot;PDF로 보기/다운로드&quot;는 지금 이 화면의 최신 내용을 그대로
        인쇄용 PDF로 만들어줍니다.
      </p>

      <div className="flex flex-col gap-8">
        {GROUPS.map((group) => {
          const groupItems = items.filter((it) => it.target_doc === group.doc);
          return (
            <section key={group.doc}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold">{group.title}</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setAddingDoc(addingDoc === group.doc ? null : group.doc);
                      setNewCategory("");
                      setNewContent("");
                      setError(null);
                    }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    + 새 항목 추가
                  </button>
                  <a
                    href={`/api/manuals/pdf?doc=${encodeURIComponent(group.doc)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                  >
                    🖨️ PDF로 보기/다운로드
                  </a>
                </div>
              </div>

              {addingDoc === group.doc && (
                <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <input
                    type="text"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="항목(카테고리) 이름 - 예: 사건 대응 절차"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <textarea
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="내용을 입력하세요"
                    rows={4}
                    className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => createSection(group.doc)}
                      disabled={adding}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {adding ? "추가 중..." : "추가"}
                    </button>
                    <button
                      onClick={() => setAddingDoc(null)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      취소
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {groupItems.length === 0 && addingDoc !== group.doc && (
                  <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                    아직 항목이 없습니다.
                  </div>
                )}
                {groupItems.map((s) => {
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
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            rows={6}
                            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                          />
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
                            <div className="text-sm font-semibold">{s.category}</div>
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
                          <p className="whitespace-pre-wrap text-xs text-slate-600">
                            {s.content || "(내용 없음)"}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
