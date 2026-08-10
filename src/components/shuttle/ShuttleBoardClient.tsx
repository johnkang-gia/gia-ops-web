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
// 있는 차량"이 항상 보입니다. 새로 도착한 차량은 잠깐 반짝이는 효과로 눈에 띄게 만듭니다.
// 데이터는 로그인 세션이 필요 없는 /api/shuttle/board/[token]을 폴링해서 가져옵니다.
export default function ShuttleBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const prevArrivedRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  function playChime() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      // 브라우저 자동재생 정책 등으로 소리가 막혀도 화면 표시는 그대로 동작합니다.
    }
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
        if (newlyArrived.length > 0 && prevArrivedRef.current.size + nowArrived.size > 0) {
          playChime();
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
