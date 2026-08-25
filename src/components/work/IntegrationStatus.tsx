"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// 토들 수집기 · 구글챗 미러링 연결상태(요청: "구글챗, 토들 연결상태를 업무보드에서 볼 수 있게,
// 인박스 탭제목 오른쪽 빈 공간에 토들: 초록불 구글챗: 초록불 형식으로").
//
// 연동이 조용히 멈추는 것이 가장 나쁜 실패입니다 - 화면에는 그냥 "새 소식이 없는 것"처럼
// 보여서, 그날 문의·출결을 통째로 놓칩니다. 그래서 두 연동 모두 살아있을 때 신호를 남기고
// (토들 수집기: 1분마다 /api/pickup/heartbeat, 구글챗: 폴링 크론이 돌 때마다), 여기서 그
// 신호가 최근인지 봅니다.
//
//   🟢 최근 신호 있음(정상)   🟡 신호는 오는데 오류 상태(재로그인 필요 등)   🔴 신호 끊김
//
// 배지에 마우스를 올리면 마지막 신호 시각과 상세를 보여줍니다.
type Beat = { key: string; last_seen_at: string | null; status: string | null; detail: string | null };

// 둘 다 1분 간격으로 신호를 보내므로, 3분 넘게 조용하면 끊긴 것으로 봅니다(네트워크 순간
// 장애로 한두 번 빠진 것까지 빨간불을 켜지 않도록 여유를 둡니다).
const STALE_MS = 3 * 60 * 1000;
const POLL_MS = 60_000;

function ago(iso: string | null): string {
  if (!iso) return "신호 기록 없음";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

function Light({ label, beat }: { label: string; beat: Beat | null }) {
  const lastSeen = beat?.last_seen_at ?? null;
  const stale = !lastSeen || Date.now() - new Date(lastSeen).getTime() > STALE_MS;
  const errored = !stale && beat?.status && beat.status !== "ok";
  const dot = stale ? "🔴" : errored ? "🟡" : "🟢";
  const title = stale
    ? `${label}: 신호 끊김 (마지막 ${ago(lastSeen)})${beat?.detail ? ` - ${beat.detail}` : ""}`
    : errored
      ? `${label}: 연결됨 · 오류 상태(${beat?.status}) ${beat?.detail ?? ""} - 마지막 신호 ${ago(lastSeen)}`
      : `${label}: 정상 - 마지막 신호 ${ago(lastSeen)}`;
  return (
    <span title={title} className="flex cursor-default items-center gap-0.5 whitespace-nowrap text-[10px] font-semibold text-slate-400">
      {label} <span className="text-[8px]">{dot}</span>
    </span>
  );
}

export default function IntegrationStatus() {
  const [beats, setBeats] = useState<Record<string, Beat>>({});

  useEffect(() => {
    let stopped = false;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("integration_heartbeats")
        .select("key, last_seen_at, status, detail")
        .in("key", ["toddle-collector", "google-chat-poll"]);
      if (stopped || !data) return;
      const map: Record<string, Beat> = {};
      for (const b of data as Beat[]) map[b.key] = b;
      setBeats(map);
    }
    load();
    // 상태 표시는 급하지 않으므로 60초에 한 번, 화면이 보일 때만 확인합니다(서버 호출 절감
    // 원칙 - useSmartPoll과 같은 이유).
    const i = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(i);
    };
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Light label="토들" beat={beats["toddle-collector"] ?? null} />
      <Light label="구글챗" beat={beats["google-chat-poll"] ?? null} />
    </div>
  );
}
