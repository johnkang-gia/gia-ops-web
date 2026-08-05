"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { DepartmentMemo, TaskComment } from "@/lib/types";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";

// 저장 debounce 간격(ms) - 타이핑할 때마다 저장하면 부담스러우니 잠깐 멈췄을 때만 저장합니다.
const MEMO_SAVE_DELAY = 800;

// 부서 공유 메모장 - 실시간 로그 왼쪽 절반에 배치되는 자유 메모 영역입니다(요청: "실시간 로그
// 반으로 나눠서 오른쪽 실시간로그 왼쪽 메모 적을 수 있도록"). 부서당 한 장(department_memos에
// 1행)을 팀 전체가 함께 보고 고쳐 쓰는 화이트보드처럼 씁니다 - 누가 마지막으로 고쳤는지만
// 아래에 작게 표시하고, 별도 이력은 남기지 않습니다(가벼운 메모 용도).
function MemoPanel({ department, currentUserEmail }: { department: string; currentUserEmail: string }) {
  const notify = useToast();
  const [content, setContent] = useState("");
  const [updatedBy, setUpdatedBy] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextRealtimeRef = useRef(false);

  useEffect(() => {
    if (department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("department_memos")
      .select("*")
      .eq("department", department)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as DepartmentMemo | null;
        setContent(row?.content ?? "");
        setUpdatedBy(row?.updated_by ?? null);
        setUpdatedAt(row?.updated_at ?? null);
      });

    const channel = supabase
      .channel(`department-memo-${department}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "department_memos", filter: `department=eq.${department}` },
        (payload) => {
          if (skipNextRealtimeRef.current) {
            // 내가 방금 저장해서 온 이벤트는 다시 반영할 필요가 없습니다(커서 위치가 튀는 것 방지).
            skipNextRealtimeRef.current = false;
            return;
          }
          const row = payload.new as DepartmentMemo | undefined;
          if (!row) return;
          setContent(row.content ?? "");
          setUpdatedBy(row.updated_by ?? null);
          setUpdatedAt(row.updated_at ?? null);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [department]);

  function handleChange(next: string) {
    setContent(next);
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const supabase = createClient();
      skipNextRealtimeRef.current = true;
      const { error } = await supabase
        .from("department_memos")
        .upsert(
          { department, content: next, updated_by: currentUserEmail, updated_at: new Date().toISOString() },
          { onConflict: "department" }
        );
      setSaving(false);
      if (error) {
        skipNextRealtimeRef.current = false;
        notify("메모 저장에 실패했습니다: " + error.message, "error");
      } else {
        setUpdatedBy(currentUserEmail);
        setUpdatedAt(new Date().toISOString());
      }
    }, MEMO_SAVE_DELAY);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="mb-1.5 flex items-center justify-between text-left text-xs font-bold text-slate-600">
        <span>📝 부서 메모</span>
        <span className="text-[10px] font-medium text-slate-400">{saving ? "저장 중…" : updatedBy ? `${updatedBy} 수정` : ""}</span>
      </div>
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="팀원 모두가 함께 보는 메모입니다. 자유롭게 적어두세요."
        className="min-h-[66px] w-full flex-1 resize-none rounded-lg border border-black/5 bg-white/60 px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-blue-300"
        style={{ maxHeight: ROW_HEIGHT * PAGE_SIZE }}
      />
      {updatedAt && !saving && (
        <p className="mt-0.5 text-[9px] text-slate-300">{timeAgo(updatedAt)}</p>
      )}
    </div>
  );
}

const PAGE_SIZE = 3; // 요청: "실시간로그는 세줄만"
// 컴팩트 뷰에 계속 쌓아두는 로그 총량 상한 - 스크롤로 과거를 계속 불러와도 이 이상은
// 메모리에 들고 있지 않도록(요청: "로그 캐쉬 많이 안잡아 먹도록") 오래된 쪽부터 잘라냅니다.
const MAX_CACHED = 60;
// 한 줄의 대략적인 높이(px) - 3줄만 보이는 고정 높이 스크롤 영역을 만들기 위해 씁니다.
const ROW_HEIGHT = 22;

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

// GIA WorkFlatform 참조 구조의 "실시간 로그" 패널 - 별도 로그 테이블 없이 task_comments에
// is_system=true로 자동 기록되는 상태변경/업무확인/채팅 업무등록 이벤트만 모아서 부서별로
// 최근 순으로 보여줍니다. 평소엔 딱 5줄만(한 줄에 로그 하나) 보이는 고정 높이 영역이고, 위로
// 스크롤하면 그 이전 로그를 추가로 불러옵니다(캐시에 너무 많이 쌓이지 않도록 상한을 둡니다).
// 헤더를 클릭하면 전체 목록을 팝업으로 볼 수 있습니다. 잘못 남은 로그는 관리자이거나 그
// 행동을 한 본인이면 지울 수 있습니다(요청).
export default function ActivityLog({
  department,
  isAdmin,
  currentUserEmail,
}: {
  department: string;
  isAdmin: boolean;
  currentUserEmail: string;
}) {
  const confirmAction = useConfirm();
  const notify = useToast();
  const [events, setEvents] = useState<TaskComment[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullEvents, setFullEvents] = useState<TaskComment[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    setHasMore(true);
    if (department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("task_comments")
      .select("*")
      .eq("department", department)
      .eq("is_system", true)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data as TaskComment[] | null) ?? [];
        setEvents(rows);
        setHasMore(rows.length === PAGE_SIZE);
      });

    const channel = supabase
      .channel(`activity-log-${department}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as TaskComment;
          if (!next.is_system) return;
          setEvents((prev) => [next, ...prev].slice(0, MAX_CACHED));
          setFullEvents((prev) => (prev ? [next, ...prev] : prev));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [department]);

  async function loadOlder() {
    if (loadingMore || !hasMore || events.length === 0) return;
    setLoadingMore(true);
    const supabase = createClient();
    const oldest = events[events.length - 1];
    const { data } = await supabase
      .from("task_comments")
      .select("*")
      .eq("department", department)
      .eq("is_system", true)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    const rows = (data as TaskComment[] | null) ?? [];
    setEvents((prev) => [...prev, ...rows].slice(0, MAX_CACHED));
    setHasMore(rows.length === PAGE_SIZE);
    setLoadingMore(false);
  }

  // 스크롤이 맨 위 근처에 닿으면(위로 올려야 과거 로그가 나오도록, 요청) 다음 페이지를 불러옵니다.
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 24) loadOlder();
  }

  async function deleteEvent(e: TaskComment, fromFull: boolean) {
    if (!(await confirmAction("이 로그 기록을 삭제할까요?", { danger: true }))) return;
    const supabase = createClient();
    setEvents((prev) => prev.filter((x) => x.id !== e.id));
    setFullEvents((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
    const { error } = await supabase.from("task_comments").delete().eq("id", e.id);
    if (error) {
      notify("로그를 삭제하지 못했습니다: " + error.message, "error");
    }
    void fromFull;
  }

  function canDelete(e: TaskComment) {
    return isAdmin || e.author_email === currentUserEmail;
  }

  async function openFull() {
    setExpanded(true);
    if (fullEvents) return; // 이미 불러온 적 있으면 재조회하지 않습니다.
    const supabase = createClient();
    const { data } = await supabase
      .from("task_comments")
      .select("*")
      .eq("department", department)
      .eq("is_system", true)
      .order("created_at", { ascending: false })
      .limit(300);
    setFullEvents((data as TaskComment[] | null) ?? []);
  }

  if (department === "전체") return null;

  return (
    <div className="glass mb-2 px-3 py-2">
      {/* 왼쪽: 부서 공유 메모장 / 오른쪽: 실시간 로그(요청: "실시간 로그 반으로 나눠서 오른쪽
          실시간로그 왼쪽 메모 적을 수 있도록") - 좁은 화면에서도 최소한 나란히 보이도록 flex로
          반반 나눕니다. */}
      <div className="flex gap-3 divide-x divide-black/5">
        <MemoPanel department={department} currentUserEmail={currentUserEmail} />
        <div className="flex min-w-0 flex-1 flex-col pl-3">
          <button
            type="button"
            onClick={openFull}
            className="mb-1.5 flex w-full items-center justify-between text-left text-xs font-bold text-blue-600 hover:underline"
            title="전체 로그 보기"
          >
            <span>🔔 실시간 로그</span>
            <span className="text-[10px] font-medium text-blue-400">전체보기 →</span>
          </button>
          {events.length === 0 ? (
            <p className="text-[11px] opacity-40">아직 활동 기록이 없습니다.</p>
          ) : (
            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="flex flex-1 flex-col overflow-y-auto"
              style={{ maxHeight: ROW_HEIGHT * PAGE_SIZE }}
            >
              {loadingMore && <p className="px-1 py-0.5 text-center text-[10px] opacity-40">이전 로그 불러오는 중...</p>}
              {events.map((e) => (
                <div key={e.id} className="group flex items-center gap-1 truncate px-1 py-0.5 text-[11px] opacity-70">
                  <span className="min-w-0 flex-1 truncate">
                    {e.content} <span className="opacity-50">· {timeAgo(e.created_at)}</span>
                  </span>
                  {canDelete(e) && (
                    <button
                      onClick={() => deleteEvent(e, false)}
                      title="로그 삭제"
                      className="shrink-0 text-slate-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setExpanded(false)}>
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-4 py-3">
                <span className="text-sm font-bold text-slate-800">🔔 {department} 실시간 로그 전체</span>
                <button onClick={() => setExpanded(false)} className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-100">
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {fullEvents === null ? (
                  <p className="text-xs text-slate-300">불러오는 중…</p>
                ) : fullEvents.length === 0 ? (
                  <p className="text-xs text-slate-300">아직 활동 기록이 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {fullEvents.map((e) => (
                      <div key={e.id} className="group flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
                        <span className="min-w-0 flex-1 truncate">
                          {e.content} <span className="text-[10px] text-slate-400">· {timeAgo(e.created_at)}</span>
                        </span>
                        {canDelete(e) && (
                          <button
                            onClick={() => deleteEvent(e, true)}
                            title="로그 삭제"
                            className="shrink-0 text-slate-300 hover:text-red-500"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
