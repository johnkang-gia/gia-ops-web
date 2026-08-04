"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type { Inquiry } from "@/lib/types";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useToast } from "@/components/common/ToastProvider";

// 문의가 쌓일수록 목록이 끝없이 길어지지 않도록, 게시판처럼 페이지 단위로 잘라 보여줍니다.
const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "🗣️ 문의및 건의사항이란?",
    lines: ["시스템 오류 신고나 개선 건의사항을 남기는 곳입니다. 카테고리(오류/건의 등)를 골라 작성하면 개발자가 확인 후 처리 상태를 갱신합니다."],
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  오류: "🐞 오류",
  기능제안: "💡 기능제안",
  기타: "💬 기타",
};

const STATUS_STYLE: Record<string, string> = {
  접수: "bg-slate-100 text-slate-600",
  처리중: "bg-amber-100 text-amber-700",
  완료: "bg-emerald-100 text-emerald-700",
};

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function InquiriesClient({
  initialItems,
  isDeveloper,
  currentUserEmail,
}: {
  initialItems: Inquiry[];
  isDeveloper: boolean;
  currentUserEmail: string;
}) {
  const notify = useToast();
  const [items, setItems] = useRealtimeTable<Inquiry>("inquiries", initialItems);
  const [category, setCategory] = useState<"오류" | "기능제안" | "기타">("오류");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: string; note: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("제목과 내용을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, title, content }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "등록하지 못했습니다.");
      return;
    }
    setItems((prev) => [data.item as Inquiry, ...prev]);
    setTitle("");
    setContent("");
  }

  async function saveDeveloperUpdate(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    const res = await fetch(`/api/inquiries/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: draft.status, developerNote: draft.note }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      notify(data.error || "저장하지 못했습니다.", "error");
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? (data.item as Inquiry) : it)));
  }

  const visibleItems = isDeveloper ? items : items.filter((it) => it.reporter_email === currentUserEmail);

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => visibleItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visibleItems, page]
  );
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  // 목록이 갱신되어(새 문의 등록 등) 전체 건수가 바뀌면 현재 보던 페이지가 더 이상 유효하지
  // 않을 수 있어 1페이지로 되돌립니다.
  useEffect(() => {
    setPage(1);
  }, [visibleItems.length]);

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">문의및 건의사항</h1>
          <GuideButton title="문의및 건의사항 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          오류를 발견했거나 앱에 추가되면 좋을 기능이 있으면 남겨주세요. 개발자가 확인 후 상태와
          답변을 남깁니다.
        </p>

        <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex gap-1.5">
            {(["오류", "기능제안", "기타"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-semibold transition " +
                  (category === c
                    ? "border-gia-navy bg-gia-navy text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50")
                }
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            제목
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={category === "오류" ? "예: 회의록 저장 시 오류 발생" : "예: 사건기록에 사진 첨부 기능 추가"}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-500">
            내용
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              placeholder="어떤 상황에서 무슨 일이 있었는지, 또는 어떤 기능이 필요한지 자유롭게 적어주세요."
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-fit rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
          >
            {submitting ? "등록 중..." : "등록"}
          </button>
        </form>

        <h2 className="mb-2 text-sm font-bold text-slate-700">
          {isDeveloper ? `전체 문의 (${visibleItems.length}건)` : `내가 남긴 문의 (${visibleItems.length}건)`}
        </h2>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {visibleItems.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">등록된 문의가 없습니다.</div>
        )}
        {pageItems.map((it) => {
          const expanded = expandedId === it.id;
          const draft = drafts[it.id] ?? { status: it.status, note: it.developer_note ?? "" };
          const busy = busyId === it.id;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(expanded ? null : it.id)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
              >
                <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline-block">
                  {CATEGORY_LABEL[it.category] ?? it.category}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{oneLine(it.title)}</span>
                {isDeveloper && (
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">{it.reporter_email}</span>
                )}
                <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs " + (STATUS_STYLE[it.status] ?? "")}>
                  {it.status}
                </span>
                <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <div className="mb-2 text-xs text-slate-400">
                    {it.reporter_email} · {it.created_at.slice(0, 10)}
                  </div>
                  <p className="mb-3 whitespace-pre-wrap">{it.content}</p>

                  {!isDeveloper && it.developer_note && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                      <div className="mb-1 font-semibold text-blue-800">개발자 답변</div>
                      <p className="whitespace-pre-wrap text-blue-900">{it.developer_note}</p>
                    </div>
                  )}

                  {isDeveloper && (
                    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        상태
                        <select
                          value={draft.status}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [it.id]: { ...draft, status: e.target.value } }))
                          }
                          className="w-fit rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="접수">접수</option>
                          <option value="처리중">처리중</option>
                          <option value="완료">완료</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        답변/메모
                        <textarea
                          value={draft.note}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, note: e.target.value } }))}
                          rows={3}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        onClick={() => saveDeveloperUpdate(it.id)}
                        disabled={busy}
                        className="w-fit rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                      >
                        {busy ? "저장 중..." : "저장"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0">
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
