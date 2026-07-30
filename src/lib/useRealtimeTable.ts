"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type WithId = { id: string; date?: string };

/**
 * 특정 테이블(incidents/events/meetings)을 Supabase Realtime으로 구독해서,
 * 다른 사람이 웹에서 등록/수정/삭제하면 화면이 자동으로 갱신되게 해주는 공용 훅.
 * 서버에서 미리 불러온 initialItems로 시작하고, 이후 변경분만 실시간으로 반영합니다.
 */
export function useRealtimeTable<T extends WithId>(
  table: "incidents" | "events" | "meetings" | "terms",
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
