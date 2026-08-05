"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type EditingUser = { email: string; name: string; itemId: string };

// 동시접속 안전장치(요청: "동시접속,동시사용환경을 원활하게"): 매뉴얼 항목이나 학기 회차처럼
// "열어서 고치는" 화면은, 두 사람이 같은 항목을 동시에 열어 각자 수정하면 나중에 저장한 쪽이
// 먼저 저장한 내용을 덮어씁니다. 완전히 막을 수는 없지만, Supabase Realtime Presence로 "지금 이
// 항목을 누가 열어놓고 있는지"를 실시간으로 보여주면 충돌 자체를 사람이 미리 피할 수 있습니다.
// roomKey는 화면 단위(예: "manuals-학부모용", "terms-1학기"), editingItemId는 지금 내가 연
// 항목의 id입니다(안 열었으면 null).
export function useEditPresence(
  roomKey: string,
  me: { email: string; name: string } | null,
  editingItemId: string | null
): EditingUser[] {
  const [editors, setEditors] = useState<EditingUser[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!me?.email) return;
    const supabase = createClient();
    const channel = supabase.channel(`edit-presence-${roomKey}`, {
      config: { presence: { key: me.email } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, { itemId?: string; name?: string }[]>;
      const next: EditingUser[] = [];
      for (const [email, entries] of Object.entries(state)) {
        if (email === me.email) continue;
        const entry = entries[0];
        if (entry?.itemId) next.push({ email, name: entry.name || email, itemId: entry.itemId });
      }
      setEditors(next);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channelRef.current = channel;
        setReady(true);
      }
    });

    return () => {
      channelRef.current = null;
      setReady(false);
      setEditors([]);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, me?.email]);

  useEffect(() => {
    if (!ready || !channelRef.current || !me) return;
    if (editingItemId) {
      channelRef.current.track({ itemId: editingItemId, name: me.name || me.email });
    } else {
      channelRef.current.untrack();
    }
  }, [ready, editingItemId, me?.name, me?.email]);

  return editors;
}
