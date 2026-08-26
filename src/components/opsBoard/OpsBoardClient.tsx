"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DismissalOpsClient from "./DismissalOpsClient";
import { VISIBLE_DEPARTMENTS } from "@/lib/department";
import { useKstClock } from "@/lib/useKstClock";
import { useFullscreen } from "@/lib/useFullscreen";
import { useIdleCursor } from "@/lib/useIdleCursor";
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
import LunchCountdown from "./LunchCountdown";
import InquiryBoard from "./InquiryBoard";
import { useSmartPoll } from "@/lib/useSmartPoll";

// 요청: "바뀌면 자동으로 새로고침해서 페이지를 수정해줘"
//
// 30초마다 받아오면 교시가 바뀐 뒤 최대 30초 동안 지난 시간표가 걸려 있습니다. 종이 쳤는데
// 화면은 아직 지난 교시를 보여주면, 보는 사람이 화면을 안 믿게 됩니다. 그래서 두 가지를
// 함께 씁니다.
//   - 평소에는 15초마다 받아옵니다.
//   - 교시가 끝나는 시각을 미리 알고 있으므로, 그 순간에 맞춰 한 번 더 받아옵니다.
const POLL_MS = 15_000;
// 하원 시간대가 아닐 때 폴링 간격(새벽·주말 등).
const IDLE_POLL_MS = 120_000;

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
  nightInfo?: { events: { date: string; name: string }[]; reportsThisWeek: number };
  absences: { name: string; grade: string | null; className: string | null; status: string; note: string | null; contacted: boolean }[];
  pickups: string[];
  inquiries: { id: string; student: string; type: string | null; summary: string; urgent: boolean; at: string; replied?: boolean }[];
  collector: { lastSeen: string | null; status: string | null; stale: boolean } | null;
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string; endLabel: string };
};

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

const STATUS_COLOR: Record<string, string> = {
  결석: "#dc2626",
  지각: "#d97706",
  조퇴: "#7c3aed",
  기타: "#64748b",
};

export default function OpsBoardClient({ token }: { token: string }) {
  const [data, setData] = useState<BoardData | null>(null);
  // 일정 시간 안 움직이면 마우스 커서를 숨깁니다(요청: 대시보드 상시 표시라 커서가 거슬림).
  const cursorHidden = useIdleCursor(4000);
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

  // 터치 상호작용용 작은 창들.
  // 요청: "짧게 누르면 해당 토들 메시지 따로 작은 창으로" + "각반을 누르면 일주일 시간표가 팝업"
  const [inquiryView, setInquiryView] = useState<{ student: string; channel: string | null; raw: string | null; at: string } | null>(null);
  const [weekClass, setWeekClass] = useState<{ id: string; name: string } | null>(null);

  const endedKey = `opsBoardDismissalEnded:${token}`;
  useEffect(() => {
    try {
      setEndedOn(localStorage.getItem(endedKey));
    } catch {
      // 브라우저 저장소를 못 쓰는 환경 - 종료 상태가 새로고침 후 풀릴 뿐 동작에는 지장 없습니다.
    }
  }, [endedKey]);

  const shuttleMode = !!data && data.shuttle.mode && endedOn !== data.today;

  // 요청: "전체화면 안해도 될거같아 지금 업무대시보드를 전체화면으로 계속 띄울거라서" - 앱이
  // 스스로 전체화면을 강제하거나 안내창을 띄우지 않습니다. 담당자가 브라우저를 이미 전체화면으로
  // 띄워두므로, 여기서는 아무것도 하지 않습니다. (원하면 상단의 전체화면 버튼으로 직접 전환 가능)
  useEffect(() => {
    autoTriedRef.current = false;
    setNeedsManualFullscreen(false);
  }, [shuttleMode]);

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
  }, [load]);
  // 서버 호출 절감(Vercel 무료 한도): 화면이 안 보이면 멈추고, 하원 시간대(평일 14~19시)가
  // 아니면 느리게 돕니다. 대형 모니터에 하루 종일 띄워둬도 호출량이 크게 줄어듭니다.
  useSmartPoll(load, { activeMs: POLL_MS, idleMs: IDLE_POLL_MS });

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

  const urgentInquiries = (data.inquiries ?? []).filter((q) => q.urgent).length;

  //
  // 지금까지는 마감이 지난 것까지 함께 올라와서, 오늘 할 일을 보려는데 지난주 것이 위에
  // 쌓여 있었습니다. 오늘 마감이거나 오늘 새로 들어온 것만 남깁니다.
  // 스크롤이 없는 화면이라 개수도 함께 제한합니다 - 넘치면 그냥 잘려서 안 보입니다.

  // 지금이 점심시간인지.
  //
  // 시간표에 등록된 교시 이름으로 봅니다("점심", "중식", "Lunch"). 시각을 코드에 박아두면
  // 학기마다 시간이 바뀔 때 아무도 여기를 고칠 생각을 못 합니다 - 시간표를 고치면 이 화면도
  // 따라오는 것이 맞습니다.
  const lunchPeriod =
    data.currentPeriod && /점심|중식|lunch/i.test(data.currentPeriod.label) ? data.currentPeriod : null;

  // 요청: "하원시간이 되면 시간표 자리 다음날 오전8시까지는 (...) 학교 정보 그리고 학사일정 달력을".
  // 하원 시작(대략 오후 4시)부터 다음날 오전 8시까지는 시간표 자리에 학교 정보·학사일정을 띄웁니다.
  const nowHour = parseInt((data.nowLabel ?? "00:00").split(":")[0] || "0", 10);
  const nightMode = nowHour >= 16 || nowHour < 8;

  return (
    // height + overflow:hidden - 대시보드는 아무도 스크롤하지 않으므로, 넘치면 화면 안에서
    // 각 패널이 알아서 줄어들도록 합니다(밀려나서 안 보이는 것보다 낫습니다).
    <div
      style={{
        height: "100dvh",
        overflow: "hidden",
        // 요청: "업무 대시보드 터치가능하게" - 터치스크린에서 눌러 조작할 수 있도록 합니다.
        // manipulation은 더블탭 확대 지연을 없애 탭이 바로 먹게 합니다.
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
        cursor: cursorHidden ? "none" : undefined,
        background: "#0f172a",
        color: "#e2e8f0",
        padding: sc.s(16, 8),
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: sc.s(12, 6),
      }}
    >
      {/* 상단 - 시각/날짜(왼쪽) · 로고(가운데) · 부서(오른쪽)
          로고를 진짜 화면 한가운데 두려면 양옆이 같은 폭이어야 합니다. 그래서 세 칸짜리
          격자로 두고 가운데 칸에만 로고를 넣었습니다 - flex로 하면 왼쪽 글자 길이에 따라
          로고가 조금씩 움직입니다. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: sc.s(12, 6),
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: sc.s(12, 6), flexWrap: "wrap", minWidth: 0 }}>
        <span style={{ fontSize: sc.s(30, 18), fontWeight: 800, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{clock ?? data.nowLabel}</span>
        {/* 요일까지 함께 적습니다(요청: "날짜 옆에 요일도 표시"). 공용 모니터에서 날짜만
            보고 무슨 요일인지 세는 일이 잦아서, 요일제 셔틀·시간표를 볼 때 특히 헷갈렸습니다. */}
        <span style={{ fontSize: sc.s(15, 11), color: "#94a3b8" }}>
          {data.today} ({WEEKDAY_KO[new Date(`${data.today}T12:00:00+09:00`).getDay()]})
        </span>
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
        </div>

        {/* 학교 로고 - 공용 모니터라 지나가는 분들도 봅니다. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-main.png"
          alt="GIA"
          style={{ height: sc.s(38, 24), width: "auto", objectFit: "contain", opacity: 0.95 }}
        />

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

      {/* ── 화면을 세로로 반 가르기 ───────────────────────────────────────────
          요청: "학부모문의칸을 아예 화면 반으로 쓸 수 있도록", "오늘업무를 지우고, 결석·지각·
          픽업을 한 탭에서 분류해서".

          왼쪽 = 지금 무슨 수업인지(시간표, 크기 고정) + 오늘 출결(결석·지각·픽업 한 칸).
          오른쪽 = 학부모 문의. 위아래로 잘라 쓰던 것을 통째로 오른쪽 절반에 줘서, 스크롤 없이
          한 번에 보이는 문의 수가 두 배가 됐습니다. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: sc.narrow ? "1fr" : "1fr 1fr",
          gap: sc.s(12, 6),
          flex: "1 1 0",
          minHeight: 0,
        }}
      >
        {/* ── 왼쪽: 시간표(고정) + 오늘 출결 ───────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: sc.s(12, 6), minHeight: 0, minWidth: 0 }}>
        {/* ① 지금 수업(시간표) - 낮에는 시간표, 하원 시작~다음날 아침에는 학교 정보·학사일정. */}
        {nightMode ? (
          <NightInfoPanel sc={sc} data={data} />
        ) : (
        <Panel
          sc={sc}
          /* 크기를 고정하되, 고정하는 쪽을 반대로 잡았습니다.
             요청 ①: "시간표칸이 안 보여. 시간표가 출결·픽업보다 중요해."
             처음에는 시간표 높이를 픽셀로 못 박았는데, 그 값이 학년 두 줄에 모자라 정작 시간표가
             잘려 보였습니다. 실제로 크기가 출렁이던 원인은 시간표가 아니라 옆 칸(출결·픽업)이
             날마다 인원이 달라지는 것이었으므로, **출결·픽업 쪽을 고정 높이로 두고 시간표가
             남는 공간을 전부 가져가게** 했습니다. 이러면 시간표는 늘 가장 크고, 동시에 옆 칸
             변화에 흔들리지도 않습니다. */
          grow={1}
          /* 요청: "쉬는 시간에는 쉬는시간이라고 뜨게 해주고, 다음교시 무슨시간인지를 미리
             보여주되 지금시간이 아니라는것을 표시해줘"
             수업 중이 아닌데 다음 교시가 남아 있으면 쉬는 시간입니다. 수업이 다 끝난 뒤와는
             다른 상황이라 구분해서 적습니다. */
          title={
            lunchPeriod
              ? `${lunchPeriod.label}`
              : data.currentPeriod
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
          {lunchPeriod ? (
            /* 점심시간에는 시간표 대신 남은 시간을 크게 보여줍니다 - 이 시간에 반별 과목은
               볼 것이 없고, 정작 궁금한 것은 "얼마나 남았나" 하나입니다. */
            <LunchCountdown
              startTime={lunchPeriod.startTime}
              endTime={lunchPeriod.endTime}
              label={lunchPeriod.label}
              size={sc.s(230, 150)}
            />
          ) : !data.isWeekday ? (
            <Empty sc={sc} text="주말입니다" />
          ) : data.grades.length === 0 ? (
            <Empty sc={sc} text="이 부서에 등록된 반이 없습니다 — [학교 > 반·담임 관리]에서 반을 먼저 만들어주세요" />
          ) : (
            /* 요청: "각 학년과 반별로 어느수업이 진행되는지 뜨도록" - 학년을 왼쪽에 세로로 두고,
               그 학년의 반들을 오른쪽에 가로로 늘어놓아 학년 단위로 훑어볼 수 있게 했습니다. */
            <div style={{ display: "flex", flexDirection: "column", gap: sc.s(8, 4), flex: 1, minHeight: 0 }}>
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
                          // 요청: "각반을 누르면 일주일 시간표가 팝업창으로 뜨도록"
                          onClick={() => setWeekClass({ id: c.id, name: `${g.grade ?? ""} ${c.className}`.trim() })}
                          role="button"
                          style={{
                            background: inBreak ? "#172033" : place.special ? "#3f2d16" : "#1e293b",
                            border:
                              place.special && !inBreak ? "1px solid #a16207" : "1px dashed " + (inBreak ? "#334155" : "transparent"),
                            borderRadius: sc.s(10, 6),
                            padding: `${sc.s(10, 5)}px ${sc.s(12, 7)}px`,
                            minWidth: 0,
                            cursor: "pointer",
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
                              // 요청: "4교시 좀더 글자 키워주고" - 멀리서 읽는 화면이라 과목명을
                              // 키웠습니다. 학년 행 높이가 균등해지며 생긴 공간을 여기에 씁니다.
                              fontSize: sc.s(30, 18),
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
                              // 항상 두 줄 높이를 차지합니다(요청: "컴퓨터 사이언스일 때의 크기로
                              // 아예 고정해서 수업이 바뀌어도 시간표 위젯 크기가 안 변하게").
                              //
                              // 예전에는 최대 두 줄까지 늘어나기만 해서, 'Math'인 반은 한 줄,
                              // 'Computer Science'인 반은 두 줄이 됐습니다. 그래서 교시가 바뀔
                              // 때마다 학년 줄 높이가, 나아가 시간표 위젯 전체 높이가 출렁였습니다.
                              // 짧은 과목명일 때도 두 줄 자리를 비워두면 무슨 수업이든 같은 크기입니다.
                              height: Math.round(sc.s(30, 18) * 1.15 * 2),
                            }}
                          >
                            {shown?.subjectName ?? "—"}
                          </div>
                          {/* 요청: "수업하시는 선생님들은 각교실 과목아래에 작게 누구수업인지
                              적어주고, 담임이면 담임이름 적어주고" - 지금 수업의 담당 선생님을,
                              수업이 없으면 담임을 작게 적습니다. */}
                          {/* 요청: "시간표에서 지금수업하시는 선생님만 표시되게" - 지금 교시의
                              담당 선생님만 적습니다. 담임 폴백·유휴 로스터는 뺐습니다. */}
                          {/* 선생님 이름 줄도 늘 자리를 차지합니다 - 있다 없다 하면 그것만으로
                              카드 높이가 한 줄씩 달라져서 위젯이 또 출렁입니다. 이름이 없으면
                              빈 줄로 둡니다. */}
                          {(
                            <div
                              style={{
                                fontSize: sc.s(12, 9),
                                color: "#64748b",
                                marginTop: 2,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                height: Math.round(sc.s(12, 9) * 1.3),
                              }}
                            >
                              {shown?.teacherName ?? " "}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

        </Panel>
        )}

        {/* ② 오늘 출결 - 결석·지각·픽업을 한 칸에서 분류해 봅니다(요청).
            예전에는 [하원 픽업]과 [오늘 출결]이 아래쪽에 따로 있어서, 같은 학생이 두 칸에
            나뉘어 뜨고 눈이 두 번 왔다 갔다 해야 했습니다. 셋 다 "오늘 이 아이가 평소와 다르다"는
            같은 종류의 정보라 한 칸에 모으고, 분류는 색 있는 머리표로 나눴습니다. */}
        <AttendancePanel sc={sc} data={data} />
        </div>

        {/* ── 오른쪽: 학부모 문의 (화면 세로 절반 전체) ─────────────────────────
            요청: "학부모문의칸을 아예 화면 반으로 쓸 수 있도록". 아직 답하지 않은 것만
            올립니다 - 처리된 것까지 섞이면 훑어보는 의미가 없습니다. */}
        <Panel
          sc={sc}
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
            /* 요청: "글자를 좀더 크게 (...) 이름을 좀더 크게 그리고 그아래에 문의내용 간단히
               요약해서 (...) 스크롤이 내려간다면 계속 몇초에 한번씩 다음페이지 보여줬다가
               돌아왔다가" - 스크롤을 내릴 사람이 없으니 장을 넘기는 쪽으로 했습니다. */
            <InquiryBoard
              items={data.inquiries}
              s={sc.s}
              onOpen={(q) => setInquiryView({ student: q.student, channel: q.channel ?? null, raw: q.raw ?? null, at: q.at })}
              onDismiss={async (q) => {
                // 낙관적으로 화면에서 먼저 빼고, 서버에 처리 완료로 표시합니다.
                setData((prev) => (prev ? { ...prev, inquiries: prev.inquiries.filter((x) => x.id !== q.id) } : prev));
                try {
                  await fetch(`/api/ops-board/${token}/inquiry`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: q.id }),
                  });
                } catch {
                  load(); // 실패하면 되돌립니다(다음 갱신에서 다시 나타납니다).
                }
              }}
            />
          )}
        </Panel>
      </div>

      <div style={{ fontSize: sc.s(12, 9), color: "#475569", textAlign: "center", flexShrink: 0 }}>
        {data.label} · 15초마다 자동 갱신 · 새 버전이 올라오면 스스로 새로고침 ·{" "}
        {data.shuttle.switchLabel}~{data.shuttle.endLabel} 하원 운행 화면(전체화면)
      </div>

      {/* 짧게 누른 문의의 원문을 작은 창으로 보여줍니다(요청). */}
      {inquiryView && <InquiryPopup view={inquiryView} onClose={() => setInquiryView(null)} />}

      {/* 반을 누르면 일주일 시간표(요청). 토큰으로 서버에서 받아옵니다. */}
      {weekClass && <WeekTimetablePopup token={token} classId={weekClass.id} title={weekClass.name} onClose={() => setWeekClass(null)} />}
    </div>
  );
}

// 학부모 문의 원문 - 작은 창.
function InquiryPopup({
  view,
  onClose,
}: {
  view: { student: string; channel: string | null; raw: string | null; at: string };
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 16, maxWidth: 560, width: "100%", maxHeight: "80vh", overflow: "auto", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
          <b style={{ fontSize: 22, color: "#fff" }}>{view.student}</b>
          <span style={{ fontSize: 13, color: "#64748b" }}>{new Date(view.at).toLocaleString("ko-KR")}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#94a3b8", fontSize: 26, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>
        {view.channel && <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>{view.channel}</div>}
        <div style={{ fontSize: 18, color: "#e2e8f0", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {view.raw || "원문이 저장되어 있지 않습니다."}
        </div>
      </div>
    </div>
  );
}

type WeekGrid = {
  className: string;
  weekdays: string[];
  grid: {
    period: { id: string; label: string; startTime: string; endTime: string };
    days: ({ subject: string; teacher: string | null; room: string | null } | null)[];
  }[];
};

// 반 일주일 시간표 - 팝업.
function WeekTimetablePopup({ token, classId, title, onClose }: { token: string; classId: string; title: string; onClose: () => void }) {
  const [grid, setGrid] = useState<WeekGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/ops-board/${token}/timetable?classId=${encodeURIComponent(classId)}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "불러오지 못했습니다.");
        setGrid(json as WeekGrid);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [token, classId]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 16, maxWidth: 900, width: "100%", maxHeight: "88vh", overflow: "auto", padding: 22 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <b style={{ fontSize: 24, color: "#fff" }}>📅 {title} 시간표</b>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#94a3b8", fontSize: 28, cursor: "pointer", lineHeight: 1 }}>
            ×
          </button>
        </div>

        {err ? (
          <div style={{ color: "#fca5a5", fontSize: 15 }}>{err}</div>
        ) : !grid ? (
          <div style={{ color: "#64748b", fontSize: 15 }}>불러오는 중…</div>
        ) : grid.grid.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 15 }}>등록된 시간표가 없습니다.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ padding: 8, fontSize: 14, color: "#64748b", width: 90 }}>교시</th>
                {grid.weekdays.map((d) => (
                  <th key={d} style={{ padding: 8, fontSize: 16, color: "#93c5fd", fontWeight: 800 }}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.grid.map((row) => (
                <tr key={row.period.id}>
                  <td style={{ padding: 8, textAlign: "center", verticalAlign: "middle", background: "#1e293b", borderRadius: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#cbd5e1" }}>{row.period.label}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>
                      {row.period.startTime}~{row.period.endTime}
                    </div>
                  </td>
                  {row.days.map((cell, i) => (
                    <td key={i} style={{ padding: 4 }}>
                      <div
                        style={{
                          minHeight: 44,
                          background: cell ? "#172033" : "transparent",
                          border: cell ? "1px solid #334155" : "1px dashed #1e293b",
                          borderRadius: 8,
                          padding: "6px 8px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "center",
                        }}
                      >
                        <div style={{ fontSize: 16, fontWeight: 700, color: cell ? "#fff" : "#334155" }}>{cell?.subject ?? "—"}</div>
                        {cell?.room && <div style={{ fontSize: 11, color: "#64748b" }}>{cell.room}</div>}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// grow를 주면 남는 세로 공간을 그 비율만큼 가져가고, 내용이 넘치면 패널 안에서만 스크롤됩니다.
// 패널이 커져서 아래 패널을 화면 밖으로 밀어내는 일이 없어집니다 - 대시보드는 아무도 스크롤하지
// 않기 때문에, 밀려난 정보는 없는 것과 같습니다.
// 하원 시작~다음날 아침에 시간표 자리에 띄우는 학교 정보·학사일정 패널(요청). 밤에는 시간표가
// 쓸모없으므로, 대신 "오늘의 학교 요약"과 이번 달 학사일정 달력을 보여줍니다.
function NightInfoPanel({ sc, data }: { sc: BoardScale; data: BoardData }) {
  const events = data.nightInfo?.events ?? [];
  const reports = data.nightInfo?.reportsThisWeek ?? 0;
  const absent = data.absences.filter((a) => a.status === "결석").length;
  const late = data.absences.filter((a) => a.status === "지각").length;
  const pickupCount = data.pickups.length;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const todayDate = now.getDate();
  const startDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const eventByDay = new Map<number, string>();
  for (const e of events) {
    const d = new Date(e.date + "T00:00:00");
    if (d.getFullYear() === year && d.getMonth() === month) eventByDay.set(d.getDate(), e.name);
  }
  const cells: (number | null)[] = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);
  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];

  const stat = (label: string, value: number | string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "#0c1729", borderRadius: sc.s(10, 6), padding: `${sc.s(8, 5)}px ${sc.s(10, 6)}px`, flex: 1, minWidth: 0 }}>
      <span style={{ fontSize: sc.s(22, 15), fontWeight: 900, color }}>{value}</span>
      <span style={{ fontSize: sc.s(12, 9), color: "#94a3b8", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );

  return (
    <div style={{ background: "#111c33", borderRadius: sc.s(14, 8), padding: sc.s(12, 7), display: "flex", flexDirection: "column", minHeight: 0, flex: "6 1 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(8, 5), flexShrink: 0 }}>
        <h2 style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#e2e8f0", margin: 0 }}>🌙 오늘의 학교 · 학사일정</h2>
        <span style={{ fontSize: sc.s(13, 10), color: "#64748b", marginLeft: "auto" }}>
          {year}년 {month + 1}월
        </span>
      </div>
      <div style={{ minHeight: 0, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column", gap: sc.s(10, 6) }}>
        {/* 오늘 학교 요약 */}
        <div style={{ display: "flex", gap: sc.s(8, 5), flexShrink: 0 }}>
          {stat("재적", data.studentCount, "#e2e8f0")}
          {stat("결석", absent, "#f87171")}
          {stat("지각", late, "#fb923c")}
          {stat("하원 픽업", pickupCount, "#38bdf8")}
          {stat("이번주 리포트", reports, "#34d399")}
        </div>

        {/* 이번 달 학사일정 달력 */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: sc.s(10, 6) }}>
          <div style={{ flex: 3, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2, marginBottom: 2 }}>
              {weekdayLabels.map((w, i) => (
                <div key={w} style={{ textAlign: "center", fontSize: sc.s(11, 9), fontWeight: 700, color: i === 0 ? "#f87171" : i === 6 ? "#60a5fa" : "#64748b" }}>{w}</div>
              ))}
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr", gap: 2 }}>
              {cells.map((d, i) => {
                const isToday = d === todayDate;
                const hasEvent = d != null && eventByDay.has(d);
                return (
                  <div
                    key={i}
                    title={hasEvent ? eventByDay.get(d as number) : undefined}
                    style={{
                      borderRadius: sc.s(7, 5),
                      background: isToday ? "#2563eb" : hasEvent ? "#1e3a5f" : "#0c1729",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      minHeight: 0, padding: 2,
                    }}
                  >
                    {d != null && (
                      <>
                        <span style={{ fontSize: sc.s(13, 10), fontWeight: isToday ? 900 : 600, color: isToday ? "#fff" : hasEvent ? "#bfdbfe" : "#94a3b8" }}>{d}</span>
                        {hasEvent && <span style={{ width: sc.s(5, 4), height: sc.s(5, 4), borderRadius: 999, background: "#38bdf8", marginTop: 1 }} />}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* 다가오는 학사일정 목록 */}
          <div style={{ flex: 2, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: sc.s(4, 3) }}>
            <span style={{ fontSize: sc.s(13, 10), fontWeight: 700, color: "#cbd5e1" }}>다가오는 일정</span>
            {events.length === 0 ? (
              <span style={{ fontSize: sc.s(12, 10), color: "#475569" }}>등록된 학사일정이 없습니다</span>
            ) : (
              events.slice(0, 7).map((e, i) => {
                const d = new Date(e.date + "T00:00:00");
                return (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: sc.s(6, 4), background: "#0c1729", borderRadius: sc.s(7, 5), padding: `${sc.s(4, 3)}px ${sc.s(8, 5)}px` }}>
                    <span style={{ fontSize: sc.s(12, 10), fontWeight: 800, color: "#38bdf8", whiteSpace: "nowrap" }}>{d.getMonth() + 1}/{d.getDate()}</span>
                    <span style={{ fontSize: sc.s(13, 10), color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 오늘 출결 한 칸 - 결석 · 지각/조퇴 · 하원 픽업을 머리표로 나눠 담습니다.
//
// 요청: "결석, 지각, 픽업을 한 탭에서 분류해서 보이게". 예전에는 [오늘 하원 픽업]과
// [오늘 출결]이 화면 아래에 따로 놓여 있어서, 같은 아이가 두 칸에 나뉘어 뜨고 눈이 두 번
// 오갔습니다. 셋 다 "오늘 이 아이가 평소와 다르다"는 같은 종류의 소식이라 한 칸에 모읍니다.
//
// 공용 모니터는 아무도 스크롤하지 않으므로, 탭으로 감춰두지 않고 세 갈래를 한눈에 폅니다.
// 어느 갈래가 비었는지도 정보이기 때문입니다(픽업 0명 = 오늘은 전원 차량 하원).
function AttendancePanel({ sc, data }: { sc: BoardScale; data: BoardData }) {
  const absent = data.absences.filter((a) => a.status === "결석");
  const late = data.absences.filter((a) => a.status !== "결석");
  const groups = [
    { key: "결석", color: "#dc2626", names: absent.map((a) => ({ name: a.name, note: a.note, tag: !a.contacted ? "연락전" : null })) },
    {
      key: "지각·조퇴",
      color: "#d97706",
      names: late.map((a) => ({ name: a.name, note: a.note, tag: a.status === "조퇴" ? "조퇴" : null })),
    },
    { key: "하원 픽업", color: "#0ea5e9", names: data.pickups.map((n) => ({ name: n, note: null, tag: null })) },
  ];
  const total = groups.reduce((s, g) => s + g.names.length, 0);

  return (
    // 높이를 못 박습니다 - 이 칸의 인원은 날마다 달라지는데, 비율로 나눠 가지면 그 변화가
    // 그대로 옆(시간표) 칸 높이를 흔듭니다. 이름 배지 두세 줄이 들어갈 높이면 충분하고,
    // 넘치면 이 칸 안에서만 스크롤됩니다(시간표는 건드리지 않습니다).
    <Panel sc={sc} fixedHeight={sc.s(150, 108)} title="오늘 출결 · 픽업" right={`재적 ${data.studentCount}명`}>
      {total === 0 ? (
        <Empty sc={sc} text="전원 출석 · 픽업 없음" tone="good" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: sc.s(10, 6), height: "100%", minHeight: 0 }}>
          {groups.map((g) => (
            <div key={g.key} style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: sc.s(5, 3), marginBottom: sc.s(6, 4), flexShrink: 0 }}>
                <span style={{ width: sc.s(9, 7), height: sc.s(9, 7), borderRadius: 3, background: g.color }} />
                <span style={{ fontSize: sc.s(14, 11), fontWeight: 800, color: g.color }}>
                  {g.key} {g.names.length}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: sc.s(5, 3),
                  overflowY: "auto",
                  minHeight: 0,
                  alignContent: "flex-start",
                }}
              >
                {g.names.length === 0 ? (
                  <span style={{ fontSize: sc.s(12, 10), color: "#475569" }}>없음</span>
                ) : (
                  g.names.slice(0, 18).map((n, i) => (
                    <span
                      key={i}
                      title={n.note ?? undefined}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: sc.s(4, 3),
                        background: "#1e293b",
                        borderLeft: `4px solid ${g.color}`,
                        borderRadius: 6,
                        padding: `${sc.s(4, 3)}px ${sc.s(8, 5)}px`,
                        fontSize: sc.s(15, 12),
                      }}
                    >
                      <b style={{ color: "#fff" }}>{n.name}</b>
                      {n.tag && (
                        <span style={{ fontSize: sc.s(10, 9), color: n.tag === "조퇴" ? STATUS_COLOR["조퇴"] : "#f59e0b", fontWeight: 700 }}>
                          {n.tag}
                        </span>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({
  title,
  right,
  children,
  sc,
  grow,
  fixedHeight,
}: {
  title: string;
  right?: string | null;
  children: React.ReactNode;
  sc: BoardScale;
  grow?: number;
  /** 높이를 못 박습니다(시간표처럼 내용이 늘어도 칸 크기가 흔들리면 안 되는 위젯용). */
  fixedHeight?: number;
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
        ...(fixedHeight ? { height: fixedHeight, flex: "0 0 auto" } : grow ? { flex: `${grow} 1 0` } : {}),
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
      <div style={{ minHeight: 0, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
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
