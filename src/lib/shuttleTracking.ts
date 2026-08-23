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
