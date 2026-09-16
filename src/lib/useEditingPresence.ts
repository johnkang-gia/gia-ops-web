"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * **누가 지금 이 화면을 보고 있고, 어느 칸을 고치는 중인가.**
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 청구 표는 한 사람이 고치고 여러 사람이 봅니다. 둘이 같은 학생의 같은 항목을 동시에
 * 만지면, 나중에 저장한 쪽이 앞사람 것을 덮습니다. **덮였다는 사실은 화면에 안 나타납니다** —
 * 앞사람 화면에는 자기가 넣은 값이 그대로 있고, 표에는 뒷사람 값이 들어가 있습니다. 둘 다
 * 자기 화면을 믿고 일하다가, 청구서가 나간 뒤에야 다른 금액이었다는 것을 압니다.
 *
 * ── 왜 잠그지 않나 ─────────────────────────────────────────────────────────
 *
 * 줄을 잠그는 방법(DB 잠금)도 있지만, 잠근 사람이 창을 닫거나 인터넷이 끊기면 그 줄은
 * **아무도 못 고치는 채로 남습니다.** 그러면 잠금을 푸는 화면을 또 만들어야 하고, 그 화면을
 * 아는 사람은 결국 한 명뿐입니다.
 *
 * 그래서 **막지 않고 보여줍니다.** 사람이 옆자리에 「지금 그 칸 보고 계세요?」라고 물으면
 * 끝나는 일이고, 물어볼 수 있으려면 누가 만지는지가 보여야 합니다. 브라우저를 닫으면 표시는
 * 저절로 사라집니다 — 치울 것이 남지 않습니다.
 *
 * ── 어떻게 ─────────────────────────────────────────────────────────────────
 *
 * 수파베이스 실시간의 **접속 상태(presence)** 를 씁니다. 표를 따로 만들지 않고, 열려 있는
 * 화면끼리만 주고받습니다.
 */

export type Presence = {
  email: string;
  name: string;
  /** 지금 열어둔 칸(`학생번호|항목번호`). 아무것도 안 열었으면 null. */
  editing: string | null;
};

export function useEditingPresence(
  room: string,
  me: { email: string; name: string },
  editing: string | null,
): { others: Presence[]; byCell: Map<string, Presence[]> } {
  const [others, setOthers] = useState<Presence[]>([]);
  /** 지금 열어둔 칸. 구독을 다시 붙이지 않고 값만 갈아끼웁니다. */
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    // 열쇠를 메일 주소로 둡니다. 한 사람이 창을 두 개 열어도 한 명으로 셉니다 - 같은 사람이
    // 둘로 보이면 「누가 만지는 중」이 거짓말이 됩니다.
    const channel = supabase.channel(room, { config: { presence: { key: me.email } } });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, { email?: string; name?: string; editing?: string | null }[]>;
        const list: Presence[] = [];
        for (const [key, entries] of Object.entries(state)) {
          if (key === me.email) continue; // 나는 세지 않습니다.
          const last = entries[entries.length - 1];
          if (!last) continue;
          list.push({ email: last.email ?? key, name: last.name ?? key, editing: last.editing ?? null });
        }
        setOthers(list);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ email: me.email, name: me.name, editing: editingRef.current });
      });

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [room, me.email, me.name]);

  // 칸을 열고 닫을 때마다 알립니다. 구독을 새로 붙이지 않으므로 깜빡임이 없습니다.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.track({ email: me.email, name: me.name, editing });
  }, [editing, me.email, me.name]);

  const byCell = useMemo(() => {
    const m = new Map<string, Presence[]>();
    for (const p of others) {
      if (!p.editing) continue;
      m.set(p.editing, [...(m.get(p.editing) ?? []), p]);
    }
    return m;
  }, [others]);

  return { others, byCell };
}
