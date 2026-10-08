"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ConsultAction, ConsultState } from "@/lib/consult/server";

/** 바뀌면 화면이 다시 읽어야 하는 표. 구독에 조건을 걸지 않습니다(CLAUDE.md §2-11) - 새로 생긴 줄을 놓칩니다. */
const LIVE_TABLES = ["consult_events", "consult_rooms", "consult_appointments", "consult_appointment_students", "consult_notes"];

/**
 * **상담 행사 하나를 실시간으로 들고 있는 훅.** 안내데스크와 면담자 화면이 함께 씁니다.
 *
 * 표가 바뀌면 서버에 다시 묻습니다 - 화면이 자기 상태를 손으로 고치지 않습니다. 안내데스크가
 * 「도착」을 누르면 면담 선생님 화면의 대기열이 그 순간 늘어나야 하는데, 각 화면이 「무엇이
 * 바뀌었으니 무엇을 고친다」를 따로 적으면 언젠가 한 화면만 다른 답을 합니다(§2-12 와 같은 이유).
 */
export function useConsultEvent(eventId: string, initial: ConsultState | null) {
  const [state, setState] = useState<ConsultState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/consult/events/${eventId}`, { cache: "no-store" });
      const j = (await res.json()) as { state?: ConsultState; error?: string };
      if (!res.ok || !j.state) {
        setError(j.error ?? "상담 현황을 읽지 못했습니다.");
        return;
      }
      setState(j.state);
    } catch (e) {
      setError(`상담 현황을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [eventId]);

  useEffect(() => {
    const supabase = createClient();
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      // 한 번 누르면 예약·기록 두 표가 잇따라 바뀝니다. 한 번만 다시 읽습니다.
      timer.current = setTimeout(() => void reload(), 250);
    };
    const channel = supabase.channel(`consult-${eventId}-${Math.random().toString(36).slice(2, 10)}`);
    for (const table of LIVE_TABLES) channel.on("postgres_changes", { event: "*", schema: "public", table }, soon);
    channel.subscribe();
    // 실시간 연결이 끊긴 기기를 위한 안전망. 30초마다 한 번은 다시 읽습니다.
    const poll = setInterval(() => void reload(), 30_000);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      clearInterval(poll);
      clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, [eventId, reload]);

  const act = useCallback(
    async (apptId: string, action: ConsultAction): Promise<boolean> => {
      setBusy(apptId);
      try {
        const res = await fetch(`/api/consult/appointments/${apptId}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(j.error ?? "처리하지 못했습니다.");
          return false;
        }
        setError(null);
        return true;
      } catch (e) {
        setError(`처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      } finally {
        await reload();
        setBusy(null);
      }
    },
    [reload],
  );

  return { state, error, setError, busy, act, reload, now };
}

/** 분 → 「약 12분」. 0이면 「곧」. */
export function waitLabel(min: number | null | undefined, en = false): string {
  if (min === null || min === undefined) return "";
  if (min <= 0) return en ? "now" : "곧";
  return en ? `~${min} min` : `약 ${min}분`;
}
