"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRealtimeTable } from "@/lib/useRealtimeTable";
import type {
  StaffRequest,
  StaffRequestCategoryRow,
  StaffRequestComment,
  StaffRequestStatus,
} from "@/lib/types";
import Pagination from "@/components/Pagination";
import GuideButton from "@/components/common/GuideButton";
import { useToast } from "@/components/common/ToastProvider";

const PAGE_SIZE = 10;

const GUIDE_SECTIONS = [
  {
    title: "🧾 행정요청이란? / What is this?",
    lines: [
      "사물함 파손, 물품 구입, 아픈 학생 인계, 출결 상황 문의처럼 행정직원에게 부탁할 일을 등록하는 곳입니다. / Use this to send requests to admin staff — locker damage, supply requests, sick student handoffs, attendance questions, and more.",
      "등록하면 초등부 전체 업무창에도 자동으로 등록되어 행정직원이 확인·처리합니다. 담당자가 확인하면 🟢, 완료되면 완료 목록으로 이동합니다. / Submitting also creates a task on the Elementary team board automatically. A green dot 🟢 appears once staff acknowledge it, and it moves to your Completed list when done.",
      "댓글로 대화할 수 있고, 한국어/영어 어느 쪽으로 적어도 자동으로 번역되어 함께 보입니다. / You can leave comments, and everything is auto-translated so it's readable in both Korean and English.",
    ],
  },
];

const STATUS_META: Record<StaffRequestStatus, { dot: string; ko: string; en: string; style: string }> = {
  접수대기: { dot: "🔴", ko: "접수대기", en: "Pending", style: "bg-red-100 text-red-700" },
  처리중: { dot: "🟢", ko: "확인됨", en: "Acknowledged", style: "bg-emerald-100 text-emerald-700" },
  완료: { dot: "✅", ko: "완료", en: "Completed", style: "bg-slate-200 text-slate-600" },
};

function oneLine(text: string, maxLen = 60) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "(내용 없음 / No content)";
  return t.length > maxLen ? t.slice(0, maxLen) + "…" : t;
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금 · just now";
  if (min < 60) return `${min}분 전 · ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전 · ${hr}h ago`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

// 한글 라벨 아래에 작게 영어를 함께 보여주는 공용 표시입니다(요청: "원어민이 사용하기 때문에
// 영어 병기가 필요해 모든 메뉴를 영어 병기로").
function Bi({ ko, en, className }: { ko: string; en: string; className?: string }) {
  return (
    <span className={className}>
      <span className="block truncate">{ko}</span>
      <span className="block truncate text-[10px] font-normal text-slate-400">{en}</span>
    </span>
  );
}

function CategoryPill({
  cat,
  active,
  onClick,
}: {
  cat: StaffRequestCategoryRow;
  active: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="mr-1">{cat.icon}</span>
      {cat.category}
      <span className="ml-1 text-[10px] font-normal opacity-70">/ {cat.label_en}</span>
    </>
  );
  const cls =
    "rounded-full border px-3 py-1 text-xs font-semibold transition " +
    (active ? "border-gia-navy bg-gia-navy text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50");
  if (!onClick) {
    return <span className={cls}>{content}</span>;
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {content}
    </button>
  );
}

// 요청 하나에 대한 코멘트 스레드입니다(요청: "행정요청에 대해서 코멘트를 넣을 수 있게"). 카드를
// 펼칠 때만 불러오고 실시간 구독을 시작합니다(TaskDetailPanel의 task_comments 패턴과 동일) -
// 목록 화면의 댓글 수(comment_count)는 이미 staff_requests 자체의 realtime 갱신으로 즉시
// 반영되므로(요청: "코멘트는... 내가 등록한 요청에 실시간으로 반영"), 전체 스레드까지 항상
// 구독해둘 필요는 없습니다.
function CommentThread({ requestId, myEmail }: { requestId: string; myEmail: string }) {
  const notify = useToast();
  const [comments, setComments] = useState<StaffRequestComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    setLoading(true);
    supabase
      .from("staff_request_comments")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) {
          setComments((data as StaffRequestComment[] | null) ?? []);
          setLoading(false);
        }
      });

    const channel = supabase
      .channel(`staff-request-comments-${requestId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "staff_request_comments", filter: `request_id=eq.${requestId}` },
        (payload) => {
          setComments((prev) => {
            const next = payload.new as StaffRequestComment;
            if (prev.some((c) => c.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [requestId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/requests/${requestId}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.trim() }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      notify(data.error || "코멘트를 등록하지 못했습니다. / Failed to post comment.", "error");
      return;
    }
    setComments((prev) => (prev.some((c) => c.id === data.item.id) ? prev : [...prev, data.item]));
    setText("");
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
      <div className="mb-1.5 text-[11px] font-semibold text-slate-400">💬 코멘트 · Comments ({comments.length})</div>
      {loading && <p className="text-xs text-slate-300">불러오는 중... · Loading…</p>}
      {!loading && comments.length === 0 && (
        <p className="text-xs text-slate-300">아직 코멘트가 없습니다. · No comments yet.</p>
      )}
      <div className="flex flex-col gap-1.5">
        {comments.map((c) => {
          const mine = c.author_email === myEmail;
          return (
            <div key={c.id} className={"rounded-lg bg-white p-2 text-xs shadow-sm " + (mine ? "border border-blue-100" : "")}>
              <div className="mb-0.5 flex items-center justify-between">
                <span className="font-semibold text-slate-600">{c.author_name || c.author_email}</span>
                <span className="text-[10px] text-slate-300">{timeAgo(c.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{c.content}</p>
              {/* 원문과 다른 언어 번역본이 있으면 작게 함께 보여줍니다(요청: "넣는 코멘트 모두
                  한,영 번역을 지원"). 원문과 같은 문자열이면 중복 표시하지 않습니다. */}
              {c.content_en && c.content_en !== c.content && (
                <p className="mt-1 whitespace-pre-wrap border-t border-slate-100 pt-1 text-[11px] italic text-slate-400">
                  🌐 {c.content_en}
                </p>
              )}
              {c.content_ko && c.content_ko !== c.content && c.content_ko !== c.content_en && (
                <p className="mt-1 whitespace-pre-wrap text-[11px] italic text-slate-400">🌐 {c.content_ko}</p>
              )}
            </div>
          );
        })}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="코멘트 입력 (한글/영어 모두 가능) · Write in Korean or English"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
        >
          {submitting ? "..." : "등록 · Post"}
        </button>
      </form>
    </div>
  );
}

// 관리자 전용 카테고리 관리 패널(요청: "위에 사물함파손,물품구입 등을 관리자가 등록/편집할 수
// 있게"). 카테고리를 지우면 기존 요청들이 참조를 잃으므로, 삭제 대신 표시 여부(active)만
// 끄고 켤 수 있습니다.
function CategoryManager({
  categories,
  onCategoriesChange,
}: {
  categories: StaffRequestCategoryRow[];
  onCategoriesChange: (next: StaffRequestCategoryRow[]) => void;
}) {
  const notify = useToast();
  const [open, setOpen] = useState(false);
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

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold text-amber-700"
      >
        <span>⚙️ 카테고리 관리 (관리자) · Manage Categories (Admin)</span>
        <span>{open ? "접기 ‹" : "펼치기 ›"}</span>
      </button>
      {open && (
        <div className="border-t border-amber-200 p-3">
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
        </div>
      )}
    </div>
  );
}

export default function StaffRequestsClient({
  initialItems,
  initialCategories,
  isManager,
  isAdmin,
  myEmail,
}: {
  initialItems: StaffRequest[];
  initialCategories: StaffRequestCategoryRow[];
  isManager: boolean;
  isAdmin: boolean;
  myEmail: string;
}) {
  const notify = useToast();
  const [items, setItems] = useRealtimeTable<StaffRequest>("staff_requests", initialItems);
  const [categories, setCategories] = useState<StaffRequestCategoryRow[]>(initialCategories);
  const activeCategories = useMemo(() => categories.filter((c) => c.active), [categories]);
  const categoryByKey = useMemo(() => {
    const map = new Map<string, StaffRequestCategoryRow>();
    categories.forEach((c) => map.set(c.category, c));
    return map;
  }, [categories]);

  const [category, setCategory] = useState<string>("");
  useEffect(() => {
    if (!category && activeCategories.length > 0) setCategory(activeCategories[0].category);
  }, [activeCategories, category]);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [studentName, setStudentName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { status: StaffRequestStatus; note: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

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

  // 교사 등 일반 사용자는 필터 탭 대신 "내가 등록한 요청"(진행중)과 "완료된 요청" 두 위젯으로
  // 나눠서 봅니다(요청: "내가등록한요청 아래쪽에 완료된 요청을 만들어줘").
  const myActive = visibleItems.filter((it) => it.status !== "완료");
  const myDone = visibleItems.filter((it) => it.status === "완료");
  const [doneOpen, setDoneOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("제목을 입력해주세요. / Please enter a title.");
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
      setError(data.error || "등록하지 못했습니다. / Failed to submit.");
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
      notify(data.error || "저장하지 못했습니다. / Failed to save.", "error");
      return;
    }
    setItems((prev) => prev.map((it) => (it.id === id ? (data.item as StaffRequest) : it)));
  }

  function renderCard(it: StaffRequest) {
    const expanded = expandedId === it.id;
    const draft = drafts[it.id] ?? { status: it.status, note: it.resolved_note ?? "" };
    const busy = busyId === it.id;
    const cat = categoryByKey.get(it.category);
    const meta = STATUS_META[it.status];
    return (
      <div key={it.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setExpandedId(expanded ? null : it.id)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
        >
          <span className="shrink-0 text-sm" title={meta.en}>
            {meta.dot}
          </span>
          <span className="hidden shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 sm:inline-block">
            {cat?.icon ?? "📎"} {it.category}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{oneLine(it.title)}</span>
          {it.comment_count > 0 && (
            <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">💬 {it.comment_count}</span>
          )}
          {isManager && (
            <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
              {it.requested_by_name || it.requested_by}
            </span>
          )}
          <span className={"shrink-0 rounded-full px-2 py-0.5 text-xs " + meta.style}>
            {meta.ko} · {meta.en}
          </span>
          <span className="shrink-0 text-xs font-bold text-blue-600">{expanded ? "접기 ‹" : "더보기 ›"}</span>
        </button>
        {expanded && (
          <div className="border-t border-slate-100 px-4 py-3 text-sm">
            <div className="mb-2 text-xs text-slate-400">
              {it.requested_by_name || it.requested_by} · {it.created_at.slice(0, 10)}
              {it.student_name && <> · 학생/Student: {it.student_name}</>}
            </div>
            {it.content && (
              <div className="mb-3">
                <p className="whitespace-pre-wrap">{it.content}</p>
                {it.content_en && it.content_en !== it.content && (
                  <p className="mt-1 whitespace-pre-wrap border-t border-slate-100 pt-1 text-xs italic text-slate-400">
                    🌐 {it.content_en}
                  </p>
                )}
                {it.content_ko && it.content_ko !== it.content && it.content_ko !== it.content_en && (
                  <p className="mt-1 whitespace-pre-wrap text-xs italic text-slate-400">🌐 {it.content_ko}</p>
                )}
              </div>
            )}

            {!isManager && it.resolved_note && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs">
                <div className="mb-1 font-semibold text-blue-800">처리 메모 · Staff Note</div>
                <p className="whitespace-pre-wrap text-blue-900">{it.resolved_note}</p>
              </div>
            )}

            {isManager && (
              <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-3">
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  상태 · Status
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
                    <option value="접수대기">🔴 접수대기 · Pending</option>
                    <option value="처리중">🟢 확인됨 · Acknowledged</option>
                    <option value="완료">✅ 완료 · Completed</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500">
                  처리 메모 · Staff Note
                  <textarea
                    value={draft.note}
                    onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: { ...draft, note: e.target.value } }))}
                    rows={3}
                    className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => saveStatus(it.id)}
                    disabled={busy}
                    className="w-fit rounded-lg bg-gia-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
                  >
                    {busy ? "저장 중... · Saving..." : "저장 · Save"}
                  </button>
                  {it.task_id && (
                    <a href="/work" className="text-xs text-blue-600 hover:underline">
                      🔗 업무보드에서 보기 · View on Work Board
                    </a>
                  )}
                </div>
              </div>
            )}

            <CommentThread requestId={it.id} myEmail={myEmail} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden">
      <div className="shrink-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <Bi ko="🧾 행정요청" en="Staff Requests" className="text-lg font-bold" />
          <GuideButton title="행정요청 사용 가이드 · Guide" sections={GUIDE_SECTIONS} />
        </div>
        <p className="mb-4 text-xs text-slate-500">
          사물함 파손, 물품 구입, 아픈 학생 인계, 출결 상황 문의처럼 행정직원에게 요청할 일을
          등록하면, 행정직원/관리자가 확인하고 처리 상태를 갱신합니다.
          <br />
          Submit a request for locker damage, supplies, sick student handoff, attendance
          questions, etc. — admin staff will review and update its status.
        </p>

        {isAdmin && <CategoryManager categories={categories} onCategoriesChange={setCategories} />}

        {isManager && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { key: "전체", ko: "전체", en: "All" },
                  { key: "접수대기", ko: "접수대기", en: "Pending" },
                  { key: "처리중", ko: "확인됨", en: "Ack'd" },
                  { key: "완료", ko: "완료", en: "Done" },
                ] as const
              ).map((s) => (
                <button
                  key={s.key}
                  onClick={() => setStatusFilter(s.key)}
                  className={
                    "rounded-full border px-3 py-1 text-xs font-semibold transition " +
                    (statusFilter === s.key
                      ? "border-gia-navy bg-gia-navy text-white"
                      : "border-slate-300 text-slate-600 hover:bg-slate-50")
                  }
                >
                  {s.ko} · {s.en}
                </button>
              ))}
            </div>
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {formOpen ? "취소 · Cancel" : "+ 새 요청 · New Request"}
            </button>
          </div>
        )}
        {!isManager && (
          <div className="mb-3 flex justify-end">
            <button
              onClick={() => setFormOpen((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {formOpen ? "취소 · Cancel" : "+ 새 요청 · New Request"}
            </button>
          </div>
        )}

        {formOpen && (
          <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-1.5">
              {activeCategories.map((c) => (
                <CategoryPill key={c.category} cat={c} active={category === c.category} onClick={() => setCategory(c.category)} />
              ))}
              {activeCategories.length === 0 && (
                <p className="text-xs text-slate-400">
                  등록된 카테고리가 없습니다. 관리자에게 문의하세요. / No categories yet — ask an admin.
                </p>
              )}
            </div>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              제목 · Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 3반 사물함 3번 문이 안 닫혀요 · e.g. Locker #3 in Room 3 won't close"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              학생 이름 (해당하는 경우) · Student Name (if applicable)
              <input
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                placeholder="예: 홍길동 · e.g. Jane Doe"
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">
              내용 · Details
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                placeholder="상황을 자유롭게 적어주세요 (한글/영어 모두 가능합니다). · Describe the situation — Korean or English is fine."
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-fit rounded-lg bg-gia-navy px-4 py-2 text-sm font-semibold text-white hover:bg-gia-navy-2 disabled:opacity-50"
            >
              {submitting ? "등록 중... · Submitting..." : "등록 · Submit"}
            </button>
          </form>
        )}
      </div>

      {isManager ? (
        <>
          <div className="shrink-0">
            <h2 className="mb-2 text-sm font-bold text-slate-700">
              전체 요청 · All Requests ({filteredItems.length}건 / items)
            </h2>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
            {filteredItems.length === 0 && (
              <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                등록된 요청이 없습니다. · No requests yet.
              </div>
            )}
            {pageItems.map((it) => renderCard(it))}
          </div>
          <div className="shrink-0">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          <div>
            <h2 className="mb-2 text-sm font-bold text-slate-700">
              내가 등록한 요청 · My Requests ({myActive.length}건 / items)
            </h2>
            <div className="flex flex-col gap-2">
              {myActive.length === 0 && (
                <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                  등록된 요청이 없습니다. · No requests yet.
                </div>
              )}
              {myActive.map((it) => renderCard(it))}
            </div>
          </div>

          {/* 완료된 요청 위젯 - 요청: "내가등록한요청 아래쪽에 완료된 요청을 만들어줘". */}
          <div>
            <button
              type="button"
              onClick={() => setDoneOpen((v) => !v)}
              className="mb-2 flex w-full items-center justify-between text-left text-sm font-bold text-slate-700"
            >
              <span>✅ 완료된 요청 · Completed Requests ({myDone.length}건 / items)</span>
              <span className="text-xs font-normal text-slate-400">{doneOpen ? "접기 ‹" : "펼치기 ›"}</span>
            </button>
            {doneOpen && (
              <div className="flex flex-col gap-2">
                {myDone.length === 0 && (
                  <div className="rounded-lg bg-white p-4 text-sm text-slate-400 shadow-sm">
                    완료된 요청이 없습니다. · Nothing completed yet.
                  </div>
                )}
                {myDone.map((it) => renderCard(it))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
