"use client";

import { useState } from "react";
import type { StaffRequestCategoryRow } from "@/lib/types";
import { useToast } from "@/components/common/ToastProvider";

// 행정요청 카테고리 관리 패널(요청: "사물함파손,물품구입 등을 관리자가 등록/편집할 수 있게",
// 이후 "카테고리 관리는 교사 이외의 권한들이 전부 할 수 있게 해줘"). 카테고리를 지우면 기존
// 요청들이 참조를 잃으므로, 삭제 대신 표시 여부(active)만 끄고 켤 수 있습니다.
//
// 두 화면에서 재사용합니다(요청: "업무상황판에... 톱니바퀴 아이콘을 만들어서 거기에서 카테고리
// 관리할 수 있도록"): /requests 페이지에서는 접었다 펼 수 있는 노란 패널(variant="panel"),
// 업무 탭 톱니바퀴 팝업 안에서는 이미 팝업 자체가 펼침 동작이라 헤더 없이 본문만 보여주는
// (variant="inline") 형태로 씁니다.
export default function CategoryManager({
  categories,
  onCategoriesChange,
  variant = "panel",
}: {
  categories: StaffRequestCategoryRow[];
  onCategoriesChange: (next: StaffRequestCategoryRow[]) => void;
  variant?: "panel" | "inline";
}) {
  const notify = useToast();
  const [open, setOpen] = useState(variant === "inline");
  const [newKo, setNewKo] = useState("");
  const [newEn, setNewEn] = useState("");
  const [newIcon, setNewIcon] = useState("📎");
  const [submitting, setSubmitting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newKo.trim() || !newEn.trim()) return;
    setSubmitting(true);
    const res = await fetch("/api/staff-request-categories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: newKo.trim(), labelEn: newEn.trim(), icon: newIcon.trim() || "📎" }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      notify(data.error || "카테고리를 추가하지 못했습니다. / Failed to add category.", "error");
      return;
    }
    onCategoriesChange([...categories, data.item as StaffRequestCategoryRow]);
    setNewKo("");
    setNewEn("");
    setNewIcon("📎");
  }

  async function toggleActive(cat: StaffRequestCategoryRow) {
    setBusyKey(cat.category);
    const res = await fetch(`/api/staff-request-categories/${encodeURIComponent(cat.category)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !cat.active }),
    });
    const data = await res.json();
    setBusyKey(null);
    if (!res.ok) {
      notify(data.error || "저장하지 못했습니다. / Failed to save.", "error");
      return;
    }
    onCategoriesChange(categories.map((c) => (c.category === cat.category ? (data.item as StaffRequestCategoryRow) : c)));
  }

  const body = (
    <>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <div
            key={c.category}
            className={
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs " +
              (c.active ? "border-slate-300 bg-white text-slate-600" : "border-slate-200 bg-slate-100 text-slate-400 line-through")
            }
          >
            <span>{c.icon}</span>
            <span>{c.category}</span>
            <span className="text-[10px] opacity-70">/ {c.label_en}</span>
            <button
              type="button"
              onClick={() => toggleActive(c)}
              disabled={busyKey === c.category}
              className="ml-1 text-[10px] font-semibold text-blue-600 hover:underline disabled:opacity-50"
            >
              {c.active ? "숨기기·Hide" : "보이기·Show"}
            </button>
          </div>
        ))}
        {categories.length === 0 && <p className="text-xs text-slate-400">등록된 카테고리가 없습니다.</p>}
      </div>
      <form onSubmit={addCategory} className="flex flex-wrap items-center gap-1.5">
        <input
          value={newIcon}
          onChange={(e) => setNewIcon(e.target.value)}
          placeholder="🎨"
          className="w-12 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-center"
        />
        <input
          value={newKo}
          onChange={(e) => setNewKo(e.target.value)}
          placeholder="새 카테고리(한글) · New category (Korean)"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <input
          value={newEn}
          onChange={(e) => setNewEn(e.target.value)}
          placeholder="English label"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={submitting || !newKo.trim() || !newEn.trim()}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
        >
          + 추가 · Add
        </button>
      </form>
    </>
  );

  if (variant === "inline") {
    return <div className="w-72 max-w-[80vw]">{body}</div>;
  }

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-amber-700"
      >
        <span>⚙️ 카테고리 관리 · Manage Categories</span>
        <span>{open ? "접기 ‹" : "펼치기 ›"}</span>
      </button>
      {open && <div className="border-t border-amber-200 p-3">{body}</div>}
    </div>
  );
}
