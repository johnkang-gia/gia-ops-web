"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DismissalOpsClient from "./DismissalOpsClient";
import { VISIBLE_DEPARTMENTS } from "@/lib/department";
import { useKstClock } from "@/lib/useKstClock";
import { useFullscreen } from "@/lib/useFullscreen";
import { useBoardDensity, type BoardScale, type Density } from "@/lib/useBoardDensity";

// 요청: "gia운영에 있는 업무 탭을 사무실 가운데에 큰 모니터에 띄워서 전체가 한눈에 보고 파악할
// 수 있는 통합 대시보드... 페이지를 반으로 나눠서 한쪽은 cctv 그리고 한쪽은 우리 gia운영 앱"
//
// 이 화면은 그 "운영앱 쪽 절반"입니다. CCTV는 노트북에서 따로 띄우고, 이 페이지는 브라우저
// 창 하나로 화면 절반을 채우는 방식이라 가로폭이 좁아도 읽히도록 세로로 쌓는 배치를 씁니다.
// 멀리서 보는 화면이라 글자를 크게 잡았습니다.
//
// 오후 4시(설정값)가 되면 요청대로 이 절반이 통째로 하원 차량 화면으로 바뀝니다.

import { lessonPlace } from "@/lib/lessonLocation";
import { APP_VERSION } from "@/lib/version";

// 요청: "바뀌면 자동으로 새로고침해서 페이지를 수정해줘"
//
// 30초마다 받아오면 교시가 바뀐 뒤 최대 30초 동안 지난 시간표가 걸려 있습니다. 종이 쳤는데
// 화면은 아직 지난 교시를 보여주면, 보는 사람이 화면을 안 믿게 됩니다. 그래서 두 가지를
// 함께 씁니다.
//   - 평소에는 15초마다 받아옵니다.
//   - 교시가 끝나는 시각을 미리 알고 있으므로, 그 순간에 맞춰 한 번 더 받아옵니다.
const POLL_MS = 15_000;

type Lesson = { subjectName: string; teacherName: string | null; room: string | null };
type BoardData = {
  appVersion?: string;
  label: string;
  department: string;
  today: string;
  nowLabel: string;
  isWeekday: boolean;
  currentPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  nextPeriod: { id: string; label: string; startTime: string; endTime: string } | null;
  grades: {
    grade: string;
    classes: { id: string; className: string; homeroom: string | null; room: string | null; current: Lesson | null; next: Lesson | null }[];
  }[];
  studentCount: number;
  absences: { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean }[];
  pickups: string[];
  inquiries: { id: string; student: string; type: string | null; summary: string; urgent: boolean; at: string }[];
  collector: { lastSeen: string | null; status: string | null; stale: boolean } | null;
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string; endLabel: string };
};

// 언제 온 문의인지. 오늘 것은 시각만, 그 전 것은 요일까지 적습니다 - 멀리서 보는 화면이라
// "3시간 전" 같은 표현보다 시각이 바로 읽힙니다.
function inquiryTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const hhmm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return hhmm;
  return `${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]} ${hhmm}`;
}

const STATUS_COLOR: Record<string, string> = {
  결석: "#dc2626",
  지각: "#d97706",
  조퇴: "#7c3aed",
  기타: "#64748b",
};

export default function OpsBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  // 요청: "cctv프로그램이 너무 많이 차지해서 공간이 많이 없더라고... 시간표랑함께 모든정보들이
  // 뜰 수 있도록" - 창 크기를 재서 글자·여백을 자동으로 줄입니다. 화면 절반을 가정하고 크기를
  // 숫자로 박아두면, CCTV가 절반보다 더 차지할 때 아래 내용이 화면 밖으로 밀려납니다.
  const sc = useBoardDensity(`opsBoardDensity:${token}`);
  // 요청: "대시보드 분말고 초까지 나오도록" - 1초마다 도는 시계(서버 갱신 주기와 무관).
  const clock = useKstClock();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 부서는 화면에서 바로 바꿀 수 있습니다(요청: "화면에서 유치부,초등부,중고등부 선택할 수
  // 있게"). null이면 링크에 설정된 기본 부서를 씁니다.
  const [department, setDepartment] = useState<string | null>(null);

  // ── 하원 전체화면 ──────────────────────────────────────────────────────────
  // 요청: "하원시간에는 전체화면으로 전환되고 하원종료버튼을 누르거나 종료시간이 되면 다시
  // 화면 되돌리게".
  const { isFullscreen, enter, exit } = useFullscreen();
  // 사람이 [하원 종료]를 누른 날짜(YYYY-MM-DD). 브라우저에 저장해서 새로고침하거나 화면이
  // 저절로 다시 불러와져도 종료 상태가 유지되고, 날짜가 바뀌면 자연스럽게 초기화됩니다.
  const [endedOn, setEndedOn] = useState<string | null>(null);
  // 브라우저가 자동 전체화면을 거절했는지. 거절당했으면 큰 버튼을 띄워 한 번만 눌러달라고 합니다.
  const [needsManualFullscreen, setNeedsManualFullscreen] = useState(false);
  // 같은 하원 시간에 자동 전환을 반복해서 시도하지 않도록 하는 표시입니다.
  const autoTriedRef = useRef(false);

  const endedKey = `opsBoardDismissalEnded:${token}`;
  useEffect(() => {
    try {
      setEndedOn(localStorage.getItem(endedKey));
    } catch {
      // 브라우저 저장소를 못 쓰는 환경 - 종료 상태가 새로고침 후 풀릴 뿐 동작에는 지장 없습니다.
    }
  }, [endedKey]);

  const shuttleMode = !!data && data.shuttle.mode && endedOn !== data.today;

  // 하원 화면으로 바뀌면 전체화면을 시도하고, 끝나면 원래 반반 화면으로 돌려놓습니다.
  useEffect(() => {
    if (shuttleMode) {
      if (autoTriedRef.current) return;
      autoTriedRef.current = true;
      // 브라우저는 "사용자가 방금 누른 직후"가 아니면 전체화면을 거절합니다. 사무실 PC가 크롬
      // 기업정책으로 자동 전체화면을 허용해 뒀다면 여기서 바로 성공하고, 아니면 버튼을 띄웁니다.
      enter().then((ok) => setNeedsManualFullscreen(!ok));
      return;
    }
    autoTriedRef.current = false;
    setNeedsManualFullscreen(false);
    // 종료 시각이 지났거나 [하원 종료]를 눌렀을 때 - 전체화면에서 빠져나오는 것은 브라우저
    // 제약이 없어 완전히 자동으로 됩니다.
    exit();
  }, [shuttleMode, enter, exit]);

  function endDismissal() {
    if (!data) return;
    try {
      localStorage.setItem(endedKey, data.today);
    } catch {
      // 저장 실패해도 아래 상태 변경만으로 이번 세션에서는 종료됩니다.
    }
    setEndedOn(data.today);
  }

  function reopenDismissal() {
    try {
      localStorage.removeItem(endedKey);
    } catch {
      // 무시
    }
    setEndedOn(null);
  }

  const load = useCallback(async () => {
    try {
      const qs = department ? `?department=${encodeURIComponent(department)}` : "";
      const res = await fetch(`/api/ops-board/${token}${qs}`);
      if (!res.ok) {
        setErrorMsg("유효하지 않거나 종료된 링크입니다.");
        return;
      }
      setErrorMsg(null);
      setData((await res.json()) as BoardData);
    } catch {
      setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
    }
  }, [token, department]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // 새 버전이 올라오면 스스로 새로고침합니다.
  //
  // 요청: "공용 모니터라서 내가 가서 새로고침 누르는것 보다 자체적으로 새로고침이 되었으면"
  //
  // 이 화면은 며칠씩 켜둔 채로 둡니다. 그동안 새 버전을 배포해도 브라우저는 처음 받아둔
  // 코드를 계속 쓰기 때문에, 고친 것이 화면에 하나도 반영되지 않습니다. 그래서 서버가
  // 알려준 버전과 지금 돌고 있는 코드의 버전을 견주어 보고, 다르면 알아서 새로고침합니다.
  //
  // 새 버전이 올라왔을 때만 딱 한 번입니다(요청). 시간이 됐다고 새로고침하지 않습니다 -
  // 보고 있는 중에 화면이 깜빡이면 그것대로 방해가 됩니다.
  //
  // 새로고침한 뒤에도 버전이 그대로면(배포 캐시 등) 무한히 반복될 수 있어, 한 번 새로고침한
  // 뒤에는 10분 동안 다시 하지 않습니다. 새로고침이 계속 도는 화면은 아무것도 못 읽습니다.
  const serverVersion = data?.appVersion ?? null;
  useEffect(() => {
    if (!serverVersion || serverVersion === APP_VERSION) return;
    try {
      const last = Number(sessionStorage.getItem("opsBoardReloadAt") ?? "0");
      if (Date.now() - last < 10 * 60 * 1000) return;
      sessionStorage.setItem("opsBoardReloadAt", String(Date.now()));
    } catch {
      /* 저장이 막혀 있으면 그냥 새로고침합니다 */
    }
    // 잠깐 뒤에 새로고침합니다 - 배포 직후에는 파일이 아직 다 퍼지지 않았을 수 있습니다.
    const t = setTimeout(() => window.location.reload(), 3000);
    return () => clearTimeout(t);
  }, [serverVersion]);

  // 교시가 바뀌는 바로 그 순간에 맞춰 한 번 더 받아옵니다.
  //
  // 지금 교시의 끝나는 시각(또는 다음 교시의 시작 시각)까지 남은 시간을 재서, 그때 딱 맞춰
  // 다시 부릅니다. 종이 치는 순간 화면도 같이 바뀝니다.
  const boundary = data?.currentPeriod?.endTime ?? data?.nextPeriod?.startTime ?? null;
  useEffect(() => {
    if (!boundary) return;
    const [h, m] = boundary.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const now = new Date();
    const at = new Date(now);
    at.setHours(h, m, 2, 0); // 2초 여유 - 서버와 시계가 조금 어긋나도 지난 교시를 안 잡도록
    const wait = at.getTime() - now.getTime();
    if (wait <= 0 || wait > 2 * 60 * 60 * 1000) return;
    const t = setTimeout(load, wait);
    return () => clearTimeout(t);
  }, [boundary, load]);

  if (errorMsg && !data) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#e2e8f0", fontSize: 22 }}>
        {errorMsg}
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#64748b", fontSize: 20 }}>
        불러오는 중...
      </div>
    );
  }

  // 요청: "셔틀시작시간때(4:00)가 되면 화면이 전환되면서 실시간 셔틀 운행지도가 뜨고... 아래쪽에는
  // 아이들이 차량을 다 탑승했는지 하원차량 체크화면이 뜨고" - 설정한 시각이 되면 이 대시보드
  // 전체가 하원 운행 화면(위 지도 + 아래 차량 체크)으로 바뀝니다.
  if (shuttleMode) {
    return (
      <>
        <DismissalOpsClient
          token={token}
          endLabel={data.shuttle.endLabel}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => (isFullscreen ? exit() : enter().then((ok) => setNeedsManualFullscreen(!ok)))}
          onEnd={endDismissal}
        />
        {needsManualFullscreen && !isFullscreen && (
          <FullscreenPrompt
            onClick={() => enter().then((ok) => setNeedsManualFullscreen(!ok))}
            onDismiss={() => setNeedsManualFullscreen(false)}
          />
        )}
      </>
    );
  }

  const absentCount = data.absences.filter((a) => a.status === "결석").length;
  const lateCount = data.absences.filter((a) => a.status === "지각").length;
  const urgentInquiries = (data.inquiries ?? []).filter((q) => q.urgent).length;

  // 요청: "오늘업무는 오늘거만 보이게 해줘"
  //
  // 지금까지는 마감이 지난 것까지 함께 올라와서, 오늘 할 일을 보려는데 지난주 것이 위에
  // 쌓여 있었습니다. 오늘 마감이거나 오늘 새로 들어온 것만 남깁니다.
  // 스크롤이 없는 화면이라 개수도 함께 제한합니다 - 넘치면 그냥 잘려서 안 보입니다.
  const todayOnlyTasks = (data.taskSummary.todayTasks ?? []).filter((t) => t.kind !== "지남").slice(0, 8);

  return (
    // height + overflow:hidden - 대시보드는 아무도 스크롤하지 않으므로, 넘치면 화면 안에서
    // 각 패널이 알아서 줄어들도록 합니다(밀려나서 안 보이는 것보다 낫습니다).
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        background: "#0f172a",
        color: "#e2e8f0",
        padding: sc.s(16, 8),
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: sc.s(12, 6),
      }}
    >
      {/* 상단 - 날짜/시각/부서 선택 */}
      <div style={{ display: "flex", alignItems: "center", gap: sc.s(12, 6), flexWrap: "wrap", flexShrink: 0 }}>
        <span style={{ fontSize: sc.s(30, 18), fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{clock ?? data.nowLabel}</span>
        <span style={{ fontSize: sc.s(15, 11), color: "#94a3b8" }}>{data.today}</span>
        {/* 오늘 하원을 이미 종료한 경우 - 잘못 눌렀거나 늦게 도착한 차가 있으면 다시 열 수 있게
            합니다. 종료 시각(기본 17:30)이 지나면 이 버튼도 사라집니다. */}
        {data.shuttle.mode && endedOn === data.today && (
          <button
            onClick={reopenDismissal}
            style={{
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid #334155",
              background: "transparent",
              color: "#94a3b8",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🚌 하원 화면 다시 열기
          </button>
        )}
        {/* 지금은 초등부만 운영하므로 선택지가 하나뿐입니다. 고를 것이 없는 버튼은 화면만
            차지하므로, 부서가 둘 이상일 때만 보여줍니다. */}
        <div style={{ display: "flex", gap: sc.s(6, 4), marginLeft: "auto", alignItems: "center" }}>
          {(VISIBLE_DEPARTMENTS.length > 1 ? VISIBLE_DEPARTMENTS : []).map((d) => {
            const active = data.department === d;
            return (
              <button
                key={d}
                onClick={() => setDepartment(d)}
                style={{
                  padding: `${sc.s(6, 4)}px ${sc.s(14, 9)}px`,
                  borderRadius: 999,
                  border: "none",
                  fontSize: sc.s(15, 11),
                  fontWeight: 700,
                  cursor: "pointer",
                  background: active ? "#2563eb" : "#1e293b",
                  color: active ? "#fff" : "#94a3b8",
                }}
              >
                {d}
              </button>
            );
          })}
          {/* 자동 배율이 이 자리에 딱 맞지 않을 때를 위한 손잡이입니다. 모니터 크기·시력·서서
              보는 거리에 따라 적당한 크기가 다를 수밖에 없어서, 한 번 정해두면 저장됩니다. */}
          <DensityPicker sc={sc} />
        </div>
      </div>

      {/* ── 위: 교실 상황(좌) + 학부모 문의(우) ──────────────────────────────
          요청: "교실 상황을 반으로 나누고, 오른쪽에 학부모 문의를 많이 보이게 해줘"
          이 두 가지가 하루 중 가장 자주 보는 것이라 위쪽 절반씩을 나눠 씁니다. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: sc.narrow ? "1fr" : "1fr 1fr",
          gap: sc.s(12, 6),
          flex: "5 1 0",
          minHeight: 0,
        }}
      >
        {/* ① 지금 수업 (시간표) - 화면에서 가장 중요한 정보라 남는 공간을 가장 많이 가져갑니다 */}
        <Panel
          sc={sc}
          /* 요청: "학년 반 시간표 줄이지말고 확실하게 전체 보이게 만들어줘"
             반이 늘어나도 잘리지 않도록 이 칸이 남는 공간을 크게 가져가고, 그래도 모자라면
             아래에서 스크롤됩니다(칸 자체를 줄이지 않습니다). */
          grow={6}
          /* 요청: "쉬는 시간에는 쉬는시간이라고 뜨게 해주고, 다음교시 무슨시간인지를 미리
             보여주되 지금시간이 아니라는것을 표시해줘"
             수업 중이 아닌데 다음 교시가 남아 있으면 쉬는 시간입니다. 수업이 다 끝난 뒤와는
             다른 상황이라 구분해서 적습니다. */
          title={
            data.currentPeriod
              ? `지금 ${data.currentPeriod.label} (${data.currentPeriod.startTime}~${data.currentPeriod.endTime})`
              : data.nextPeriod
              ? `쉬는 시간 · ${data.nextPeriod.startTime}에 ${data.nextPeriod.label} 시작`
              : "오늘 수업이 모두 끝났습니다"
          }
          right={
            data.currentPeriod && data.nextPeriod
              ? `다음 ${data.nextPeriod.label} ${data.nextPeriod.startTime}`
              : null
          }
        >
          {!data.isWeekday ? (
            <Empty sc={sc} text="주말입니다" />
          ) : data.grades.length === 0 ? (
            <Empty sc={sc} text="이 부서에 등록된 반이 없습니다 — [학교 > 반·담임 관리]에서 반을 먼저 만들어주세요" />
          ) : (
            /* 요청: "각 학년과 반별로 어느수업이 진행되는지 뜨도록" - 학년을 왼쪽에 세로로 두고,
               그 학년의 반들을 오른쪽에 가로로 늘어놓아 학년 단위로 훑어볼 수 있게 했습니다. */
            <div style={{ display: "flex", flexDirection: "column", gap: sc.s(8, 4) }}>
              {data.grades.map((g) => (
                <div key={g.grade || "미지정"} style={{ display: "flex", alignItems: "stretch", gap: sc.s(8, 4) }}>
                  <div
                    style={{
                      minWidth: sc.s(58, 36),
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#1e3a5f",
                      borderRadius: sc.s(10, 6),
                      fontSize: sc.s(17, 12),
                      fontWeight: 800,
                      color: "#bfdbfe",
                      padding: `0 ${sc.s(8, 5)}px`,
                    }}
                  >
                    {g.grade || "미지정"}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      display: "grid",
                      // 요청: "교실들 아이콘 좀더 크게 해서 수업명이 잘리지않게해줘"
                      // 칸을 넓게 잡아 'Computer Science' 같은 긴 과목명도 들어갑니다.
                      gridTemplateColumns: `repeat(auto-fill, minmax(${sc.s(178, 120)}px, 1fr))`,
                      gap: sc.s(6, 4),
                    }}
                  >
                    {/* 요청: "그냥 지금 어느학년 어느반이 무슨시간인지 한눈에 볼 수있도록만 해주고".
                        반 이름과 지금 과목 두 줄만 남기고 담임·다음교시·담당교사는 뺐습니다 - 멀리서
                        보는 화면에서는 글자가 많을수록 오히려 안 읽힙니다. 수업이 없는 시간에만
                        교실 위치를 대신 보여줍니다(요청: "수업중이 아닐때 교실위치 보여주는 것은 좋고"). */}
                    {g.classes.map((c) => {
                      // 요청: "위치도 알 수 있게 표시해줘 (...) 일단 특수교실들은 장소를 바로
                      // 표시하지말고, 그냥 교실이 아닌곳에 있다는 표시만 해줬으면 좋겠어"
                      //
                      // 그래서 어느 방인지까지는 적지 않고, 교실을 비웠다는 것만 알립니다.
                      // 반을 찾으러 갈 때 "교실에 갔는데 없더라"를 막는 것이 목적입니다.
                      // 쉬는 시간에는 다음 교시를 미리 보여주되, 지금이 아니라는 것을 분명히
                      // 합니다(요청). 색을 죽이고 앞에 "다음"을 붙여, 지금 수업으로 잘못 읽는
                      // 일이 없게 했습니다.
                      const inBreak = !data.currentPeriod && !!data.nextPeriod;
                      const shown = data.currentPeriod ? c.current : inBreak ? c.next : null;
                      const place = lessonPlace(shown?.subjectName);
                      return (
                        <div
                          key={c.id}
                          style={{
                            background: inBreak ? "#172033" : place.special ? "#3f2d16" : "#1e293b",
                            border:
                              place.special && !inBreak ? "1px solid #a16207" : "1px dashed " + (inBreak ? "#334155" : "transparent"),
                            borderRadius: sc.s(10, 6),
                            padding: `${sc.s(10, 5)}px ${sc.s(12, 7)}px`,
                            minWidth: 0,
                          }}
                        >
                          {/* 요청: "각반 위치를 항상 (...) 나타나게 해주고 밖이면 교실밖이라고
                              변화되게 해줘" + "교실명 옆에 나오게 해도 되 학년과 반이 우선이야"
                              그래서 반 이름을 앞에 크게 두고, 위치는 바로 옆에 작게 붙입니다.
                              위치는 늘 같은 자리에 있어야 눈이 그 자리를 찾습니다 - 있다 없다
                              하면 매번 다시 훑게 됩니다. 교실에 있으면 교실 이름을, 나가면 그
                              자리 글자만 [교실 밖]으로 바뀝니다. */}
                          <div style={{ display: "flex", alignItems: "center", gap: sc.s(4, 3), minWidth: 0 }}>
                            <span
                              style={{
                                fontSize: sc.s(13, 10),
                                color: "#cbd5e1",
                                fontWeight: 800,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {c.className}
                            </span>
                            <span
                              style={{
                                fontSize: sc.s(11, 9),
                                fontWeight: 700,
                                color: place.special ? "#fbbf24" : "#64748b",
                                background: place.special ? "#78350f" : "#0f172a",
                                borderRadius: sc.s(5, 4),
                                padding: `0 ${sc.s(5, 3)}px`,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                minWidth: 0,
                              }}
                            >
                              {place.special ? "교실 밖" : c.room || "교실"}
                            </span>
                            {inBreak && shown && (
                              <span style={{ fontSize: sc.s(11, 9), fontWeight: 800, color: "#64748b", whiteSpace: "nowrap" }}>
                                다음
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: sc.s(24, 15),
                              fontWeight: 800,
                              // 쉬는 시간의 "다음 교시"는 색을 죽여 지금 수업과 헷갈리지 않게 합니다.
                              color: data.currentPeriod ? (c.current ? "#fff" : "#475569") : shown ? "#7b8ba3" : "#475569",
                              marginTop: 2,
                              lineHeight: 1.15,
                              // 잘라서 "Comput…"으로 보이면 무슨 수업인지 알 수 없습니다.
                              // 길면 두 줄까지 내려 씁니다.
                              overflowWrap: "anywhere",
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical" as const,
                              overflow: "hidden",
                            }}
                          >
                            {shown?.subjectName ?? "—"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ②-b 학부모 문의사항 - 요청: "운영 대시보드에 이 학부모 문의사항도 띄워줘"
            아직 답하지 않은 것만 올립니다. 처리된 것까지 섞이면 훑어보는 의미가 없습니다. */}
        <Panel
          sc={sc}
          grow={1}
          title={`학부모 문의 ${data.inquiries?.length ?? 0}건`}
          right={
            /* 수집기가 멈추면 문의가 안 들어옵니다. 그런데 화면은 "문의 없음"으로 똑같이
               보여서, 조용히 아무것도 안 하면서 정상인 척하게 됩니다. 그래서 여기 적습니다. */
            data.collector?.stale
              ? "⚠ 토들 수집기 멈춤"
              : urgentInquiries > 0
              ? `급한 것 ${urgentInquiries}건`
              : data.collector?.lastSeen
              ? `수집 ${new Date(data.collector.lastSeen).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
              : null
          }
        >
          {data.collector?.stale ? (
            <div
              style={{
                background: "#3f1d1d",
                border: "1px solid #b91c1c",
                borderRadius: sc.s(8, 6),
                padding: sc.s(9, 6),
                fontSize: sc.s(14, 11),
                color: "#fca5a5",
                lineHeight: 1.5,
              }}
            >
              <b>토들 수집기가 멈춰 있습니다.</b>
              <br />
              {data.collector.status === "login_required"
                ? "사무실 PC 크롬에서 토들에 다시 로그인해주세요."
                : data.collector.lastSeen
                ? `마지막 신호 ${new Date(data.collector.lastSeen).toLocaleString("ko-KR")} · 지금은 토들 문의가 자동으로 들어오지 않습니다.`
                : "아직 한 번도 연결된 적이 없습니다."}
            </div>
          ) : !data.inquiries || data.inquiries.length === 0 ? (
            <Empty sc={sc} text="답할 문의 없음" tone="good" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: sc.s(4, 3) }}>
              {/* 요청: "오른쪽에 학부모 문의를 많이 보이게 해줘"
                  오른쪽 절반을 통으로 쓰므로 넉넉히 올립니다. 스크롤이 없어 넘치면 잘리는데,
                  급한 것과 최근 것이 위에 오도록 이미 정렬해 두어 잘리는 쪽은 덜 급한 것입니다. */}
              {data.inquiries.slice(0, sc.narrow ? 6 : 16).map((q) => (
                <div
                  key={q.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sc.s(6, 4),
                    background: "#1e293b",
                    borderLeft: `4px solid ${q.urgent ? "#dc2626" : "#0284c7"}`,
                    borderRadius: 6,
                    padding: `${sc.s(5, 3)}px ${sc.s(9, 6)}px`,
                    minWidth: 0,
                  }}
                >
                  <b style={{ fontSize: sc.s(15, 11), color: "#fff", whiteSpace: "nowrap" }}>{q.student}</b>
                  {q.type && (
                    <span
                      style={{
                        fontSize: sc.s(11, 9),
                        fontWeight: 700,
                        color: "#93c5fd",
                        background: "#1e3a5f",
                        borderRadius: 5,
                        padding: `0 ${sc.s(5, 3)}px`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {q.type}
                    </span>
                  )}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: sc.s(14, 11),
                      color: "#cbd5e1",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {q.summary}
                  </span>
                  <span style={{ fontSize: sc.s(11, 9), color: "#64748b", whiteSpace: "nowrap" }}>{inquiryTime(q.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── 아래: 출결 · 픽업 · 오늘 업무 ────────────────────────────────────
          요청: "출결과 픽업은 아래로 내려주고". 셋 다 "있으면 보는" 정보라 아래에 나란히
          둡니다. 위쪽 둘과 달리 대개 몇 줄이면 끝납니다. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: sc.narrow ? "1fr" : "1fr 1fr 1.4fr",
          gap: sc.s(12, 6),
          flex: "3 1 0",
          minHeight: 0,
        }}
      >
        {/* ② 오늘 출결 + 픽업 - 아래 줄에서 오늘 업무와 나란히 놓입니다(요청). */}
          <Panel sc={sc} title={`오늘 출결 · 결석 ${absentCount} 지각 ${lateCount}`} right={`재적 ${data.studentCount}명`}>
            {data.absences.length === 0 ? (
              <Empty sc={sc} text="전원 출석" tone="good" />
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4) }}>
                {data.absences.slice(0, 14).map((a, i) => (
                  <span
                    key={i}
                    title={a.note ?? undefined}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: sc.s(5, 3),
                      background: "#1e293b",
                      borderLeft: `4px solid ${STATUS_COLOR[a.status] ?? "#64748b"}`,
                      borderRadius: 6,
                      padding: `${sc.s(5, 3)}px ${sc.s(9, 6)}px`,
                      fontSize: sc.s(16, 12),
                    }}
                  >
                    <b style={{ color: "#fff" }}>{a.name}</b>
                    <span style={{ fontSize: sc.s(12, 10), color: STATUS_COLOR[a.status] ?? "#94a3b8", fontWeight: 700 }}>{a.status}</span>
                    {!a.contacted && <span style={{ fontSize: sc.s(11, 9), color: "#f59e0b" }}>연락전</span>}
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel sc={sc} title={`오늘 하원 픽업 ${data.pickups.length}명`}>
            {data.pickups.length === 0 ? (
              <Empty sc={sc} text="픽업 예정 없음" />
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4) }}>
                {data.pickups.slice(0, 14).map((name, i) => (
                  <span
                    key={i}
                    style={{
                      background: "#1e293b",
                      borderLeft: "4px solid #0ea5e9",
                      borderRadius: 6,
                      padding: `${sc.s(5, 3)}px ${sc.s(9, 6)}px`,
                      fontSize: sc.s(16, 12),
                      color: "#fff",
                      fontWeight: 600,
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            )}
          </Panel>
        {/* ③ 오늘 업무 */}
        <Panel
          sc={sc}
          grow={2}
          title={`오늘 업무 ${todayOnlyTasks.length}건`}
          right={Object.entries(data.taskSummary.statusCounts)
            .map(([k, v]) => `${k} ${v}`)
            .join(" · ")}
        >
          {todayOnlyTasks.length === 0 ? (
            <Empty sc={sc} text="오늘 마감·신규 업무 없음" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: sc.s(4, 3) }}>
              {todayOnlyTasks.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: sc.s(8, 5),
                    background: "#1e293b",
                    borderRadius: sc.s(8, 5),
                    padding: `${sc.s(6, 3)}px ${sc.s(10, 6)}px`,
                  }}
                >
                  <span
                    style={{
                      fontSize: sc.s(11, 9),
                      fontWeight: 800,
                      padding: `2px ${sc.s(7, 5)}px`,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: t.kind === "지남" ? "#7f1d1d" : t.kind === "마감" ? "#78350f" : "#1e3a8a",
                      color: t.kind === "지남" ? "#fca5a5" : t.kind === "마감" ? "#fcd34d" : "#93c5fd",
                    }}
                  >
                    {t.kind}
                  </span>
                  {t.urgent && <span style={{ fontSize: sc.s(13, 10) }}>🔥</span>}
                  <span style={{ fontSize: sc.s(16, 12), color: "#fff", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.title}
                  </span>
                  {/* 좁은 창에서는 부서까지 넣으면 제목이 잘립니다 - 제목이 먼저입니다. */}
                  {t.department && !sc.narrow && <span style={{ fontSize: sc.s(12, 10), color: "#64748b", flexShrink: 0 }}>{t.department}</span>}
                  <span style={{ fontSize: sc.s(12, 10), color: "#94a3b8", flexShrink: 0 }}>{t.status}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>


      <div style={{ fontSize: sc.s(12, 9), color: "#475569", textAlign: "center", flexShrink: 0 }}>
        {data.label} · 15초마다 자동 갱신 · 새 버전이 올라오면 스스로 새로고침 ·{" "}
        {data.shuttle.switchLabel}~{data.shuttle.endLabel} 하원 운행 화면(전체화면)
      </div>
    </div>
  );
}

// grow를 주면 남는 세로 공간을 그 비율만큼 가져가고, 내용이 넘치면 패널 안에서만 스크롤됩니다.
// 패널이 커져서 아래 패널을 화면 밖으로 밀어내는 일이 없어집니다 - 대시보드는 아무도 스크롤하지
// 않기 때문에, 밀려난 정보는 없는 것과 같습니다.
function Panel({
  title,
  right,
  children,
  sc,
  grow,
}: {
  title: string;
  right?: string | null;
  children: React.ReactNode;
  sc: BoardScale;
  grow?: number;
}) {
  return (
    <div
      style={{
        background: "#111c33",
        borderRadius: sc.s(14, 8),
        padding: sc.s(12, 7),
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        ...(grow ? { flex: `${grow} 1 0` } : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(8, 5), flexShrink: 0 }}>
        <h2 style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#e2e8f0", margin: 0 }}>{title}</h2>
        {right && <span style={{ fontSize: sc.s(13, 10), color: "#64748b", marginLeft: "auto", textAlign: "right" }}>{right}</span>}
      </div>
      {/* 요청: "공용모니터에 연결한거라 스크롤이 되면 내릴사람이 없어, 때문에 스크롤안되게"
          스크롤을 막으면 넘치는 것은 잘립니다. 그래서 각 칸에서 보여줄 개수를 미리 줄여
          애초에 넘치지 않게 했습니다 - 아래에 뭔가 더 있는데 아무도 못 보는 것보다,
          중요한 것부터 화면 안에 들어오게 하는 편이 낫습니다. */}
      <div style={{ minHeight: 0, overflow: "hidden", flex: 1 }}>{children}</div>
    </div>
  );
}

function Empty({ text, tone, sc }: { text: string; tone?: "good"; sc: BoardScale }) {
  return (
    <p style={{ margin: 0, padding: `${sc.s(10, 5)}px 0`, fontSize: sc.s(16, 12), color: tone === "good" ? "#10b981" : "#475569" }}>{text}</p>
  );
}

// 글자 크기 손잡이. 자동 배율이 기본이고, 모니터·시력·보는 거리에 따라 한 단계씩 올리거나
// 내릴 수 있습니다. 고른 값은 그 컴퓨터에 저장됩니다.
const DENSITY_LABEL: Record<Density, string> = { auto: "자동", large: "크게", normal: "보통", small: "작게" };

function DensityPicker({ sc }: { sc: BoardScale }) {
  const order: Density[] = ["auto", "large", "normal", "small"];
  const next = order[(order.indexOf(sc.density) + 1) % order.length];
  return (
    <button
      onClick={() => sc.setDensity(next)}
      title="화면 글자 크기 (자동 → 크게 → 보통 → 작게)"
      style={{
        padding: `${sc.s(6, 4)}px ${sc.s(12, 8)}px`,
        borderRadius: 999,
        border: "1px solid #334155",
        background: "transparent",
        color: "#94a3b8",
        fontSize: sc.s(13, 10),
        fontWeight: 700,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      🔍 {DENSITY_LABEL[sc.density]}
    </button>
  );
}

// 브라우저가 자동 전체화면을 거절했을 때 뜨는 안내입니다.
//
// 아무 웹사이트나 시간이 되면 마음대로 화면을 덮지 못하게 하는 브라우저 규칙 때문에, 전체화면은
// "사람이 방금 누른 직후"에만 시작할 수 있습니다. 그래서 하루 한 번 이 버튼을 눌러주셔야 합니다.
// 반대로 되돌아오는 것은 제약이 없어 종료 시각이 되면 저절로 풀립니다.
//
// 화면 전체를 가리지 않고 오른쪽 아래에 띄웁니다 - 누르지 않아도 하원 화면 자체는 이미 잘 보이고
// 있어서, 급할 때는 그냥 무시하고 반반 화면으로 쓰셔도 됩니다.
function FullscreenPrompt({ onClick, onDismiss }: { onClick: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 60,
        background: "#1d4ed8",
        borderRadius: 14,
        padding: "12px 14px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 420,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>하원 시간입니다 — 전체화면으로 볼까요?</div>
        <div style={{ fontSize: 12, color: "#c7d8ff", marginTop: 2, lineHeight: 1.5 }}>
          브라우저 보안 규칙 때문에 전체화면은 사람이 눌러야 시작됩니다. 종료 시각이 되거나 [하원 종료]를 누르면 저절로 원래
          화면으로 돌아옵니다.
        </div>
      </div>
      <button
        onClick={onClick}
        style={{
          flexShrink: 0,
          background: "#fff",
          color: "#1d4ed8",
          border: "none",
          borderRadius: 10,
          padding: "10px 16px",
          fontSize: 15,
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        전체화면
      </button>
      <button
        onClick={onDismiss}
        title="이번에는 반반 화면으로 두기"
        style={{ flexShrink: 0, background: "transparent", border: "none", color: "#c7d8ff", fontSize: 18, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}
