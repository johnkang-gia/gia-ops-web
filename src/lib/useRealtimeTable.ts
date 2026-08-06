"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type WithId = { id: string; date?: string; deleted_at?: string | null };

/**
 * 특정 테이블(incidents/events/meetings)을 Supabase Realtime으로 구독해서,
 * 다른 사람이 웹에서 등록/수정/삭제하면 화면이 자동으로 갱신되게 해주는 공용 훅.
 * 서버에서 미리 불러온 initialItems로 시작하고, 이후 변경분만 실시간으로 반영합니다.
 */
export function useRealtimeTable<T extends WithId>(
  table:
    | "incidents"
    | "events"
    | "meetings"
    | "terms"
    | "manual_drafts"
    | "inquiries"
    | "tasks"
    | "attendance_records"
    | "policy_categories"
    | "google_chat_mirror_messages",
  initialItems: T[]
) {
  const [items, setItems] = useState<T[]>(initialItems);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-changes`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((it) => it.id !== oldId);
            }
            const next = payload.new as T;
            // 업무(tasks) 같은 소프트 삭제 테이블은 삭제가 실제로는 UPDATE(deleted_at 설정)라서,
            // 걸러내지 않으면 방금 삭제한 항목이 그 UPDATE 이벤트를 통해 목록에 다시 끼어듭니다
            // (요청: "업무를 삭제해도 계속 표시되". 등록자·담당자·관리자는 휴지통 조회 RLS
            // 정책 때문에 이 UPDATE 이벤트를 여전히 받으므로, deleted_at이 채워진 행은 DELETE와
            // 똑같이 취급해 목록에서 제외합니다.
            if (next.deleted_at) {
              return prev.filter((it) => it.id !== next.id);
            }
            const exists = prev.some((it) => it.id === next.id);
            const merged = exists
              ? prev.map((it) => (it.id === next.id ? next : it))
              : [next, ...prev];
            return [...merged].sort((a, b) =>
              (b.date || "").localeCompare(a.date || "")
            );
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  return [items, setItems] as const;
}
