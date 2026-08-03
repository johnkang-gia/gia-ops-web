// 업무 마감일(시:분까지 포함)을 OS 기본 캘린더 앱에 담아주는 유틸입니다. 홈 화면 달력의
// 날짜 전용 버전(components/home/DateTimeCard.tsx)과 원리는 같지만, 여기는 정확한 시각까지
// 있는 일정(업무 마감)을 다룹니다.
// - Mac/iOS: Calendar.app의 calshow: URL 스킴으로 그 시각의 날짜를 바로 엽니다(자동으로
//   일정이 만들어지진 않고, 앱이 열려서 직접 추가하기 편하게 해줍니다).
// - 그 외(Windows/Android 등): .ics 파일을 만들어 다운로드합니다. 더블클릭하면 기본
//   캘린더 앱(Outlook/구글 캘린더 등)에서 바로 일정으로 추가할 수 있습니다.
const MAC_EPOCH_SECONDS = Date.UTC(2001, 0, 1) / 1000;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

function stamp(d: Date) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

export function addTimedEventToNativeCalendar(dueAtIso: string, title: string) {
  const start = new Date(dueAtIso);

  if (isApplePlatform()) {
    const macSeconds = Math.floor(start.getTime() / 1000 - MAC_EPOCH_SECONDS);
    window.location.href = `calshow:${macSeconds}`;
    return;
  }

  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const dtStamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GIA Ops//KO",
    "BEGIN:VEVENT",
    `UID:${stamp(start)}-${Date.now()}@gia-ops-web`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "task.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
