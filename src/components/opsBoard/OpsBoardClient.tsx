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
import { createClient } from "@/lib/supabase/client";
import { OPS_REFRESH_CHANNEL, OPS_REFRESH_EVENT } from "@/lib/opsRefresh";

// 요청: "바뀌면 자동으로 새로고침해서 페이지를 수정해줘"
//
// 30초마다 받아오면 교시가 바뀐 뒤 최대 30초 동안 지난 시간표가 걸려 있습니다. 종이 쳤는데
// 화면은 아직 지난 교시를 보여주면, 보는 사람이 화면을 안 믿게 됩니다. 그래서 두 가지를
// 함께 씁니다.
//   - 평소에는 15초마다 받아옵니다.
//   - 교시가 끝나는 시각을 미리 알고 있으므로, 그 순간에 맞춰 한 번 더 받아옵니다.
// 근무 시간(평일 07~20시) 갱신 주기.
//
// 15초에서 30초로 늘렸습니다(요청: "호출량 더 줄여도 괜찮아"). 호출의 98.8%가 이 주기에서
// 나오기 때문에, 야간을 아무리 늘려도 여기를 안 건드리면 전체는 그대로입니다(야간 30분→3시간은
// 전체의 1.1% 절감).
//
// 늘려도 체감이 없는 이유는, 급한 두 가지가 이미 주기와 무관하게 처리되기 때문입니다.
//   · 교시 전환 → 끝나는 시각에 맞춘 별도 타이머가 정확히 그 순간 다시 불러옵니다.
//   · 문의 처리 → 업무 보드에서 체크하는 즉시 방송 신호로 다시 불러옵니다.
// 주기가 실제로 담당하는 것은 "토들에서 새 문의가 들어왔나" 정도인데, 벽에 걸린 화면에서
// 30초는 알아채지 못하는 차이입니다.
const POLL_MS = 30_000;
// 근무 시간이 아닐 때(밤·주말) 폴링 간격.
//
// 요청: "밤과 주말은 아예 멈춰도 되고, 오전 7시부터 오후 8시까지만 체크되면 되고 그 이후에는
// 엄청 띄엄띄엄 갱신해도 괜찮아."
//
// 완전히 멈추지 않고 3시간으로 둔 이유: 아예 멈추면 아침에 스스로 깨어날 방법이 없습니다.
// 이 화면은 벽에 걸린 모니터라 아무도 탭을 다시 누르지 않아서, 타이머가 끊기면 누가 새로고침할
// 때까지 어제 화면이 그대로 남습니다. 3시간에 한 번은 밤새 서너 번이라 없는 것과 같으면서,
// 스스로 아침을 맞을 수 있습니다. useSmartPoll이 "근무 시작 시각을 넘겨서 자지 않도록"
// 잡아주므로, 몇 시간을 자든 07:00 정각에는 반드시 깨어나 그날 첫 화면을 미리 받아둡니다
// (요청: "근무시간 전에만 크롤링해서 가져올 수 있게만 하면 돼").
const IDLE_POLL_MS = 3 * 60 * 60_000;

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
  /** 오늘 픽업. 시각·반이 함께 옵니다 - 그 시각에 교실로 데리러 가야 해서 반이 필요합니다. */
  pickups: {
    name: string;
    time: string | null;
    grade?: string | null;
    className?: string | null;
    classId?: string | null;
    /** 어느 길로 들어온 픽업인가. 「이 아이가 왜 떴지」를 화면에서 바로 답합니다. */
    source?: "체크표" | "출결내역" | "학부모연락";
    /** 명부와 못 이은 건. 조용히 빼지 않고 올리되 확인이 필요하다고 적습니다. */
    unmatched?: boolean;
    /** 평소 하원수단(학원차·보호자하원). 아래 목록에 또 뜨지 않도록 여기로 합쳤습니다. */
    plan?: string | null;
  }[];
  /** 아직 시작하지 않은 등록 건. 시작일이 오면 저절로 오늘 명단으로 넘어갑니다. */
  upcoming?: { name: string; status: string; from: string; to: string; note: string | null }[];
  /** 오늘 요일에 셔틀이 아닌 방법으로 가는 아이들(학원차·보호자·도보). 매주 반복됩니다. */
  dismissalToday?: {
    name: string;
    className: string;
    /** 지금 그 반이 어느 교실에서 무슨 수업 중인지 찾는 열쇠. */
    classId?: string | null;
    kind: string;
    label: string | null;
    time: string | null;
    note: string | null;
  }[];
  /** 교실 태블릿에서 온 특이사항·문의. 읽으면 그 시각이 교실 화면에 그대로 뜹니다. */
  classroomNotes?: {
    id: string;
    className: string;
    kind: string;
    studentName: string | null;
    body: string;
    urgent: boolean;
    at: string;
    readAt: string | null;
    reply: string | null;
  }[];
  inquiries: { id: string; student: string; type: string | null; typeGuessed?: boolean; summary: string; urgent: boolean; at: string; replied?: boolean }[];
  /** 아직 사람이 한 번 봐야 하는 픽업 요청(확인대기). 비어 있는 것이 정상입니다. */
  pendingInbox?: { name: string; date: string | null; time: string | null; today: boolean }[];
  collector: { lastSeen: string | null; status: string | null; stale: boolean } | null;
  taskSummary: {
    statusCounts: Record<string, number>;
    todayTasks: { title: string; status: string; department: string | null; dueLabel: string | null; urgent: boolean; kind: string }[];
    todayTotal: number;
  };
  shuttle: { mode: boolean; boardToken: string | null; switchLabel: string; endLabel: string };
};

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 출결·픽업 칸에 쓸 짧은 이름(요청: "칸이 작으니 마야 같은 경우 이름 전체 말고 Maya만").
//
// 이 칸은 화면의 작은 한 조각인데 'Maya Rodriguez Kim' 같은 이름이 들어오면 배지 하나가
// 줄을 통째로 먹고, 정작 몇 명인지가 안 보입니다. 누구인지 알아보는 데는 첫 이름이면
// 충분하고(같은 반에 같은 이름이 겹치는 일은 드뭅니다), 전체 이름은 마우스를 올리면 뜹니다.
// 한글 이름은 원래 붙여 쓰므로 그대로 둡니다.
function shortName(name: string): string {
  const trimmed = name.trim();
  if (/[가-힣]/.test(trimmed)) return trimmed; // 한글 이름은 이미 짧습니다
  return trimmed.split(/\s+/)[0] || trimmed;
}

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
  // 알람은 분 단위로 판단합니다. 서버 갱신(15초)을 기다리면 «5분 전»이 4분 전이 되기도 합니다.
  const nowMinutes = (() => {
    const m = (clock ?? "").match(/^(\d{2}):(\d{2})/);
    if (!m) return -1; // 시계가 아직 안 돌았으면 아무것도 알리지 않습니다
    return Number(m[1]) * 60 + Number(m[2]);
  })();
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

  // 사람이 직접 켠 하원 화면.
  //
  // 담당자: "4시에 바뀌는 하원차량 화면 평상시에도 전환은 할 수 있게 해줘. 대신 전환했을 때
  //          하원시간이 아니라면 하원시간 아니라고 표시해주고."
  //
  // 시각에만 맡기면 미리 확인하거나 늦게 다시 볼 방법이 없습니다. 다만 켰다는 사실이
  // 안 보이면 "왜 낮인데 하원 화면이지?" 하고 헷갈리므로, 시간 밖일 때는 화면이 그렇다고
  // 말합니다.
  const [forcedShuttle, setForcedShuttle] = useState(false);
  const shuttleMode = !!data && ((data.shuttle.mode && endedOn !== data.today) || forcedShuttle);
  // 지금이 실제 하원 시간대인지(자동 전환 조건). 수동으로 켠 경우 이 값이 false입니다.
  const inShuttleWindow = !!data?.shuttle.mode;

  // 요청: "전체화면 안해도 될거같아 지금 업무대시보드를 전체화면으로 계속 띄울거라서" - 앱이
  // 스스로 전체화면을 강제하거나 안내창을 띄우지 않습니다. 담당자가 브라우저를 이미 전체화면으로
  // 띄워두므로, 여기서는 아무것도 하지 않습니다. (원하면 상단의 전체화면 버튼으로 직접 전환 가능)
  useEffect(() => {
    autoTriedRef.current = false;
    setNeedsManualFullscreen(false);
  }, [shuttleMode]);

  function endDismissal() {
    // 수동으로 켠 것을 끄는 경우에는 '오늘 종료' 기록을 남기지 않습니다. 남기면 정작
    // 4시에 자동으로 떠야 할 화면이 안 뜹니다.
    if (forcedShuttle && !inShuttleWindow) {
      setForcedShuttle(false);
      return;
    }
    setForcedShuttle(false);
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
      // cache: "no-store"가 없으면 브라우저·CDN이 같은 주소의 지난 응답을 그대로 다시 내줍니다.
      // 이 화면은 주소가 늘 똑같아서(토큰 하나) 캐시가 붙기 딱 좋은 조건이었고, 그래서 업무
      // 보드에서 학부모 문의를 처리 완료로 체크해도 대시보드에는 계속 남아 있었습니다
      // (요청: "업무보드에서 학부모문의 체크표시로 지웠는데 대시보드에 반영이 안돼").
      // 15초마다 새로 물어보는 화면이니 캐시는 도움이 되지 않고 방해만 됩니다.
      const res = await fetch(`/api/ops-board/${token}${qs}`, { cache: "no-store" });
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
  // 빠른 주기를 쓰는 시간대를 학교가 돌아가는 내내(평일 07~20시)로 넓혔습니다.
  //
  // 예전에는 하원 시간대(14~19시)에만 15초였고 그 밖에는 120초였습니다. 서버 호출을 줄이려고
  // 넣은 값인데, 이 화면은 사무실 벽에 하루 종일 띄워두고 계속 쳐다보는 모니터입니다. 오전에
  // 업무 보드에서 문의를 처리해도 대시보드에서 2분이 지나야 사라지니 "반영이 안 된다"고
  // 느껴질 수밖에 없었습니다(요청). 사람이 없는 밤·주말에만 느리게 돌면 충분합니다.
  useSmartPoll(load, { activeMs: POLL_MS, idleMs: IDLE_POLL_MS, activeFromHour: 7, activeToHour: 20 });

  // 즉시 반영 - 업무 보드에서 문의를 처리하면 그 순간 이 화면도 다시 불러옵니다.
  //
  // 폴링만으로는 아무리 촘촘해도 최대 한 주기(15초)만큼 늦습니다. 처리한 문의가 화면에 남아
  // 있는 동안 다른 사람이 또 처리하려 들 수 있어서, 이런 화면은 "곧" 말고 "즉시"여야 합니다.
  // 표를 직접 구독하지 않고 방송(broadcast)을 쓰는 이유: 이 화면은 로그인 없이 토큰으로만
  // 열리는데, pickup_requests 표 구독은 로그인 사용자(is_giamicro_user)에게만 허용되어 있어
  // 아무 소식도 받지 못합니다. 방송은 표 권한과 무관한 단순 신호라 이 화면에서도 받습니다.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(OPS_REFRESH_CHANNEL)
      .on("broadcast", { event: OPS_REFRESH_EVENT }, () => void load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
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
          offHoursLabel={inShuttleWindow ? null : `지금은 하원 시간이 아닙니다 · 하원 ${data.shuttle.switchLabel}~${data.shuttle.endLabel}`}
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
        {/* 하원 시간이 아니어도 미리 열어볼 수 있게(요청). 열면 화면 위에 "지금은 하원
            시간이 아닙니다"가 뜹니다 - 켰다는 사실이 안 보이면 지나가는 사람이 헷갈립니다. */}
        {!data.shuttle.mode && (
          <button
            onClick={() => setForcedShuttle(true)}
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
            🚌 하원 화면 미리 보기
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

      {/* 픽업 알람 - 두 칸 위. 시각이 5분 앞으로 다가온 것만 뜨고, 없으면 자리를 안 먹습니다. */}
      <PickupAlarm sc={sc} data={data} nowMin={nowMinutes} />

      {/* 교실에서 온 것. 안 읽은 것이 있을 때만 뜹니다. */}
      <ClassroomNotes
        sc={sc}
        items={data.classroomNotes ?? []}
        onAct={async (id, patch) => {
          // 화면에서 먼저 반영합니다 - 벽에 걸린 화면에서 한 박자 늦으면 두 번 누릅니다.
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  classroomNotes: (prev.classroomNotes ?? [])
                    .map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString(), reply: patch.reply ?? n.reply } : n))
                    .filter((n) => !(n.id === id && patch.done)),
                }
              : prev
          );
          try {
            await fetch(`/api/ops-board/${token}/classroom`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, ...patch }),
            });
          } catch {
            load(); // 실패하면 되돌립니다(다음 갱신에서 다시 나타납니다).
          }
        }}
      />

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
                              {/* 특수교실은 «교실 밖»이 아니라 부르는 이름 그대로 보여줍니다.
                                  셋뿐이고 이미 이름이 있는데 감춰두면 사람이 한 번 더 물어봅니다. */}
                              {place.special ? place.room : c.room || "교실"}
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

        {/* ② 아직 손 안 댄 인박스. 시간표 아래 한 줄만 씁니다 -
            평소에는 «비었습니다» 한 줄로 접혀 자리를 거의 안 먹고, 밀린 날에만 커집니다. */}
        <PendingInbox sc={sc} items={data.pendingInbox ?? []} />
        </div>

        {/* ── 오른쪽: 오늘 변동사항 + 학부모 문의 ───────────────────────────────
            한 칸 안에서 구분선으로만 위아래를 가릅니다. 상자를 두 개로 나누면 테두리·여백이
            두 겹이 되어, 멀리서 보는 화면에서 정작 글자에 쓸 자리가 줄어듭니다.

            위 = 오늘 이 아이가 평소와 다른 것. 픽업은 **몇 시인지가 먼저**입니다 - 행정실이
            그 시각에 맞춰 교실에서 아이를 데려와야 하므로, 이름만으로는 움직일 수 없습니다.
            결석·지각은 그 시각에 할 일이 없으므로 작은 배지로만 둡니다.
            아래 = 아직 답하지 않은 학부모 문의. */}
        <Panel
          sc={sc}
          title="오늘 변동사항"
          right={`재적 ${data.studentCount}명`}
        >
          {/* ── 위: 오늘 변동사항 ─────────────────────────────────────────── */}
          <TodayChanges sc={sc} data={data} />

          {/* 구분선 하나. 칸을 나누지 않고 선만 긋습니다. */}
          <div style={{ height: 1, background: "#1e2a44", flexShrink: 0, margin: `${sc.s(10, 6)}px 0` }} />

          {/* ── 아래: 학부모 문의 ─────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(7, 4), flexShrink: 0 }}>
            <span style={{ fontSize: sc.s(19, 13), fontWeight: 800, color: "#e2e8f0" }}>
              학부모 문의 {data.inquiries?.length ?? 0}건
            </span>
            <span style={{ fontSize: sc.s(13, 10), color: "#64748b", marginLeft: "auto", textAlign: "right" }}>
              {/* 수집기가 멈추면 문의가 안 들어옵니다. 그런데 화면은 "문의 없음"으로 똑같이
                  보여서, 조용히 아무것도 안 하면서 정상인 척하게 됩니다. 그래서 여기 적습니다. */}
              {data.collector?.stale
                ? "⚠ 토들 수집기 멈춤"
                : urgentInquiries > 0
                ? `급한 것 ${urgentInquiries}건`
                : data.collector?.lastSeen
                ? `수집 ${new Date(data.collector.lastSeen).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
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
              /* 한 줄에 두 건씩. 「마야-출석」처럼 누구의 무슨 이야기인지가 한 덩어리로 읽히면
                 이름과 분류를 따로 눈으로 잇지 않아도 되고, 그만큼 한 화면에 두 배가 들어갑니다. */
              <InquiryBoard
                items={data.inquiries}
                s={sc.s}
                dense
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
          </div>
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

// 교실에서 온 것 - 특이사항·문의.
//
// 행정실이 실제로 보고 있는 화면이 이것이라 여기 띄웁니다. 다른 화면에 로그인해야 처리할 수
// 있다면 그 한 단계 때문에 «나중에»가 되고, 선생님 화면에는 영영 «보냄»으로 남습니다.
//
// **반 이름이 가장 큽니다.** 행정실이 먼저 아는 것은 «무슨 일»이 아니라 «어느 교실»입니다 -
// 그리로 가야 하니까요. 반 이름은 이미 영문 코드(G2C·G3JU)라 한국인·외국인 직원이 같은
// 글자를 읽습니다.
//
// 누르면 그 순간 교실 화면에 «읽음 15:32»가 뜹니다. 보냈다와 받았다를 잇는 유일한 자리입니다.
const QUICK_REPLY = ["확인했습니다", "곧 가겠습니다", "학부모에 연락합니다", "잠시만 기다려주세요"];

function ClassroomNotes({
  sc,
  items,
  onAct,
}: {
  sc: BoardScale;
  items: NonNullable<BoardData["classroomNotes"]>;
  onAct: (id: string, patch: { reply?: string; done?: boolean }) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (items.length === 0) return null;
  const unread = items.filter((n) => !n.readAt);

  return (
    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: sc.s(6, 4) }}>
      {items.slice(0, 4).map((n) => {
        const isOpen = open === n.id;
        return (
          <div
            key={n.id}
            style={{
              background: n.readAt ? "#132033" : n.urgent ? "#3b1414" : "#13253a",
              border: `2px solid ${n.readAt ? "#1e293b" : n.urgent ? "#ef4444" : "#0ea5e9"}`,
              borderRadius: sc.s(12, 7),
              padding: `${sc.s(9, 6)}px ${sc.s(14, 9)}px`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: `${sc.s(5, 3)}px ${sc.s(14, 9)}px` }}>
              {/* 어느 교실인가 - 가장 크게. */}
              <span
                style={{
                  fontSize: sc.s(30, 20),
                  fontWeight: 900,
                  color: n.readAt ? "#94a3b8" : "#fff",
                  background: n.readAt ? "transparent" : n.urgent ? "#7f1d1d" : "#0c4a6e",
                  borderRadius: sc.s(8, 5),
                  padding: n.readAt ? 0 : `${sc.s(2, 1)}px ${sc.s(10, 6)}px`,
                  letterSpacing: 0.5,
                }}
              >
                {n.className}
              </span>
              <span style={{ fontSize: sc.s(16, 12), fontWeight: 800, color: n.urgent ? "#fca5a5" : "#7dd3fc" }}>
                {n.urgent ? "🔴 급함" : n.kind === "문의" ? "❓ 문의" : "🩹 특이사항"}
              </span>
              {n.studentName && <b style={{ fontSize: sc.s(22, 15), color: "#fff" }}>{n.studentName}</b>}
              <span style={{ fontSize: sc.s(20, 14), color: "#e2e8f0" }}>{n.body}</span>
              <span style={{ fontSize: sc.s(14, 11), color: "#64748b", marginLeft: "auto" }}>
                {new Date(n.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                {n.readAt ? " · 읽음" : ""}
              </span>
            </div>

            {n.reply && <p style={{ margin: `${sc.s(4, 2)}px 0 0`, fontSize: sc.s(16, 12), color: "#7dd3fc" }}>↩ {n.reply}</p>}

            <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), marginTop: sc.s(7, 5) }}>
              {!n.readAt && (
                <button type="button" onClick={() => onAct(n.id, {})} style={btn(sc, "#0284c7")}>
                  읽음
                </button>
              )}
              <button type="button" onClick={() => setOpen(isOpen ? null : n.id)} style={btn(sc, "#334155")}>
                답 보내기
              </button>
              <button type="button" onClick={() => onAct(n.id, { done: true })} style={btn(sc, "#166534")}>
                처리 완료
              </button>
            </div>

            {isOpen && (
              /* 벽에 걸린 화면에서 길게 치기 어려워 버튼으로 답합니다. 짧아도 «받았다»가
                 교실에 전해지는 것이 요점입니다. */
              <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(6, 4), marginTop: sc.s(6, 4) }}>
                {QUICK_REPLY.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      onAct(n.id, { reply: r });
                      setOpen(null);
                    }}
                    style={btn(sc, "#1e3a5f")}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {items.length > 4 && (
        <p style={{ margin: 0, fontSize: sc.s(14, 11), color: "#64748b" }}>
          외 {items.length - 4}건 (안 읽은 것 {unread.length}건)
        </p>
      )}
    </div>
  );
}

function btn(sc: BoardScale, bg: string): React.CSSProperties {
  return {
    borderRadius: 999,
    border: "none",
    background: bg,
    color: "#fff",
    fontSize: sc.s(16, 12),
    fontWeight: 800,
    padding: `${sc.s(8, 5)}px ${sc.s(18, 11)}px`,
    cursor: "pointer",
  };
}

// 픽업 알람.
//
// 시각이 적힌 픽업은 그 시각에 **행정실이 교실로 데리러 갑니다.** 그런데 목록에 적혀 있는
// 것만으로는 아무도 시계를 보지 않습니다 - 15:40 이 지나서야 «아 맞다»가 됩니다.
// 5분 전에 화면 맨 위를 크게 차지하게 해서, 지나가다 보이면 바로 움직일 수 있게 합니다.
//
// 이름만으로는 못 움직입니다. 어느 반이 지금 어느 교실에서 무슨 수업 중인지가 있어야
// 곧장 그리로 갑니다. 그래서 시간표에서 그 반의 지금 수업을 찾아 함께 적습니다.
//
// 시각이 지나도 10분은 남깁니다 - 5분 전에 자리를 비웠던 사람도 봐야 하고, 지난 일이라고
// 사라지면 «놓쳤다»는 사실 자체가 화면에서 없어집니다.
const ALERT_LEAD_MIN = 5;
const ALERT_KEEP_MIN = 10;

/**
 * 팝업이 화면을 덮고 있는 시간(초).
 *
 * **20초로 정했습니다.** 두 가지를 저울질한 값입니다.
 *
 *   · 10초 — 자리를 잠깐 비웠다 돌아오면 놓칩니다. 소리 없이 팝업만 뜨므로 눈으로
 *     지나치면 그대로 끝입니다.
 *   · 30초 이상 — 그동안 시간표와 오늘 변동사항을 못 봅니다. 이 화면은 하루 종일 켜져
 *     있으므로, 가리는 시간이 길면 팝업 자체가 방해물이 됩니다.
 *
 * 20초면 복도 끝에서 보고 걸어와 읽을 수 있고, 화면을 오래 막지 않습니다.
 *
 * 그리고 **팝업이 사라져도 위쪽 알림 띠는 남습니다.** 놓쳐도 정보가 사라지지 않는 것이
 * 이 설계의 요점입니다 - 팝업은 「지금 봐라」이고, 띠는 「아직 안 끝났다」입니다.
 */
const POPUP_SEC = 20;

/**
 * 화면 위쪽에 뜨는 노란 쪽지.
 *
 * 예전에는 화면을 통째로 덮는 큰 팝업이었습니다. 하원 시각은 몰려 있어서 20초 안에 다른
 * 아이가 또 걸리는데, 그때마다 새 팝업이 뜨면 앞의 아이가 지워지고 화면이 깜빡였습니다.
 * 그리고 팝업이 떠 있는 동안에는 시간표도 오늘 변동사항도 못 봅니다.
 *
 * 그래서 **덮지 않고 위쪽에 얹습니다.** 아이가 늘면 쪽지에 줄만 늘어나고, 아이마다 자기
 * 20초를 따로 세다가 다 센 줄부터 하나씩 빠집니다.
 */
function PickupToast({
  items,
  onClose,
}: {
  items: {
    name: string;
    time: string | null;
    grade?: string | null;
    className?: string | null;
    left: number;
    lesson: { subjectName: string; room?: string | null } | null;
    room: string | null;
    until: number;
  }[];
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        maxWidth: "min(92vw, 760px)",
      }}
    >
      <div
        onClick={onClose}
        style={{
          borderRadius: 18,
          border: "3px solid #f59e0b",
          background: "#fef3c7",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          padding: "12px 18px",
          cursor: "pointer",
        }}
        title="누르면 닫힙니다"
      >
        <div style={{ fontSize: 16, fontWeight: 900, color: "#92400e", marginBottom: 6 }}>
          🔔 곧 하원{items.length > 1 ? ` · ${items.length}명` : ""}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((p, i) => {
            const where = p.lesson
              ? `${p.lesson.subjectName}${p.lesson.room ? ` · ${p.lesson.room}` : p.room ? ` · ${p.room}` : ""}`
              : p.room
                ? `교실 ${p.room}`
                : "지금 수업 없음";
            return (
              <div key={i} style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "2px 10px" }}>
                <b style={{ fontSize: 24, fontWeight: 900, color: "#b45309", fontVariantNumeric: "tabular-nums" }}>
                  {p.time ?? "시각 미정"}
                </b>
                {/* 이름 - 이 쪽지에서 가장 큰 글자. */}
                <b style={{ fontSize: 30, fontWeight: 900, color: "#111827", lineHeight: 1.1 }}>{p.name}</b>
                <span style={{ fontSize: 16, fontWeight: 700, color: "#78350f" }}>
                  {[p.grade ? `${p.grade}학년` : null, p.className].filter(Boolean).join(" ") || "반 미확인"}
                </span>
                {/* 어디로 가야 하는가. 이름만 알면 못 움직입니다. */}
                <span style={{ fontSize: 18, fontWeight: 900, color: "#a16207" }}>📍 {where}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>
                  {p.left > 0 ? `${p.left}분 뒤` : "지금"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PickupAlarm({ sc, data, nowMin }: { sc: BoardScale; data: BoardData; nowMin: number }) {
  // 「시각이 정해진 하원」은 학부모 연락뿐이 아닙니다. 매주 같은 요일 14:40 에 학원차가
  // 오는 아이도 그 시각에 내려보내야 합니다. 알릴 때를 아는 것은 **시각이 적혀 있는가**
  // 하나뿐이라, 두 갈래를 여기서 한 줄로 세웁니다.
  const timed = [
    ...data.pickups,
    ...(data.dismissalToday ?? []).map((d) => ({
      name: d.name,
      time: d.time,
      grade: null as string | null,
      className: d.className,
      classId: d.classId ?? null,
      source: undefined,
      unmatched: false,
      plan: [d.kind, d.label].filter(Boolean).join(" · "),
    })),
  ];

  const due = timed
    .map((p) => {
      const m = (p.time ?? "").match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null; // 시각을 모르면 알릴 때도 모릅니다
      const at = Number(m[1]) * 60 + Number(m[2]);
      const left = at - nowMin;
      if (left > ALERT_LEAD_MIN || left < -ALERT_KEEP_MIN) return null;
      const cls = data.grades.flatMap((g) => g.classes).find((c) => c.id === p.classId);
      return { ...p, at, left, lesson: cls?.current ?? null, room: cls?.room ?? null };
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.at - b.at);

  // ── 팝업: 창을 넘은 그 순간 한 번 ──────────────────────────────────────
  //
  // 띠는 「아직 안 끝났다」를 계속 보여주고, 팝업은 「지금 봐라」를 한 번만 말합니다. 둘을
  // 같은 것으로 만들면 - 계속 뜨는 팝업 - 사람이 화면을 덮어버리거나 아예 안 봅니다.
  //
  // 한 아이당 하루 한 번. 새로고침해도 다시 뜨지 않게 브라우저에 남깁니다(대시보드는
  // 스스로 새로고침합니다).
  const [stack, setStack] = useState<((typeof due)[number] & { until: number })[]>([]);
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => {
    // 아직 시각이 안 지난 건만 팝업으로 띄웁니다. 이미 지난 것은 띠로 충분합니다 -
    // 화면을 켜자마자 지난 알림이 팝업으로 쏟아지면 안 됩니다.
    const fresh = due.filter((p) => p.left >= 0 && !shown.current.has(`${p.name}|${p.time}`));
    if (fresh.length === 0) return;
    for (const f of fresh) shown.current.add(`${f.name}|${f.time}`);
    const until = Date.now() + POPUP_SEC * 1000;
    setStack((prev) => [...prev, ...fresh.map((f) => ({ ...f, until }))]);
  }, [due]);

  // 다 센 줄부터 하나씩 뺍니다. 통째로 지우면 방금 올라온 아이까지 같이 사라집니다.
  useEffect(() => {
    if (stack.length === 0) return;
    const t = setInterval(() => setStack((prev) => prev.filter((x) => x.until > Date.now())), 500);
    return () => clearInterval(t);
  }, [stack.length]);

  if (due.length === 0 && stack.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: sc.s(6, 4), flexShrink: 0 }}>
      {stack.length > 0 && <PickupToast items={stack} onClose={() => setStack([])} />}
      {due.map((p, i) => {
        const late = p.left < 0;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: `${sc.s(6, 4)}px ${sc.s(16, 10)}px`,
              background: late ? "#7f1d1d" : "#0c4a6e",
              border: `2px solid ${late ? "#ef4444" : "#38bdf8"}`,
              borderRadius: sc.s(14, 8),
              padding: `${sc.s(10, 6)}px ${sc.s(16, 10)}px`,
              animation: "opsPickupPulse 1.6s ease-in-out infinite",
            }}
          >
            <span style={{ fontSize: sc.s(28, 18), fontWeight: 900, color: late ? "#fecaca" : "#7dd3fc" }}>
              {late ? "🔔 지금" : `🔔 ${p.left}분 뒤`}
            </span>
            <span
              style={{ fontSize: sc.s(34, 22), fontWeight: 900, color: "#fff", fontVariantNumeric: "tabular-nums" }}
            >
              {p.time}
            </span>
            <span style={{ fontSize: sc.s(30, 20), fontWeight: 900, color: "#fff" }}>{p.name}</span>
            <span style={{ fontSize: sc.s(20, 14), fontWeight: 700, color: late ? "#fca5a5" : "#bae6fd" }}>
              {[p.grade ? `${p.grade}학년` : null, p.className].filter(Boolean).join(" ") || "반 미확인"}
            </span>
            {/* 지금 어디 있나. 수업이 없으면 교실 위치라도 적습니다 - 빈손으로 보내지 않습니다. */}
            <span style={{ fontSize: sc.s(20, 14), color: "#e0f2fe", marginLeft: "auto" }}>
              {p.lesson
                ? `지금 ${p.lesson.subjectName}${p.lesson.room ? ` · ${p.lesson.room}` : p.room ? ` · ${p.room}` : ""}`
                : p.room
                ? `교실 ${p.room}`
                : "지금 수업 없음"}
            </span>
          </div>
        );
      })}
      <style>{"@keyframes opsPickupPulse{0%,100%{opacity:1}50%{opacity:.72}}"}</style>
    </div>
  );
}

// 「9/21~23」처럼 짧게. 하루짜리면 한 번만 적습니다 - 「9/21~9/21」은 읽는 데 방해만 됩니다.
function dayRange(from: string, to: string): string {
  const short = (d: string) => d.slice(5).replace("-", "/");
  return from === to ? short(from) : `${short(from)}~${short(to)}`;
}

// 아직 손 안 댄 인박스.
//
// 픽업 요청은 «확인대기»로 들어와서, 사람이 인박스에서 눌러야 하원 체크표로 넘어갑니다.
// 안 누르면 아무 일도 일어나지 않습니다 - 오류도 안 뜨고 화면도 평소와 같고, 그대로 하원
// 시각이 옵니다. 그래서 «없음»을 조용히 넘기지 않고 **비었다는 사실도 화면에 적습니다**.
// 비었을 때 아무것도 안 그리면, 위젯이 고장 나서 안 뜨는 것과 구별되지 않습니다.
function PendingInbox({ sc, items }: { sc: BoardScale; items: { name: string; date: string | null; time: string | null; today: boolean }[] }) {
  const todayItems = items.filter((i) => i.today);
  const later = items.filter((i) => !i.today);

  if (items.length === 0) {
    return (
      <div
        style={{
          background: "#0f1f1a",
          border: "1px solid #14532d",
          borderRadius: sc.s(12, 7),
          padding: `${sc.s(7, 5)}px ${sc.s(12, 7)}px`,
          fontSize: sc.s(14, 11),
          color: "#4ade80",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        ✓ 인박스 비었습니다 — 확인할 픽업 요청 없음
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#2a1a0c",
        border: `1px solid ${todayItems.length > 0 ? "#b45309" : "#78350f"}`,
        borderRadius: sc.s(12, 7),
        padding: sc.s(10, 6),
        flexShrink: 0,
        maxHeight: sc.s(112, 82),
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(8, 5), marginBottom: sc.s(6, 4) }}>
        <span style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#fbbf24" }}>⚠ 확인 필요 {items.length}건</span>
        <span style={{ fontSize: sc.s(12, 10), color: "#a16207" }}>
          {todayItems.length > 0 ? `오늘 ${todayItems.length}건` : "오늘 것은 없음"}
        </span>
        <span style={{ fontSize: sc.s(12, 10), color: "#a16207", marginLeft: "auto" }}>[픽업 인박스]에서 확인해주세요</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
        {items.slice(0, 10).map((it, i) => (
          <span
            key={i}
            title={[it.name, it.date ?? "날짜 미정", it.time].filter(Boolean).join(" · ")}
            style={{
              display: "inline-flex",
              alignItems: "baseline",
              gap: sc.s(5, 3),
              background: it.today ? "#422006" : "#1c1508",
              borderRadius: 6,
              padding: `${sc.s(3, 2)}px ${sc.s(8, 5)}px`,
              fontSize: sc.s(16, 12),
              whiteSpace: "nowrap",
            }}
          >
            <b style={{ color: it.today ? "#fde68a" : "#a8a29e" }}>{shortName(it.name)}</b>
            <span style={{ fontSize: sc.s(14, 10), color: "#a16207" }}>
              {/* 오늘 것은 시각만, 앞날 것은 날짜(월-일)만. 오늘 화면에서 «내일 건»이
                  오늘 것처럼 읽히면 사람이 헛걸음합니다. */}
              {it.today ? (it.time ?? "시각 미정") : it.date ? it.date.slice(5).replace("-", "/") : "날짜 미정"}
            </span>
          </span>
        ))}
        {items.length > 10 && (
          <span style={{ fontSize: sc.s(12, 10), color: "#a16207", alignSelf: "center" }}>외 {items.length - 10}건</span>
        )}
      </div>
      {later.length > 0 && todayItems.length === 0 && (
        <p style={{ margin: `${sc.s(5, 3)}px 0 0`, fontSize: sc.s(11, 9), color: "#78716c" }}>
          모두 앞날 요청입니다 — 오늘 안에 처리하지 않아도 되지만, 미뤄두면 그날 아침에 몰립니다.
        </p>
      )}
    </div>
  );
}

// 오늘 변동사항 - 픽업(시각이 주인공) + 결석·지각(작은 배지).
//
// 예전에는 결석·지각·픽업을 같은 크기로 셋에 나눠 담았습니다. 그런데 이 셋은 화면 앞에 선
// 사람이 해야 할 일이 다릅니다. 픽업은 **정해진 시각에 교실에서 아이를 데려와야** 하므로
// 시각이 없으면 움직일 수 없고, 결석·지각은 이미 지난 일이라 "그런 아이가 있다"만 알면
// 됩니다. 그래서 픽업만 크게 시각 순으로 세우고, 나머지는 배지로 줄였습니다.
//
// 시각이 안 적힌 픽업은 빼지 않고 "시각 미정"으로 남깁니다 - 연락은 왔는데 시각만 모르는
// 것이고, 그건 오히려 물어봐야 할 건입니다.
function TodayChanges({ sc, data }: { sc: BoardScale; data: BoardData }) {
  const absent = data.absences.filter((a) => a.status === "결석");
  const late = data.absences.filter((a) => a.status !== "결석");
  const pickups = data.pickups;
  const upcoming = data.upcoming ?? [];
  const dismissal = data.dismissalToday ?? [];

  return (
    <div style={{ flexShrink: 0, minHeight: 0 }}>
      {/* 예정된 변동사항 - 맨 위.
          「이연우 9/21~23 결석」처럼 미리 알려온 건은 등록만 되어 있고 그날이 와야 화면에
          떴습니다. 그때까지는 아무 데도 안 보여서 정작 그날 아침에 «몰랐다»가 됩니다.
          위에 세워두면 며칠 전부터 모두가 눈에 담습니다.

          지우는 일은 사람이 하지 않습니다 - 시작일이 되면 아래 오늘 명단으로 넘어가고
          여기서는 저절로 빠집니다. 사람이 지워야 하는 목록은 언젠가 안 지워집니다. */}
      {upcoming.length > 0 && (
        <div
          style={{
            background: "#1a1330",
            border: "1px solid #4c1d95",
            borderRadius: sc.s(10, 6),
            padding: sc.s(8, 5),
            marginBottom: sc.s(9, 6),
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(5, 3) }}>
            <span style={{ fontSize: sc.s(17, 12), fontWeight: 800, color: "#c4b5fd" }}>📌 예정 {upcoming.length}건</span>
            <span style={{ fontSize: sc.s(13, 10), color: "#7c6ba8" }}>미리 알려온 건 · 그날이 되면 아래로 내려옵니다</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
            {upcoming.slice(0, 8).map((u, i) => (
              <span
                key={i}
                title={[u.name, u.status, `${u.from}~${u.to}`, u.note].filter(Boolean).join(" · ")}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sc.s(5, 3),
                  background: "#2a1f4d",
                  borderRadius: 6,
                  padding: `${sc.s(3, 2)}px ${sc.s(8, 5)}px`,
                  fontSize: sc.s(17, 12),
                  whiteSpace: "nowrap",
                }}
              >
                <b style={{ color: "#ddd6fe" }}>{shortName(u.name)}</b>
                <span style={{ color: "#a78bfa", fontWeight: 700 }}>{u.status}</span>
                <span style={{ fontSize: sc.s(15, 11), color: "#8b7bb8" }}>{dayRange(u.from, u.to)}</span>
              </span>
            ))}
            {upcoming.length > 8 && (
              <span style={{ fontSize: sc.s(14, 11), color: "#7c6ba8", alignSelf: "center" }}>외 {upcoming.length - 8}건</span>
            )}
          </div>
        </div>
      )}

      {/* 픽업 - 시각이 먼저, 이름이 뒤. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(6, 4) }}>
        <span style={{ width: sc.s(9, 7), height: sc.s(9, 7), borderRadius: 3, background: "#0ea5e9" }} />
        <span style={{ fontSize: sc.s(18, 13), fontWeight: 800, color: "#38bdf8" }}>하원 픽업 {pickups.length}</span>
      </div>

      {pickups.length === 0 ? (
        <p style={{ margin: 0, fontSize: sc.s(16, 12), color: "#475569" }}>오늘은 전원 차량 하원</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${sc.s(180, 122)}px, 1fr))`,
            gap: sc.s(6, 4),
            maxHeight: sc.s(196, 132),
            overflow: "hidden",
          }}
        >
          {pickups.slice(0, 10).map((p, i) => (
            <div
              key={i}
              title={p.name}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: sc.s(7, 4),
                background: "#0c2233",
                borderLeft: `${sc.s(5, 3)}px solid #0ea5e9`,
                borderRadius: sc.s(8, 5),
                padding: `${sc.s(6, 4)}px ${sc.s(9, 6)}px`,
                minWidth: 0,
              }}
            >
              <b
                style={{
                  fontSize: p.time ? sc.s(31, 20) : sc.s(17, 12),
                  fontWeight: 900,
                  color: p.time ? "#7dd3fc" : "#64748b",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {p.time ?? "시각 미정"}
              </b>
              <span
                style={{
                  fontSize: sc.s(21, 14),
                  fontWeight: 700,
                  color: "#fff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {shortName(p.name)}
              </span>
              {/* 명부와 못 이은 건. 조용히 빼면 아무도 데리러 가지 않으므로 올리되,
                  「확인해야 하는 줄」이라고 눈에 띄게 적습니다. */}
              {p.unmatched && (
                <span
                  style={{
                    fontSize: sc.s(12, 9),
                    fontWeight: 800,
                    color: "#fca5a5",
                    whiteSpace: "nowrap",
                  }}
                  title="학부모 연락은 왔는데 명부의 어느 학생인지 아직 잇지 못했습니다. 픽업 인박스에서 학생을 골라주세요."
                >
                  학생 미연결
                </span>
              )}
              {/* 평소 하원수단. 아래 「학원차·보호자 하원」에 같은 아이가 또 뜨면 몇 명을
                  데려와야 하는지 셀 수 없어, 그 줄을 여기로 합쳤습니다. */}
              {p.plan && (
                <span
                  style={{
                    fontSize: sc.s(13, 10),
                    fontWeight: 700,
                    color: "#a78bfa",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`평소 하원수단: ${p.plan}`}
                >
                  {p.plan}
                </span>
              )}
            </div>
          ))}
          {pickups.length > 10 && (
            <div style={{ display: "flex", alignItems: "center", fontSize: sc.s(15, 11), color: "#64748b" }}>
              외 {pickups.length - 10}명
            </div>
          )}
        </div>
      )}

      {/* 오늘 학원차·보호자 하원.
          매주 같은 요일에 학원 차를 타는 아이가 있습니다. 셔틀을 안 타니 하원 체크표에 줄이
          없고, 학사일정도 아니라 달력에도 안 뜹니다. **반복되는 일이라 오히려 잊힙니다** -
          «오늘도 있다»고 말해주는 자리가 없으면 어느 주에 그냥 지나갑니다. */}
      {dismissal.length > 0 && (
        <div style={{ marginTop: sc.s(9, 6) }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: sc.s(7, 4), marginBottom: sc.s(5, 3) }}>
            <span style={{ width: sc.s(9, 7), height: sc.s(9, 7), borderRadius: 3, background: "#a3e635" }} />
            <span style={{ fontSize: sc.s(16, 12), fontWeight: 800, color: "#bef264" }}>학원차·보호자 하원 {dismissal.length}</span>
            <span style={{ fontSize: sc.s(12, 10), color: "#65a30d" }}>매주 이 요일</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: sc.s(5, 3) }}>
            {dismissal.slice(0, 10).map((d, i) => (
              <span
                key={i}
                title={[d.name, d.className, d.kind, d.label, d.note].filter(Boolean).join(" · ")}
                style={{
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: sc.s(6, 4),
                  background: "#1a2410",
                  border: "1px solid #3f6212",
                  borderRadius: sc.s(8, 5),
                  padding: `${sc.s(4, 2)}px ${sc.s(9, 6)}px`,
                  fontSize: sc.s(17, 12),
                  whiteSpace: "nowrap",
                }}
              >
                <b style={{ fontSize: sc.s(20, 14), color: "#d9f99d", fontVariantNumeric: "tabular-nums" }}>
                  {d.time ?? "시각 미정"}
                </b>
                <b style={{ color: "#fff" }}>{shortName(d.name)}</b>
                <span style={{ fontSize: sc.s(15, 11), color: "#a3e635" }}>{d.label || d.kind}</span>
              </span>
            ))}
            {dismissal.length > 10 && (
              <span style={{ fontSize: sc.s(15, 11), color: "#65a30d", alignSelf: "center" }}>외 {dismissal.length - 10}명</span>
            )}
          </div>
        </div>
      )}

      {/* 결석·지각 - 배지로만. 여기 있는 아이 때문에 지금 할 일은 없습니다. */}
      {(absent.length > 0 || late.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: sc.s(5, 3), marginTop: sc.s(8, 5) }}>
          {absent.length > 0 && (
            <span style={{ fontSize: sc.s(15, 11), fontWeight: 800, color: "#f87171" }}>결석 {absent.length}</span>
          )}
          {absent.map((a, i) => (
            <span
              key={`a${i}`}
              title={[a.name, a.note].filter(Boolean).join(" · ")}
              style={{
                background: "#2a1414",
                border: "1px solid #7f1d1d",
                borderRadius: 999,
                padding: `${sc.s(2, 1)}px ${sc.s(8, 5)}px`,
                fontSize: sc.s(16, 12),
                color: "#fecaca",
                whiteSpace: "nowrap",
              }}
            >
              {shortName(a.name)}
            </span>
          ))}
          {late.length > 0 && (
            <span style={{ fontSize: sc.s(15, 11), fontWeight: 800, color: "#fbbf24", marginLeft: sc.s(6, 4) }}>
              지각·조퇴 {late.length}
            </span>
          )}
          {late.map((a, i) => (
            <span
              key={`l${i}`}
              title={[a.name, a.status, a.note].filter(Boolean).join(" · ")}
              style={{
                background: "#2a2110",
                border: "1px solid #92400e",
                borderRadius: 999,
                padding: `${sc.s(2, 1)}px ${sc.s(8, 5)}px`,
                fontSize: sc.s(16, 12),
                color: "#fde68a",
                whiteSpace: "nowrap",
              }}
            >
              {shortName(a.name)}
              {a.status === "조퇴" ? " 조퇴" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
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
