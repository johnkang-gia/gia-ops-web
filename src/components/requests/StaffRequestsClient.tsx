"use client";

import { useEffect, useMemo, useState } from "react";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import { STAFF_REQUEST_CATEGORIES, type StaffRequest, type StaffRequestStatus } from "@/lib/types";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useToast } from "@/components/common/ToastProvider";

const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "🧾 행정요청이란?",
    lines: [
      "사물함 파손, 물품 구입, 아픈 학생 인계, 출결 상황 문의처럼 행정직원에게 부탁할 일을 등록하는 곳입니다.",
      "등록하면 행정직원/관리자가 확인하고 접수대기 → 처리중 → 완료로 상태를 바꿉니다. 처리 메모가 남으면 여기서 바로 볼 수 있습니다.",
    ],
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  사물함파손: "🔧 사물함파손",
  물품구입: "🛒 물품구입",
  아픈학생인계: "🏥 아픈학생인계",
  출결상황문의: "📋 출결상황문의",
  기타: "📎 기타",
};

const STATUS_STYLE: Record<string, string> = {
  접수대기: "bg-slate-100 text-slate-600",
  처리중: "bg-amber-100 text-amber-700",
  완료: "bg-emerald-100 text-emerald-700",
};

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

export default function StaffRequestsClient({
  initialItems,
  isManager,
  myEmail,
}: {
  initialItems: StaffRequest[];
  isManager: boolean;
  myEmail: string;
}) {
  const notify = useToast();
  const [items, setItems] = useRealtimeTable<StaffRequest>("staff_requests", initialItems);

  const [category, setCategory] = useState<(typeof STAFF_REQUEST_CATEGORIES)[number]>("사물함파손");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [studentName, setStudentName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: StaffRequestStatus; note: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // 관리자/행정직원은 전체를 보고, 교사 등 일반 사용자는 본인이 등록한 요청만 봅니다(요청:
  // "권한별로... 보아서는 안되는 것을 보고 있지는 않은지"와 같은 맥락 - 다른 교사의 요청까지
  // 노출할 필요는 없습니다).
  const visibleItems = isManager ? items : items.filter((it) => it.requested_by === myEmail);

  const [statusFilter, setStatusFilter] = useState<"전체" | StaffRequestStatus>("전체");
  const filteredItems = statusFilter === "전체" ? visibleItems : visibleItems.filter((it) => it.status === statusFilter);

  const [page, setPage] = useState(1);
  const pageItems = useMemo(
    () => filteredItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredItems, page]
  );
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  useEffect(() => {
    setPage(1);
  }, [filteredItems.length, statusFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("제목을 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category, title, content, studentName }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "등록하지 못했습니다.");
      return;
    }
    setItems((prev) => [data.item as StaffRequest, ...prev]);
    setTitle("");
    setContent("");
    setStudentName("");
    setFormOpen(false);
  }

  async function saveStatus(id: string) {
    const draft = drafts[id];
    if (!draft) return;
    setBusyId(id);
    const res = await fetch(`/api/requests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: draft.status, resolvedNote: draft.note }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) {
      notify(data.error || "저장하지 못했습니다.", "error");
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? (data.item as StaffRequest) : it)));
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">🧾 행정요청</h1>
          <GuideButton title="행정요청 사용 가이드" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          사물함 파손, 물품 구입, 아픈 학생 인계, 출결 상황 문의처럼 행정직원에게 요청할 일을
          등록하면, 행정직원/관리자가 확인하고 처리 상태를 갱신합니다.
        </p>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {(["전체", "접수대기", "처리중", "완료"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={
                  "rounded-full border px-3 py-1 text-xs font-semibold transition " +
                  (statusFilter === s
                    ? "border-gia-navy bg-gia-navy text-white"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50")
                }
              >
                {s}
              </button>
            ))}
          </div>
          <button
            onClick={() => setFormOpen((v) => !v)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            {formOpen ? "취소" : "+ 새 요청"}
          </button>
        </div>

        {formOpen && (
          <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              {STAFF_REQUEST_CATEGORIES.map((c) => (
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
                placeholder="예: 3반 사물함 3번 문이 안 닫혀요"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              학생 이름 (해당하는 경우)
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="예: 홍길동"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              내용
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="상황을 자유롭게 적어주세요."
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
        )}

        <h2 className="mb-2 text-sm font-bold text-slate-700">
          {isManager ? `전체 요청 (${filteredItems.length}건)` : `내가 등록한 요청 (${filteredItems.length}건)`}
        </h2>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {filteredItems.length === 0 && (
          <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">등록된 요청이 없습니다.</div>
        )}
        {pageItems.map((it) => {
          const expanded = expandedId === it.id;
          const draft = drafts[it.id] ?? { status: it.status, note: it.resolved_note ?? "" };
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
                {isManager && (
                  <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
                    {it.requested_by_name || it.requested_by}
                  </span>
                )}
                <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs " + (STATUS_STYLE[it.status] ?? "")}>
                  {it.status}
                </span>
                <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
              </button>
              {expanded && (
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <div className="mb-2 text-xs text-slate-400">
                    {it.requested_by_name || it.requested_by} · {it.created_at.slice(0, 10)}
                    {it.student_name && <> · 학생: {it.student_name}</>}
                  </div>
                  {it.content && <p className="mb-3 whitespace-pre-wrap">{it.content}</p>}

                  {!isManager && it.resolved_note && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                      <div className="mb-1 font-semibold text-blue-800">처리 메모</div>
                      <p className="whitespace-pre-wrap text-blue-900">{it.resolved_note}</p>
                    </div>
                  )}

                  {isManager && (
                    <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        상태
                        <select
                          value={draft.status}
                          onChange={(e) =>
                            setDrafts((d) => ({
                              ...d,
                              [it.id]: { ...draft, status: e.target.value as StaffRequestStatus },
                            }))
                          }
                          className="w-fit rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        >
                          <option value="접수대기">접수대기</option>
                          <option value="처리중">처리중</option>
                          <option value="완료">완료</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs text-slate-500">
                        처리 메모
                        <textarea
                          value={draft.note}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, note: e.target.value } }))}
                          rows={3}
                          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        onClick={() => saveStatus(it.id)}
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
