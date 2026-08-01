"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 업무 페이지에 지금 접속해 있는 사람을 실시간으로 보여주기 위한 훅입니다. Supabase Realtime의
// Presence 기능을 씁니다 - 채널을 구독하는 순간 자기 이메일을 "지금 여기 있음"으로 등록하고,
// 다른 사람이 들어오거나 나갈 때마다 목록이 자동으로 갱신됩니다. 탭을 닫으면 자동으로 빠집니다.
export function useOnlineUsers(userEmail: string | null | undefined) {
  const [online, setOnline] = useState<string[]>([]);

  useEffect(() => {
    if (!userEmail) return;
    const supabase = createClient();
    const channel = supabase.channel("work-board-presence", {
      config: { presence: { key: userEmail } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      setOnline(Object.keys(state));
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ online_at: new Date().toISOString() });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  return online;
}
