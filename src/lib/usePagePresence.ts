"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 이 화면에 지금 함께 들어와 있는 사람.
 *
 * 하원 체크표는 행정실 여러 명이 같은 시간에 열어 두고 각자 체크합니다. 누가 같이 보고 있는지
 * 모르면 같은 아이를 두 사람이 동시에 손대거나, 「내가 안 했으니 아무도 안 했겠지」 하고 둘 다
 * 손을 놓습니다. 둘 다 오류로는 안 보입니다.
 *
 * Supabase Presence 를 씁니다 - 채널에 들어오는 순간 자기 이름을 올리고, 탭을 닫으면 저절로
 * 빠집니다. 같은 사람이 탭 두 개를 열면 한 명으로 셉니다(key 가 이메일).
 */
export type PresentUser = { email: string; name: string | null; since: string };

export function usePagePresence(channelName: string, me: { email: string; name: string | null } | null | undefined): PresentUser[] {
  const [people, setPeople] = useState<PresentUser[]>([]);
  const email = me?.email ?? null;
  const name = me?.name ?? null;

  useEffect(() => {
    if (!email) return;
    const supabase = createClient();
    const channel = supabase.channel(`presence:${channelName}`, { config: { presence: { key: email } } });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ name: string | null; since: string }>();
      const list = Object.entries(state).map(([key, metas]) => ({
        email: key,
        name: metas[0]?.name ?? null,
        since: metas.reduce((min, m) => (m.since < min ? m.since : min), metas[0]?.since ?? ""),
      }));
      list.sort((a, b) => a.since.localeCompare(b.since));
      setPeople(list);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ name, since: new Date().toISOString() });
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, email, name]);

  return people;
}
