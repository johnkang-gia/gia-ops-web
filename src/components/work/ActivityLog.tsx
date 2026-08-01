"use client";

import { useEffect, useState } from "react";
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
// is_system=true로 자동 기록되는 상태변경/업무확인 이벤트만 모아서 부서별로 최근 순으로 보여줍니다.
export default function ActivityLog({ department }: { department: string }) {
  const [events, setEvents] = useState<TaskComment[]>([]);

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
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [department]);

  if (department === "전체") return null;

  return (
    <div className="glass mb-2 px-3 py-2">
      <div className="mb-1.5 text-xs font-bold text-blue-600">🔔 실시간 로그</div>
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
    </div>
  );
}
