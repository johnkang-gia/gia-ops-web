"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boardDayKst } from "@/lib/boardDay";
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
// ── 이 화면은 다섯 조각으로 나뉘어 있습니다 ─────────────────────────────
//
// 한 파일에 1,968줄이 있었습니다. 화면 한 장이라 한 파일이 자연스러웠지만, 열자마자
// 시간표·픽업 알람·교실 쪽지·글자 크기 손잡이가 한꺼번에 눈에 들어와서 «어디를 고쳐야
// 하나»를 찾는 것부터 일이 됐습니다. 동작은 그대로 두고 자리만 나눴습니다.
//
//   boardShared  — 화면에 담기는 자료의 모양(BoardData)과 작은 도구들
//   BoardPopups  — 눌렀을 때 뜨는 작은 창(문의 원문·주간 시간표)
//   BoardPanels  — 대시보드의 칸들(밤 정보·교실 쪽지·인박스·오늘 변동사항)
//   PickupAlerts — 픽업 5분 전 알람
//   BoardChrome  — 글자 크기·전체화면 손잡이
import { BoardData, STATUS_COLOR, WEEKDAY_KO, shortName } from "./boardShared";
import { InquiryPopup, WeekTimetablePopup } from "./BoardPopups";
import { ClassroomNotes, Empty, NightInfoPanel, Panel, PendingInbox, TodayChanges } from "./BoardPanels";
import { PickupAlarm, PickupToast } from "./PickupAlerts";
import { DensityPicker, FullscreenPrompt } from "./BoardChrome";

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
  /** 서버에서 받은 마지막 번호. 다음에 물어볼 때 이걸 보내 「바뀌었는지」만 확인합니다. */
  const revRef = useRef<number | null>(null);
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
      // 들고 있는 번호를 함께 보냅니다. 서버는 번호가 같으면 「안 바뀌었습니다」 한 줄만
      // 돌려주고, 계산도 자료 읽기도 하지 않습니다.
      const parts: string[] = [];
      if (department) parts.push(`department=${encodeURIComponent(department)}`);
      if (revRef.current !== null) parts.push(`since=${revRef.current}`);
      const qs = parts.length > 0 ? `?${parts.join("&")}` : "";
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
      const body = (await res.json()) as (BoardData & { revision?: number }) | { unchanged: true; revision: number };
      if ("unchanged" in body && body.unchanged) {
        // 안 바뀌었으면 화면은 그대로 둡니다. **여기서 setData 를 부르면** 같은 값으로
        // 다시 그려져서 아낀 뜻이 없어지고, 스크롤·펼침 상태도 튑니다.
        revRef.current = body.revision;
        return;
      }
      if (typeof body.revision === "number") revRef.current = body.revision;
      setData(body as BoardData);
    } catch {
      setErrorMsg("연결에 실패했습니다. 잠시 후 다시 시도합니다.");
    }
  }, [token, department]);

  // 부서를 바꾸면 보던 자료가 달라집니다. 번호를 비워 **한 번은 전부 받아옵니다** -
  // 안 그러면 초등부 번호를 들고 중고등부를 물어봐서 「안 바뀌었다」는 답이 돌아옵니다.
  useEffect(() => {
    revRef.current = null;
  }, [department]);

  useEffect(() => {
    load();
  }, [load]);

  // ── 하루가 바뀌면 곧바로 다시 읽습니다 ──────────────────────────────────
  //
  // 이 화면은 사무실 큰 모니터에 **하루 종일 켜져 있습니다.** 날짜가 바뀌어도 아무도
  // 새로고침하지 않으니, 어제 픽업이 오늘 화면에 그대로 남아 있었습니다. 오류가 아니라
  // 「어제 자료」라서 보는 사람은 오늘 것인 줄 압니다.
  //
  // 기준을 자정이 아니라 **아침 8시**로 둡니다. 새벽에 화면을 보는 사람은 아직 「어제」를
  // 마무리하는 중이고, 하루가 실제로 바뀌는 것은 아이들이 오는 때입니다.
  useEffect(() => {
    let last = boardDayKst();
    const t = setInterval(() => {
      const now = boardDayKst();
      if (now !== last) {
        last = now;
        void load();
      }
    }, 60_000);
    return () => clearInterval(t);
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
