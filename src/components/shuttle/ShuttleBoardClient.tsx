"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

type YoutubeSearchResult = { videoId: string; title: string; channelTitle: string; thumbnail: string };

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
// 있는 차량"이 항상 보입니다. 차가 새로 도착하면 노란 버스 아이콘이 미끄러져 들어오는
// 애니메이션 + 알람 소리를 한 번 울리고(요청: "노란색 셔틀이 도착하는 애니메이션 넣어주고" /
// "그냥 도착했을 때만 도착알림음 해주고" - 처음엔 20초마다 반복 알람도 있었지만 여러 차가
// 동시에 서 있으면 시끄럽기만 해서 도착 순간 1회로 되돌렸습니다), 다 태우고 '출발'을 누르면
// 카드가 오른쪽으로 미끄러지며 사라집니다(요청: "다타고 떠나면 떠나는 애니메이션 넣어주고").
// 학생별 개별 탑승 체크는 쓰지 않고(요청: "명단만 표시") 도착한 차량의 전체 명단이 계속
// 보입니다. 데이터는 로그인 세션이 필요 없는 /api/shuttle/board/[token]을 폴링해서 가져옵니다.
export default function ShuttleBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const [justDeparted, setJustDeparted] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  // 요청: "링크를 걸어서 재생하는 시스템이 아니라... 자유롭게 서치 해서 클릭할 수 있게" -
  // 관리자가 미리 설정해둔 영상(youtubeVideoId)과 별개로, 화면 앞에 있는 사람이 즉석에서
  // 검색해 고른 영상을 우선 재생합니다(새로고침하면 다시 관리자 기본값으로 돌아갑니다).
  const [manualVideoId, setManualVideoId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const prevArrivedRef = useRef<Set<string>>(new Set());
  const prevDepartedRef = useRef<Set<string>>(new Set());
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

        // 요청: "출발하면 출발한표시 해줘... 다타고 떠나면 떠나는 애니메이션 넣어주고" - 도착
        // 상태였다가 '출발' 이벤트가 새로 생긴 노선은 카드가 바로 사라지는 대신, 잠깐 "떠나는"
        // 애니메이션을 보여준 뒤 목록에서 빠집니다.
        const nowDeparted = new Set(json.routes.filter((r) => r.events.some((e) => e.event === "출발")).map((r) => r.routeId));
        const newlyDeparted = [...nowDeparted].filter((id) => !prevDepartedRef.current.has(id));
        if (newlyDeparted.length > 0) {
          setJustDeparted((prev) => new Set([...prev, ...newlyDeparted]));
          newlyDeparted.forEach((id) => {
            setTimeout(() => setJustDeparted((prev) => { const next = new Set(prev); next.delete(id); return next; }), 4000);
          });
        }
        prevDepartedRef.current = nowDeparted;

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

  // 방금 '출발'이 찍힌 노선은 boardingRoutes에서는 바로 빠지지만, 잠깐(4초) 떠나는 애니메이션을
  // 보여주기 위해 원본 데이터에서 다시 찾아 별도로 렌더링합니다.
  const departingRoutes = useMemo(() => {
    if (!data) return [];
    return data.routes.filter((r) => justDeparted.has(r.routeId)).sort((a, b) => natCompare(a.routeNo, b.routeNo));
  }, [data, justDeparted]);

  const embedSrc = youtubeEmbedSrc(manualVideoId ?? data?.youtubeVideoId);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/shuttle/board/youtube-search?token=${encodeURIComponent(token)}&q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) {
        setSearchError(json?.error ?? "검색에 실패했습니다.");
        setSearchResults(null);
      } else {
        setSearchResults(json.results ?? []);
      }
    } catch {
      setSearchError("검색 중 연결에 실패했습니다.");
    } finally {
      setSearching(false);
    }
  }

  function pickVideo(videoId: string) {
    setManualVideoId(videoId);
    setSearchOpen(false);
  }

  if (errorMsg && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-center text-white">
        <p className="text-2xl font-bold">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 text-white lg:flex-row">
      <style>{`
        @keyframes gia-bus-in {
          0% { transform: translateX(-120%); opacity: 0; }
          60% { transform: translateX(8%); opacity: 1; }
          80% { transform: translateX(-3%); }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes gia-bus-out {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        .gia-bus-in-icon { animation: gia-bus-in 0.9s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
        .gia-bus-out-card { animation: gia-bus-out 1.1s ease-in forwards; animation-delay: 2.6s; }
      `}</style>
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

        {/* 요청: "링크를 걸어서 재생하는 시스템이 아니라... 자유롭게 서치 해서 클릭할 수 있게
            해주고, 전체화면을 누르면 검색창 없어지고 우리 화면에 맞게 맞춰지게" - 유튜브
            사이트 자체는 iframe 안에 넣을 수 없어서(보안 정책), 우리 화면에 검색창을 만들고
            결과를 직접 그려줍니다. 영상을 고르면 검색창은 자동으로 닫히고, 유튜브 플레이어
            자체의 전체화면 버튼을 누르면(allowFullScreen) 브라우저가 이 검색창을 포함한 나머지
            화면을 자동으로 가리고 영상만 꽉 채웁니다 - 별도 코드 없이 브라우저 기본 동작입니다. */}
        {manualVideoId && !searchOpen && (
          <button
            onClick={() => {
              setManualVideoId(null);
            }}
            className="absolute left-3 top-3 z-10 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/80"
          >
            ↩ 기본 영상으로
          </button>
        )}
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className="absolute right-3 top-3 z-10 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-black/80"
        >
          {searchOpen ? "✕ 닫기" : "🔍 유튜브 검색"}
        </button>

        {searchOpen && (
          <div className="absolute inset-x-0 top-12 z-10 mx-3 max-h-[80%] overflow-y-auto rounded-xl bg-slate-950/95 p-3 shadow-2xl backdrop-blur">
            <form onSubmit={runSearch} className="flex gap-2">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="보고 싶은 영상을 검색해보세요"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={searching}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {searching ? "검색 중..." : "검색"}
              </button>
            </form>
            {searchError && <p className="mt-2 text-xs text-red-400">{searchError}</p>}
            {searchResults && searchResults.length === 0 && !searchError && (
              <p className="mt-2 text-xs text-slate-400">검색 결과가 없습니다.</p>
            )}
            {searchResults && searchResults.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {searchResults.map((r) => (
                  <button
                    key={r.videoId}
                    onClick={() => pickVideo(r.videoId)}
                    className="flex flex-col overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-left hover:border-blue-400"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumbnail} alt={r.title} className="aspect-video w-full object-cover" />
                    <span className="line-clamp-2 px-2 py-1.5 text-[11px] font-semibold text-white">{r.title}</span>
                    <span className="truncate px-2 pb-1.5 text-[10px] text-slate-400">{r.channelTitle}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex w-full flex-col gap-3 overflow-y-auto bg-slate-950 p-4 lg:w-[420px] lg:p-5">
        <p className="text-lg font-black text-amber-300">🚌 지금 탈 수 있는 차량</p>
        {boardingRoutes.length === 0 && departingRoutes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">아직 도착한 차량이 없습니다</p>
        ) : (
          <>
            {boardingRoutes.map((route) => {
              const arrivedEvent = route.events.find((e) => e.event === "현장도착")!;
              // 픽업(부모님이 직접 데려가심)·결석 학생은 셔틀을 안 타므로 "아직 안 탄 아이"
              // 목록에서 빠집니다(요청: "픽업으로 전환하면 바로 실시간 셔틀 판에 반영되도록").
              const waiting = route.roster.filter((r) => r.status !== "탑승" && r.status !== "픽업" && r.status !== "결석");
              const boarded = route.roster.filter((r) => r.status === "탑승");
              const pickedUp = route.roster.filter((r) => r.status === "픽업");
              const isNew = justArrived.has(route.routeId);
              return (
                <div
                  key={route.routeId}
                  className={
                    "rounded-xl border-2 p-3 transition-colors " +
                    (isNew ? "border-amber-300 bg-amber-500/20" : "border-slate-700 bg-slate-800")
                  }
                >
                  <div className="mb-1 flex items-center justify-between">
                    <p className="flex items-center gap-2 text-2xl font-black text-amber-300">
                      {isNew && <span className="gia-bus-in-icon inline-block">🚌</span>}
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
                  {(boarded.length > 0 || pickedUp.length > 0) && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {boarded.length > 0 && <>탑승완료 {boarded.length}명 </>}
                      {pickedUp.length > 0 && <>· 픽업 {pickedUp.length}명</>}
                    </p>
                  )}
                </div>
              );
            })}

            {/* 요청: "다타고 떠나면 떠나는 애니메이션 넣어주고" - 출발 이벤트가 막 찍힌 노선을
                잠깐(약 4초) 더 보여주며 오른쪽으로 미끄러지듯 사라지게 합니다. */}
            {departingRoutes.map((route) => (
              <div
                key={"departing-" + route.routeId}
                className="gia-bus-out-card rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-3"
              >
                <p className="flex items-center gap-2 text-2xl font-black text-emerald-300">
                  🚌💨 {route.routeNo}호차 {route.name ?? ""}
                </p>
                <p className="text-base font-bold text-emerald-400">✅ 출발했습니다 - 다음에 만나요!</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
