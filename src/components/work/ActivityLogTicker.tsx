"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { useToast } from "@/components/common/ToastProvider";
import type { TaskComment } from "@/lib/types";

// 실시간 로그 — 부서 탭 줄 가운데에 한 줄로 흐릅니다.
//
// 요청: "지금 실시간 로그를 맨위에 초등부 부서 나오는칸 가운데로 로그를 옮기고 한줄만
// 표시되도록해서 누르면 전체로그가 뜨도록 바꾸고"
//
// 왜 옮겼나요?
//   로그는 "무슨 일이 있었나"를 곁눈질로 확인하는 정보지, 자리를 크게 차지할 만큼 자주 들여다보는
//   것이 아닙니다. 세 줄을 차지하던 자리를 학부모 문의사항에 내주고, 로그는 맨 윗줄에 한 줄로만
//   흐르게 했습니다. 궁금하면 눌러서 전체를 봅니다.

function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

export default function ActivityLogTicker({
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
  const [latest, setLatest] = useState<TaskComment | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fullEvents, setFullEvents] = useState<TaskComment[] | null>(null);

  useEffect(() => {
    setLatest(null);
    setFullEvents(null);
    if (!department || department === "전체") return;
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("task_comments")
      .select("*")
      .eq("department", department)
      .eq("is_system", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setLatest(((data as TaskComment[] | null) ?? [])[0] ?? null);
      });

    const channel = supabase
      .channel(`activity-ticker-${department}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as TaskComment;
          if (!next.is_system) return;
          setLatest(next);
          setFullEvents((prev) => (prev ? [next, ...prev] : prev));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [department]);

  async function openFull() {
    setExpanded(true);
    if (fullEvents) return;
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

  async function deleteEvent(e: TaskComment) {
    if (!(await confirmAction("이 로그 기록을 삭제할까요?", { danger: true }))) return;
    const supabase = createClient();
    setFullEvents((prev) => (prev ? prev.filter((x) => x.id !== e.id) : prev));
    if (latest?.id === e.id) setLatest(null);
    const { error } = await supabase.from("task_comments").delete().eq("id", e.id);
    if (error) notify("로그를 삭제하지 못했습니다: " + error.message, "error");
  }

  const canDelete = (e: TaskComment) => isAdmin || e.author_email === currentUserEmail;

  if (!department || department === "전체") return null;

  return (
    <>
      {/* min-w-0 + truncate로 부서 탭이 많아져도 이 칸이 밀려나지 않고 줄어들기만 합니다. */}
      <button
        type="button"
        onClick={openFull}
        title="전체 로그 보기"
        // 담당자: "위쪽 로그 부분 너무 기니까 조금 줄이고."
        //
        // 예전에는 flex-1로 남는 폭을 전부 먹었습니다. 로그는 "무슨 일이 있었나" 훑는 용도지
        // 자세히 읽는 자리가 아닌데, 화면에서 가장 넓은 칸을 차지하고 있었습니다. 최대 폭을
        // 두어 절반 아래로 줄이고, 남은 자리는 오른쪽 배지들이 씁니다. 전체 내용은 눌러서 봅니다.
        className="mx-2 flex min-w-0 max-w-[22rem] flex-1 items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 text-left text-[11px] text-slate-500 transition hover:bg-black/10"
      >
        <span className="shrink-0">🔔</span>
        <span className="min-w-0 flex-1 truncate">
          {latest ? (
            <>
              {latest.content} <span className="opacity-50">· {timeAgo(latest.created_at)}</span>
            </>
          ) : (
            <span className="opacity-50">아직 활동 기록이 없습니다.</span>
          )}
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-blue-500">전체 →</span>
      </button>

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
                      <div
                        key={e.id}
                        className="group flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {e.content} <span className="text-[10px] text-slate-400">· {timeAgo(e.created_at)}</span>
                        </span>
                        {canDelete(e) && (
                          <button
                            onClick={() => deleteEvent(e)}
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
    </>
  );
}
