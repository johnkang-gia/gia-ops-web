"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import type { TaskComment } from "@/lib/types";

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
// 최근 순으로 보여줍니다. 채팅으로 등록한 업무의 "등록됐다" 안내와 확인 내역도 전부 여기로만
// 모이고, 채팅창에는 대화만 남도록 분리했습니다(요청). 평소엔 최근 12개만 보이고, 헤더를
// 클릭하면 전체 목록을 팝업으로 볼 수 있습니다.
export default function ActivityLog({ department }: { department: string }) {
  const [events, setEvents] = useState<TaskComment[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [fullEvents, setFullEvents] = useState<TaskComment[] | null>(null);

  useEffect(() => {
    if (department === "전체") {
      setEvents([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("task_comments")
      .select("*")
      .eq("department", department)
      .eq("is_system", true)
      .order("created_at", { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (!cancelled) setEvents((data as TaskComment[] | null) ?? []);
      });

    const channel = supabase
      .channel(`activity-log-${department}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_comments", filter: `department=eq.${department}` },
        (payload) => {
          const next = payload.new as TaskComment;
          if (!next.is_system) return;
          setEvents((prev) => [next, ...prev].slice(0, 12));
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
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {events.map((e) => (
            <span key={e.id} className="text-[11px] opacity-70">
              {e.content}{" "}
              <span className="opacity-50">· {timeAgo(e.created_at)}</span>
            </span>
          ))}
        </div>
      )}

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
                      <div key={e.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] text-slate-600">
                        {e.content} <span className="text-[10px] text-slate-400">· {timeAgo(e.created_at)}</span>
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
