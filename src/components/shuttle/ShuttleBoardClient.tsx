"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { youtubeEmbedSrc } from "@/lib/youtube";

const POLL_MS = 6000;

type BoardRoute = {
  routeId: string;
  routeNo: string;
  name: string | null;
  events: { event: string; created_at: string }[];
  roster: { studentName: string; status: string }[];
};

type BoardData = { label: string; youtubeVideoId: string | null; routes: BoardRoute[] };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 안내보드(로그인 없음) - 로비/복도 화면입니다(요청: "아이들 기다릴때... 유튜브를 보여주는데
// 유튜브를 시청하다가 차가 도착하면 몇호차인지, 그리고 아이들은 누가 가야하는지 나오도록").
// 평소에는 유튜브 영상이 화면 대부분을 채우고, 오른쪽(모바일에서는 아래) 패널에 "지금 탈 수
// 있는 차량"이 항상 보입니다. 차가 새로 도착한 그 순간에만 반짝이는 효과 + 알람 소리를 한 번
// 울립니다(요청: "여러 차량이 정차하기 때문에 20초마다 울리게 하면 정신이 하나도 없으니까
// 그냥 도착했을 때만 도착알림음 해주고" - 처음엔 20초마다 반복 알람도 있었지만, 여러 차가
// 동시에 서 있는 상황에서는 시끄럽기만 해서 도착 순간 1회로 되돌렸습니다). 학생이 탑승하면
// 그 이름은 바로 목록에서 사라져 남은 학생만 한눈에 보입니다(요청: "탑승 누르면 아이이름
// 지워지고... 남은학생을 한눈에 볼 수 있게"). 데이터는 로그인 세션이 필요 없는
// /api/shuttle/board/[token]을 폴링해서 가져옵니다.
export default function ShuttleBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const prevArrivedRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // 차가 도착해 아이들 이름이 뜨는 순간 "삐삐-삐" 3음 알람을 울립니다(요청: "탑승할 아이들
  // 이름이 뜨면서, 알람을 울려줬으면 좋겠어"). 브라우저는 사용자가 한 번 화면을 눌러야만
  // 소리를 허용하므로(자동재생 정책), 처음 화면을 열면 "소리 켜고 시작하기" 안내가 먼저
  // 뜨고, 그걸 누른 뒤부터는 계속 소리가 울립니다.
  function playAlarm() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const beepAt = (offsetSec: number, freq: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + offsetSec;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.35);
      };
      beepAt(0, 880);
      beepAt(0.42, 880);
      beepAt(0.84, 1175); // 마지막 음을 살짝 높여 "다 왔어요!" 느낌으로 마무리
    } catch {
      // 브라우저 자동재생 정책 등으로 소리가 막혀도 화면 표시는 그대로 동작합니다.
    }
  }

  function enableSound() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
      audioCtxRef.current?.resume?.();
    } catch {
      // 무시 - 아래에서 화면은 어차피 진행시킵니다.
    }
    setSoundEnabled(true);
    playAlarm(); // 확인용으로 한 번 울려서 소리가 켜졌음을 알려줍니다.
  }

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/shuttle/board/${token}`);
        if (!res.ok) {
          if (!cancelled) setErrorMsg("유효하지 않거나 종료된 링크입니다.");
          return;
        }
        const json = (await res.json()) as BoardData;
        if (cancelled) return;
        setErrorMsg(null);

        const nowArrived = new Set(
          json.routes.filter((r) => r.events.some((e) => e.event === "현장도착") && !r.events.some((e) => e.event === "출발")).map((r) => r.routeId)
        );
        const newlyArrived = [...nowArrived].filter((id) => !prevArrivedRef.current.has(id));
        if (newlyArrived.length > 0) {
          playAlarm();
          setJustArrived((prev) => new Set([...prev, ...newlyArrived]));
          newlyArrived.forEach((id) => {
            setTimeout(() => setJustArrived((prev) => { const next = new Set(prev); next.delete(id); return next; }), 10000);
          });
        }
        prevArrivedRef.current = nowArrived;

        setData(json);
      } catch {
        if (!cancelled) setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const boardingRoutes = useMemo(() => {
    if (!data) return [];
    return data.routes
      .filter((r) => r.events.some((e) => e.event === "현장도착") && !r.events.some((e) => e.event === "출발"))
      .sort((a, b) => natCompare(a.routeNo, b.routeNo));
  }, [data]);

  const embedSrc = youtubeEmbedSrc(data?.youtubeVideoId);

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-center text-white">
        <p className="text-2xl font-bold">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white lg:flex-row">
      {!soundEnabled && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 text-center text-white">
          <p className="text-4xl">🔔</p>
          <p className="text-xl font-bold">화면을 눌러 안내보드를 시작해주세요</p>
          <p className="text-sm text-slate-400">차량 도착 알람 소리를 켜기 위한 절차입니다 (한 번만 눌러주세요)</p>
          <button
            onClick={enableSound}
            className="rounded-2xl bg-blue-600 px-8 py-4 text-lg font-black active:scale-95"
          >
            🔊 소리 켜고 시작하기
          </button>
        </div>
      )}
      <div className="relative flex-1 bg-black">
        {embedSrc ? (
          <iframe
            src={embedSrc}
            className="h-full min-h-[40vh] w-full lg:min-h-screen"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex h-full min-h-[40vh] items-center justify-center text-slate-500 lg:min-h-screen">
            <p className="text-xl">관리자가 안내보드에 재생할 유튜브 영상을 아직 설정하지 않았습니다.</p>
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-3 overflow-y-auto bg-slate-950 p-4 lg:w-[420px] lg:p-5">
        <p className="text-lg font-black text-amber-300">🚌 지금 탈 수 있는 차량</p>
        {boardingRoutes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">아직 도착한 차량이 없습니다</p>
        ) : (
          boardingRoutes.map((route) => {
            const arrivedEvent = route.events.find((e) => e.event === "현장도착")!;
            const waiting = route.roster.filter((r) => r.status !== "탑승");
            const boarded = route.roster.filter((r) => r.status === "탑승");
            const isNew = justArrived.has(route.routeId);
            return (
              <div
                key={route.routeId}
                className={
                  "rounded-xl border-2 p-3 transition-colors " +
                  (isNew ? "animate-pulse border-amber-300 bg-amber-500/20" : "border-slate-700 bg-slate-800")
                }
              >
                <div className="mb-1 flex items-baseline justify-between">
                  <p className="text-2xl font-black text-amber-300">
                    {route.routeNo}호차 {route.name ?? ""}
                  </p>
                  <p className="text-xs text-slate-400">{fmtTime(arrivedEvent.created_at)} 도착</p>
                </div>
                {waiting.length === 0 ? (
                  <p className="text-base font-bold text-emerald-400">✅ 전원 탑승 완료</p>
                ) : (
                  <p className="flex flex-wrap gap-2 text-lg font-bold leading-snug">
                    {waiting.map((r, i) => (
                      <span key={i}>{r.studentName}</span>
                    ))}
                  </p>
                )}
                {boarded.length > 0 && <p className="mt-1 text-[11px] text-slate-500">탑승완료 {boarded.length}명</p>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
