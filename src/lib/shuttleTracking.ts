// 하원 셔틀 GPS 추적(Traccar Client 연동) 공통 상수·도우미입니다.
//
// 배경(요청): "기사님들은 네비를 핸드폰으로 하시는 경우도 많아서, 핸드폰을 조작하는데 이 앱이
// 방해를 해서는 안돼... 백그라운드에서 돌아갈 수 있도록 만들어야" - 웹페이지는 아이폰 사파리
// 특성상 백그라운드에서 위치를 보낼 수 없어서, 무료 오픈소스 앱인 Traccar Client가 우리 서버로
// 위치를 직접 보내도록 연동합니다. 기사님은 최초 1회 설정 뒤로는 아무 조작도 하지 않으십니다.

// 기사님 개인 휴대폰을 쓰는 방식이라, 하원 운행과 무관한 시간의 위치는 아예 저장하지 않습니다
// (앱은 24시간 켜져 있지만 서버가 이 창 밖의 좌표를 받아서 버립니다 - 개인정보 최소 수집).
//
// 요청: "위치저장은 딱 등원과 하원하는 시간이고 등원시간대는 내가 나중에 알려줄거고 일단은
// 하원만 트래킹되도록해줘 하원트래킹은 오후 3:30분 부터 오후 6시 30분까지 3시간이야 그 이후에는
// 위치추적안하고"
//
// 이 창은 문서로만 약속한 것이 아니라 서버가 실제로 강제합니다(/api/shuttle/track). 창 밖에서
// 들어온 좌표는 저장하지 않고 버리므로, 기사님이 앱을 끄지 않으셔도 퇴근 후 동선은 남지 않습니다.
// 나중에 등원 시간대를 알려주시면 TRACK_WINDOWS에 한 줄만 더하면 됩니다.
export type TrackWindow = { startMinute: number; endMinute: number; label: string };

const hm = (hour: number, minute: number) => hour * 60 + minute;

export const TRACK_WINDOWS: TrackWindow[] = [
  // 하원: 평일 15:30 ~ 18:30 (3시간)
  { startMinute: hm(15, 30), endMinute: hm(18, 30), label: "하원" },
  // 등원: 시간대 확정 후 추가 예정
];

// 화면·문서에 같은 문구를 쓰기 위한 표시용 문자열입니다("15:30~18:30").
export function formatTrackWindows(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const at = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  return TRACK_WINDOWS.map((w) => `${at(w.startMinute)}~${at(w.endMinute)}`).join(", ");
}

// 서버는 UTC로 돌기 때문에, 한국 기준 날짜·시각이 필요한 곳에서는 항상 이 함수를 씁니다
// (term-switch 크론에서 쓰던 +9시간 방식과 동일).
export function kstParts(date: Date): { iso: string; hour: number; minute: number; weekday: number } {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    iso: shifted.toISOString().slice(0, 10),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(), // 0=일 ... 6=토
  };
}

// 이 시각의 위치를 저장해도 되는지(하원 운행 시간대인지) 판단합니다. 주말은 운행이 없으므로
// 아예 받지 않습니다. Traccar Client는 통신이 끊기면 저장했다가 나중에 몰아서 보내므로,
// "지금 시각"이 아니라 "그 좌표가 기록된 시각" 기준으로 판단해야 합니다.
export function isWithinTrackingWindow(recordedAt: Date): boolean {
  const { hour, minute, weekday } = kstParts(recordedAt);
  if (weekday === 0 || weekday === 6) return false;
  const at = hour * 60 + minute;
  return TRACK_WINDOWS.some((w) => at >= w.startMinute && at < w.endMinute);
}

// ── 크론 문지기 ──────────────────────────────────────────────────────────────
//
// 셔틀 자동 도착·출발 감지 크론은 외부 스케줄러가 1분마다 부르고, 한 번 불릴 때마다 25초 동안
// 함수를 붙잡고 5초마다 DB를 다시 봅니다. 차가 실제로 다니는 시간은 하루 3시간뿐인데 24시간
// 내내 그렇게 돌고 있어서, 이 크론 하나가 월 300시간을 씁니다(앱 전체 함수 실행시간의 3분의 1).
//
// 그런데 운행 시간대 밖에는 애초에 볼 것이 없습니다 - 위치 자체가 저장되지 않으니까요
// (isWithinTrackingWindow가 /api/shuttle/track에서 창 밖 좌표를 버립니다). 없는 데이터를
// 5초마다 다시 확인하는 셈이라, 창 밖에서는 루프에 들어가지 않고 바로 돌아섭니다.
//
// 끝 시각에 30분을 더한 이유: 18:30에 딱 맞춰 끊으면, 그 직전에 도착한 차의 '출발'이 아직
// 안 찍힌 상태로 남습니다(자동 출발은 도착 후 최소 90초, 늦으면 20분까지 기다립니다).
// 꼬리를 조금 남겨 그날 마지막 차까지 마무리되게 합니다.
const SHUTTLE_CRON_TAIL_MIN = 30;

export function shouldRunShuttleCron(now: Date = new Date()): boolean {
  const { hour, minute, weekday } = kstParts(now);
  if (weekday === 0 || weekday === 6) return false; // 주말은 운행 없음
  const at = hour * 60 + minute;
  return TRACK_WINDOWS.some((w) => at >= w.startMinute && at < w.endMinute + SHUTTLE_CRON_TAIL_MIN);
}

// ── 구글챗 출결알림을 촘촘히 봐야 하는 시간 ──────────────────────────────────
//
// 담당자 확인(요청): "아침 시간과, 하원이 시작되는 4시의 두 시간 전, 그리고 하원이 직접
// 시작되는 3시 50분부터 4시 30분까지는 거의 실시간으로 긁어와야 해 — 그때 직원들이 나가서
// 하원지도를 하기 때문에, 미뤄지면 픽업인데 그 알림이 오기 전에 차에 태워버리는 경우가 있어서."
//
// 마지막 문장이 이 설정의 이유 전부입니다. 픽업 연락이 1분 늦게 반영되면 아이가 이미 차에
// 타 있을 수 있습니다. 그래서 하원 지도 시간대는 비용을 아끼는 대상이 아니라 **가장 촘촘해야
// 하는 구간**입니다. 반대로 그 밖의 시간은 몇 분 늦어도 아무 일도 생기지 않습니다.
//
// 창 밖이라고 아예 건너뛰지는 않습니다 - 셔틀 위치와 달리 채팅은 "안 보면 영영 놓치는" 자료라,
// 창 밖에서는 25초 루프 대신 딱 한 번만 확인합니다(그래도 1분 안에는 들어옵니다).
// 담당자 확인(2차): "구글챗이나 토들 같은 경우 굉장히 중요한 거라서 업무시간에 바로바로
// 업데이트되어야 해." 그래서 아침·하원 두 토막으로 나누지 않고 **근무시간 전체**를 촘촘한
// 구간으로 둡니다. 출결·픽업 연락은 예고 없이 들어오고, 놓쳤을 때의 대가가 비용보다 큽니다.
//
// 비용은 감당 가능합니다 - 크론 문지기와 셔틀 크론 통합으로 월 800시간 넘게 비웠고,
// 이 구간을 근무시간 전체로 넓혀도 그중 100시간 남짓만 다시 씁니다.
export const CHAT_PEAK_WINDOWS: TrackWindow[] = [
  { startMinute: hm(7, 0), endMinute: hm(19, 0), label: "근무시간" },
];

export function isChatPollPeakHour(now: Date = new Date()): boolean {
  const { hour, minute, weekday } = kstParts(now);
  if (weekday === 0 || weekday === 6) return false;
  const at = hour * 60 + minute;
  return CHAT_PEAK_WINDOWS.some((w) => at >= w.startMinute && at < w.endMinute);
}
