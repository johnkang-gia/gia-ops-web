"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { youtubeEmbedSrc } from "@/lib/youtube";
import { pollDelay } from "@/lib/useSmartPoll";

// 요청: "차량 도착출발과 안내보드간에 연동이 너무 느리고" - 폴링 주기를 6초에서 3초로 줄여
// 도착·출발 체크가 안내보드에 더 빨리 반영되도록 했습니다.
const POLL_MS = 3000;
// 하원 시간대가 아닐 때(새벽·주말 등) 폴링 간격 - 화면을 종일 켜둬도 호출이 적게 나갑니다.
// 하원 시간대가 아닐 때. 담당자 확인: "하원에 관한 대시보드나 도착체크는 하원시간에만
// 쓰고 있어" - 그 시간 밖에는 화면 앞에 아무도 없으므로 사실상 멈춰도 됩니다. 다만 완전히
// 끊으면 다음 하원 때 스스로 깨어나지 못해서(벽/모바일 화면이라 아무도 새로고침 안 함),
// 15분에 한 번만 남겨둡니다. pollDelay가 하원 시작 시각을 넘겨 자지 않게 잡아줍니다.
const IDLE_POLL_MS = 15 * 60_000;
// 인트로(패널 안 버스 애니메이션)가 끝나고 위젯이 실제로 나타나기까지 걸리는 시간과 맞춥니다
// (아래 .gia-bus-cross-panel 애니메이션 길이 1.1초 + 여유).
const INTRO_MS = 1100;

type BoardRoute = {
  routeId: string;
  routeNo: string;
  name: string | null;
  events: { event: string; created_at: string }[];
  roster: { studentName: string; status: string }[];
};

type BoardData = { label: string; youtubeVideoId: string | null; routes: BoardRoute[] };

type YoutubeSearchResult = { videoId: string; title: string; channelTitle: string; thumbnail: string };

type IntroRoute = { routeId: string; routeNo: string; name: string | null };

function natCompare(a: string, b: string) {
  return a.localeCompare(b, "ko", { numeric: true });
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 안내보드(로그인 없음) - 로비/복도 화면입니다(요청: "아이들 기다릴때... 유튜브를 보여주는데
// 유튜브를 시청하다가 차가 도착하면 몇호차인지, 그리고 아이들은 누가 가야하는지 나오도록").
// 평소에는 유튜브 영상이 화면 대부분을 채우고, 오른쪽(모바일에서는 아래) 패널에 "지금 도착한
// 차량"이 항상 보입니다(요청: "탈 수 있는 차량보다 도착한 차량으로 하고" - 아직 안 탄 아이가
// 있어도 도착 자체가 기준입니다).
//
// 차가 새로 도착하면 두 단계로 아이들의 시선을 끕니다(요청: "위젯이 나타나기 전에 소리와함께
// 노란색 셔틀차가 들어오는 애니메이션이 있었으면 좋겠어 아이들이 시각적으로 집중해서
// 탑승하도록"):
//   1) 화면 전체를 덮는 큰 노란 버스가 경적 소리와 함께 왼쪽에서 오른쪽으로 지나가는 인트로
//   2) 인트로가 끝나면 오른쪽 패널에 그 차량 위젯이 "띵동" 소리와 함께 왼쪽에서 미끄러져
//      들어오고, 타야 할 학생 이름이 자동으로 표시됩니다(요청: "차량 위젯이 왼쪽에서
//      오른쪽으로 자동차가 도착하듯한 애니메이션으로 들어오고, 소리도 띵동 하고 알람음이
//      나고, 타야할 학생의 이름이 자동으로 뜨도록").
// 다 태우고 '출발'을 누르면 카드가 오른쪽으로 미끄러지며 사라집니다. 학생별 개별 탑승 체크는
// 쓰지 않고(요청: "명단만 표시") 도착한 차량의 전체 명단이 계속 보입니다. 데이터는 로그인
// 세션이 필요 없는 /api/shuttle/board/[token]을 폴링해서 가져옵니다.
export default function ShuttleBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 인트로(전체화면 버스 애니메이션)를 거쳐 위젯으로 "공개된" 노선입니다. 여기 없는, 방금 도착한
  // 노선은 인트로가 끝나기 전까지 오른쪽 패널에 나타나지 않습니다.
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [justArrived, setJustArrived] = useState<Set<string>>(new Set());
  const [justDeparted, setJustDeparted] = useState<Set<string>>(new Set());
  const [activeIntro, setActiveIntro] = useState<IntroRoute | null>(null);
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
  // 요청: "유튜브 창과 도착한 차량 의 창크기를 조절할 수 있게 해줘" - 화면을 세로/가로 중 어느
  // 방향으로 나눴는지(lg 기준)에 따라 폭(가로 배치) 또는 높이(세로 배치)를 사용자가 직접
  // 드래그로 조절할 수 있게 합니다. 마지막으로 조절한 크기는 브라우저에 저장해서, 이 화면을
  // 새로고침해도 유지됩니다(같은 TV·모니터에서 매번 다시 맞출 필요가 없도록).
  const [panelWidth, setPanelWidth] = useState(420); // lg 이상(가로 배치)일 때 오른쪽 패널 폭(px)
  const [panelHeight, setPanelHeight] = useState(320); // lg 미만(세로 배치)일 때 아래 패널 높이(px)
  const [isRowLayout, setIsRowLayout] = useState(true);
  const draggingRef = useRef(false);
  // 요청: "도착하고 출발 애니메이션은 전체화면보다, 지금도착한 차량페이지에서만 이루어지도록
  // 해줘" - 화면 전체를 덮지 않고, 오른쪽(모바일에서는 아래) "지금 도착한 차량" 패널 안에서만
  // 버스가 지나가는 인트로를 보여줍니다. 패널이 스크롤되어 있어도 인트로가 보이도록 자동으로
  // 맨 위로 스크롤합니다.
  const introBannerRef = useRef<HTMLDivElement | null>(null);
  // 요청: "여러대 도착을 누르니까 반응을 아예 안하고, 도착후에 아이들 명단이 안떠" - 대기열을
  // React state(useState)로 관리하면, 인트로 재생 도중 새 차량이 폴링으로 대기열에 추가될 때마다
  // useEffect가 재실행되면서 이미 걸려 있던 setTimeout이 취소되어 그 차량의 명단 공개가
  // 영원히 멈추는 버그가 있었습니다. ref + 직접 호출하는 함수(advanceIntroQueue)로 바꿔서,
  // 대기열이 바뀌어도 재생 중인 인트로의 타이머가 취소되지 않도록 했습니다.
  const introQueueRef = useRef<IntroRoute[]>([]);
  const activeIntroRef = useRef<IntroRoute | null>(null);
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const prevArrivedRef = useRef<Set<string>>(new Set());
  const prevDepartedRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 화면을 처음 열었을 때 이미 도착해 있던 차량까지 인트로를 재생하면 시끄러우니, 최초 1회
  // 폴링 결과는 인트로 없이 바로 공개합니다.
  const isFirstPollRef = useRef(true);

  // 가로/세로 배치 여부(lg 브레이크포인트 1024px)를 추적해서, 드래그 방향(폭↔높이)을 그때그때
  // 맞는 쪽으로 조절합니다.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsRowLayout(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 마지막으로 조절한 크기를 불러오고, 바뀔 때마다 저장합니다.
  useEffect(() => {
    try {
      const savedW = localStorage.getItem("gia-board-panel-width");
      const savedH = localStorage.getItem("gia-board-panel-height");
      if (savedW) setPanelWidth(Number(savedW));
      if (savedH) setPanelHeight(Number(savedH));
    } catch {
      // 무시 - 저장된 값이 없어도 기본 크기로 동작합니다.
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("gia-board-panel-width", String(panelWidth));
    } catch {
      // 무시
    }
  }, [panelWidth]);
  useEffect(() => {
    try {
      localStorage.setItem("gia-board-panel-height", String(panelHeight));
    } catch {
      // 무시
    }
  }, [panelHeight]);

  // 구분선을 눌러서 드래그하면 유튜브 화면 vs "지금 도착한 차량" 패널의 크기 비율이 바뀝니다.
  function startDrag(e: ReactPointerEvent) {
    e.preventDefault();
    draggingRef.current = true;
    const row = isRowLayout;
    function onMove(ev: PointerEvent) {
      if (!draggingRef.current) return;
      if (row) {
        const next = window.innerWidth - ev.clientX;
        setPanelWidth(Math.min(window.innerWidth - 240, Math.max(260, next)));
      } else {
        const next = window.innerHeight - ev.clientY;
        setPanelHeight(Math.min(window.innerHeight - 160, Math.max(140, next)));
      }
    }
    function onUp() {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // 대기열(introQueueRef)에 쌓인 인트로를 하나씩 순서대로 재생합니다: 경적 소리 → 패널 안 버스
  // 애니메이션 → (끝나면) 위젯 공개 + 띵동 소리 → 다음 인트로. setTimeout을 직접 관리해서, 이
  // 함수가 다시 호출돼도(새 차량이 대기열에 추가돼도) 이미 재생 중인 인트로의 타이머는 그대로
  // 유지됩니다.
  function advanceIntroQueue() {
    if (activeIntroRef.current) return; // 이미 재생 중이면 이번 호출은 아무것도 하지 않습니다.
    const next = introQueueRef.current.shift();
    if (!next) return;
    activeIntroRef.current = next;
    setActiveIntro(next);
    playBusHorn();
    const t = setTimeout(() => {
      pendingTimeoutsRef.current.delete(t);
      activeIntroRef.current = null;
      setActiveIntro(null);
      setRevealedIds((prev) => new Set([...prev, next.routeId]));
      setJustArrived((prev) => new Set([...prev, next.routeId]));
      playDingDong();
      const t2 = setTimeout(() => {
        pendingTimeoutsRef.current.delete(t2);
        setJustArrived((prev) => { const n = new Set(prev); n.delete(next.routeId); return n; });
      }, 10000);
      pendingTimeoutsRef.current.add(t2);
      advanceIntroQueue(); // 대기열에 다음 차량이 있으면 이어서 재생합니다.
    }, INTRO_MS);
    pendingTimeoutsRef.current.add(t);
  }

  // 컴포넌트가 사라질 때 남아 있는 타이머를 정리합니다.
  useEffect(() => {
    return () => {
      pendingTimeoutsRef.current.forEach((id) => clearTimeout(id));
      pendingTimeoutsRef.current.clear();
    };
  }, []);

  // 인트로가 시작될 때 "빵빵" 경적 소리를 울립니다(요청: "노란색 셔틀차가 들어오는 애니메이션이
  // 있었으면 좋겠어" - 애니메이션과 함께 차가 다가오는 느낌을 소리로도 줍니다).
  function playBusHorn() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const honk = (offsetSec: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = 320;
        const t0 = ctx.currentTime + offsetSec;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      };
      honk(0);
      honk(0.35);
    } catch {
      // 브라우저 자동재생 정책 등으로 소리가 막혀도 화면 표시는 그대로 동작합니다.
    }
  }

  // 인트로가 끝나고 위젯이 나타나는 순간 "띵동" 초인종 소리를 울립니다(요청: "소리도 띵동 하고
  // 알람음이 나고").
  function playDingDong() {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const chime = (offsetSec: number, freq: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = ctx.currentTime + offsetSec;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      };
      chime(0, 1318.5, 0.5); // "띵" - E6
      chime(0.28, 987.8, 0.7); // "동" - B5
    } catch {
      // 무시 - 화면 표시는 그대로 진행합니다.
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
    playDingDong(); // 확인용으로 한 번 울려서 소리가 켜졌음을 알려줍니다.
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
          if (isFirstPollRef.current) {
            // 화면을 처음 열었을 때 이미 도착해 있던 차량은 인트로 없이 바로 표시합니다.
            setRevealedIds((prev) => new Set([...prev, ...newlyArrived]));
          } else {
            const routeById = new Map(json.routes.map((r) => [r.routeId, r]));
            introQueueRef.current.push(
              ...newlyArrived
                .map((id) => routeById.get(id))
                .filter((r): r is BoardRoute => !!r)
                .map((r) => ({ routeId: r.routeId, routeNo: r.routeNo, name: r.name }))
            );
            advanceIntroQueue();
          }
        }
        prevArrivedRef.current = nowArrived;
        isFirstPollRef.current = false;

        // 요청: "출발하면 출발한표시 해줘... 다타고 떠나면 떠나는 애니메이션 넣어주고" - 도착
        // 상태였다가 '출발' 이벤트가 새로 생긴 노선은 카드가 바로 사라지는 대신, 잠깐 "떠나는"
        // 애니메이션을 보여준 뒤 목록에서 빠집니다. 나중에 같은 노선이 다시 도착하면 처음부터
        // 인트로를 다시 볼 수 있도록 공개 상태도 함께 초기화합니다.
        const nowDeparted = new Set(json.routes.filter((r) => r.events.some((e) => e.event === "출발")).map((r) => r.routeId));
        const newlyDeparted = [...nowDeparted].filter((id) => !prevDepartedRef.current.has(id));
        if (newlyDeparted.length > 0) {
          setJustDeparted((prev) => new Set([...prev, ...newlyDeparted]));
          setRevealedIds((prev) => {
            const next = new Set(prev);
            newlyDeparted.forEach((id) => next.delete(id));
            return next;
          });
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
    // 서버 호출 절감(Vercel 무료 한도): 화면이 안 보이면 건너뛰고, 하원 시간대가 아니면
    // 훨씬 느리게 돕니다. 창을 다시 보면 즉시 한 번 새로고침해 화면이 낡아 보이지 않습니다.
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") void poll();
        tick();
      }, pollDelay(POLL_MS, IDLE_POLL_MS, 15, 19));
    };
    tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (activeIntro) introBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [activeIntro]);

  // 요청: "도착한 차량을 정렬하기보다는 도착누른 순서대로 위쪽에서 아래로 배치... 시간으로
  // 정렬해줘" - 호차 번호 순서가 아니라, 먼저 도착한 차가 위쪽에 오도록 도착 시각 순으로
  // 정렬합니다(어떤 차가 오래 기다리고 있는지 한눈에 보이도록).
  //
  // 요청: "셔틀이 출발할때는 정렬이 되고 출발하는게 아니라 그자리에서 그대로 출발할 수 있도록
  // 해줘... 그중에서 빠지는 차량은 거기에서 그대로 출발하도록" - 예전에는 출발한 차량을 목록
  // 맨 아래로 옮겨서 따로 그렸는데, 그러면 출발 직전에 순서가 훌쩍 바뀌는 것처럼 보였습니다.
  // 이제는 도착~출발(애니메이션 끝) 전까지 하나의 목록·하나의 정렬 기준(도착 시각)으로 함께
  // 관리해서, 출발하는 차량이 원래 있던 자리에서 그대로 슬라이드아웃됩니다.
  const displayRoutes = useMemo(() => {
    if (!data) return [];
    return data.routes
      .filter((r) => {
        if (!revealedIds.has(r.routeId)) return false;
        if (justDeparted.has(r.routeId)) return true; // 출발 애니메이션 재생 중 - 자리 유지
        return r.events.some((e) => e.event === "현장도착") && !r.events.some((e) => e.event === "출발");
      })
      .sort((a, b) => {
        const at = a.events.find((e) => e.event === "현장도착")?.created_at ?? "";
        const bt = b.events.find((e) => e.event === "현장도착")?.created_at ?? "";
        return at.localeCompare(bt);
      });
  }, [data, revealedIds, justDeparted]);

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
      <div
        className="flex min-h-screen items-center justify-center bg-slate-900 text-center text-white"
        style={{ backgroundColor: "#0f172a", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}
      >
        <p className="text-2xl font-bold" style={{ fontSize: 24, fontWeight: 700 }}>
          {errorMsg}
        </p>
      </div>
    );
  }

  return (
    // 요청: "전자칠판 내부 브라우저로 안내보드를 여니까 글만 나오고 적용이 안돼" - 전자칠판
    // 내장 브라우저는 흔히 아주 오래된 엔진이라 Tailwind가 쓰는 최신 CSS 문법(색상 함수 등)을
    // 못 읽는 경우가 있습니다. 안내보드는 화면 앞에 아무도 관리자가 없는 "그냥 켜두는" 용도라
    // 스타일이 아예 안 먹으면 무슨 차가 왔는지조차 알아볼 수 없으므로, 이 화면의 핵심
    // 요소(배경·카드·글자색)에는 className과 별개로 순수 인라인 style도 같이 넣었습니다.
    // 인라인 style은 어떤 브라우저든 항상 그대로 읽으므로, 외부 스타일시트가 전혀 안 먹는
    // 아주 오래된 브라우저에서도 최소한 글자 크기·배경·강조색은 보이게 하는 안전장치입니다.
    <div className="flex h-screen flex-col overflow-hidden bg-slate-900 text-white lg:flex-row" style={{ backgroundColor: "#0f172a", color: "#ffffff" }}>
      <style>{`
        @keyframes gia-card-in {
          0% { transform: translateX(-110%); opacity: 0; }
          60% { transform: translateX(6%); opacity: 1; }
          80% { transform: translateX(-2%); }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes gia-bus-out {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(140%); opacity: 0; }
        }
        @keyframes gia-bus-cross-panel {
          0% { left: -18%; opacity: 0; }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { left: 104%; opacity: 0; }
        }
        @keyframes gia-names-in {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .gia-card-in { animation: gia-card-in 0.8s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
        .gia-bus-out-card { animation: gia-bus-out 1.1s ease-in forwards; animation-delay: 2.6s; }
        .gia-bus-cross-panel { animation: gia-bus-cross-panel 1.1s cubic-bezier(0.32, 0.1, 0.28, 1) both; }
        .gia-names-in { animation: gia-names-in 0.5s ease-out 0.15s both; }
      `}</style>
      {!soundEnabled && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/95 p-6 text-center text-white"
          style={{ backgroundColor: "rgba(2,6,23,0.95)", color: "#ffffff" }}
        >
          <p className="text-4xl">🔔</p>
          <p className="text-xl font-bold">화면을 눌러 안내보드를 시작해주세요</p>
          <p className="text-sm text-slate-400" style={{ color: "#94a3b8" }}>
            차량 도착 알람 소리를 켜기 위한 절차입니다 (한 번만 눌러주세요)
          </p>
          <button
            onClick={enableSound}
            className="rounded-2xl bg-blue-600 px-8 py-4 text-lg font-black active:scale-95"
            style={{ backgroundColor: "#2563eb", color: "#ffffff", border: "none" }}
          >
            🔊 소리 켜고 시작하기
          </button>
        </div>
      )}

      <div className="relative min-h-0 min-w-0 flex-1 bg-black">
        {embedSrc ? (
          <iframe
            src={embedSrc}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="flex h-full items-center justify-center text-slate-500">
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

      {/* 요청: "유튜브 창과 도착한 차량 의 창크기를 조절할 수 있게 해줘" - 이 막대를 눌러
          드래그하면 유튜브 화면과 오른쪽(모바일에서는 아래) "지금 도착한 차량" 패널의 크기
          비율이 바뀝니다. 세로로 쌓이는 화면(lg 미만)에서는 위아래로, 가로로 나란한 화면
          (lg 이상)에서는 좌우로 드래그합니다. */}
      <div
        onPointerDown={startDrag}
        className="flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center bg-slate-800 hover:bg-slate-700 lg:h-auto lg:w-3 lg:cursor-col-resize"
      >
        <span className="h-1 w-10 rounded-full bg-slate-600 lg:h-10 lg:w-1" />
      </div>

      <div
        className="flex w-full min-h-0 flex-col gap-3 overflow-y-auto bg-slate-950 p-4 lg:h-full lg:w-auto lg:p-5"
        style={{
          backgroundColor: "#020617",
          padding: 16,
          ...(isRowLayout ? { width: panelWidth, flexShrink: 0 } : { height: panelHeight, flexShrink: 0 }),
        }}
      >
        <p className="text-lg font-black text-amber-300" style={{ color: "#fcd34d", fontSize: 20, fontWeight: 900 }}>
          🚌 지금 도착한 차량
        </p>

        {/* 요청: "도착하고 출발 애니메이션은 전체화면보다, 지금도착한 차량페이지에서만
            이루어지도록 해줘" - 화면 전체가 아니라 이 패널 폭 안에서만 버스가 지나갑니다. */}
        {activeIntro && (
          <div ref={introBannerRef} className="relative h-20 w-full shrink-0 overflow-hidden rounded-lg border border-amber-400/40 bg-slate-900">
            <p className="absolute inset-x-0 top-1.5 text-center text-xs font-black text-amber-300">
              🚏 {activeIntro.routeNo}호차 도착!
            </p>
            <div className="gia-bus-cross-panel absolute text-4xl" style={{ top: "58%", transform: "translateY(-50%)" }}>
              🚌
            </div>
          </div>
        )}

        {displayRoutes.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500" style={{ color: "#64748b", textAlign: "center" }}>
            아직 도착한 차량이 없습니다
          </p>
        ) : (
          displayRoutes.map((route) => {
            const isDeparting = justDeparted.has(route.routeId);

            // 요청: "다타고 떠나면 떠나는 애니메이션 넣어주고" - 출발 이벤트가 막 찍힌 노선은
            // 목록 맨 아래로 옮기지 않고, 도착 시각 순 자리 그대로에서 오른쪽으로 미끄러지며
            // 사라집니다(약 4초).
            if (isDeparting) {
              return (
                <div
                  key={route.routeId}
                  className="gia-bus-out-card rounded-xl border-2 border-emerald-500 bg-emerald-500/10 p-3"
                  style={{ border: "2px solid #10b981", backgroundColor: "rgba(16,185,129,0.1)", borderRadius: 12, padding: 12 }}
                >
                  <p className="flex items-center gap-2 text-2xl font-black text-emerald-300" style={{ color: "#6ee7b7", fontSize: 24, fontWeight: 900 }}>
                    🚌💨 {route.routeNo}호차 {route.name ?? ""}
                  </p>
                  <p className="text-base font-bold text-emerald-400" style={{ color: "#34d399", fontWeight: 700 }}>
                    ✅ 출발했습니다 - 다음에 만나요!
                  </p>
                </div>
              );
            }

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
                  (isNew ? "gia-card-in border-amber-300 bg-amber-500/20" : "border-slate-700 bg-slate-800")
                }
                style={{
                  borderRadius: 12,
                  padding: 12,
                  border: isNew ? "2px solid #fcd34d" : "2px solid #334155",
                  backgroundColor: isNew ? "rgba(245,158,11,0.2)" : "#1e293b",
                }}
              >
                <div className="mb-1 flex items-center justify-between" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <p className="flex items-center gap-2 text-2xl font-black text-amber-300" style={{ color: "#fcd34d", fontSize: 24, fontWeight: 900 }}>
                    {isNew && <span className="inline-block">🚌</span>}
                    {route.routeNo}호차 {route.name ?? ""}
                  </p>
                  <p className="text-xs text-slate-400" style={{ color: "#94a3b8", fontSize: 12 }}>
                    {fmtTime(arrivedEvent.created_at)} 도착
                  </p>
                </div>
                {waiting.length === 0 ? (
                  <p className="text-base font-bold text-emerald-400" style={{ color: "#34d399", fontWeight: 700 }}>
                    ✅ 전원 탑승 완료
                  </p>
                ) : (
                  <p
                    className={"flex flex-wrap gap-2 text-lg font-bold leading-snug " + (isNew ? "gia-names-in" : "")}
                    style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 18, fontWeight: 700, color: "#ffffff" }}
                  >
                    {waiting.map((r, i) => (
                      <span key={i}>{r.studentName}</span>
                    ))}
                  </p>
                )}
                {(boarded.length > 0 || pickedUp.length > 0) && (
                  <p className="mt-1 text-[11px] text-slate-500" style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                    {boarded.length > 0 && <>탑승완료 {boarded.length}명 </>}
                    {pickedUp.length > 0 && <>· 픽업 {pickedUp.length}명</>}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
