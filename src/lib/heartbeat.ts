import type { SupabaseClient } from "@supabase/supabase-js";

// 연동이 살아 있다는 신호를 남깁니다.
//
// 왜 필요한가요?
//   이 앱은 크론 12개·토들 수집기·구글챗 미러·GPS 수신에 기대어 굴러갑니다. 그런데 이것들이
//   멈춰도 **화면은 멀쩡해 보입니다.** 데이터가 안 들어올 뿐이고, 그게 가장 위험합니다.
//   실제로 27호 GPS 추적이 3일간 조용히 죽어 있었고, 담당자가 눈으로 알아채서야 발견됐습니다
//   (크론 주소를 옮긴 뒤 새 주소를 등록하지 않은 것이 원인이었습니다).
//
//   "돌고 있다"를 매번 남겨두면, 안 남은 것만 봐도 무엇이 멈췄는지 압니다.
//
// 실패해도 조용히 넘어갑니다 - 심장박동을 못 남긴 것 때문에 정작 하려던 일이 실패하면
// 본말전도입니다.
export async function touchHeartbeat(
  supabase: SupabaseClient,
  key: string,
  status: "ok" | "error" | "skipped" = "ok",
  detail?: string | null
): Promise<void> {
  try {
    await supabase.from("integration_heartbeats").upsert(
      {
        key,
        last_seen_at: new Date().toISOString(),
        status,
        detail: detail ?? null,
      },
      { onConflict: "key" }
    );
  } catch {
    /* 신호를 못 남겨도 본 작업은 계속합니다 */
  }
}

// 화면에 보여줄 연동 목록. key는 위 touchHeartbeat가 쓰는 값과 같아야 합니다.
//
// everyMinutes = 이 정도 간격으로 신호가 와야 정상. 이 값의 3배가 지나면 끊긴 것으로 봅니다
// (네트워크가 한두 번 튀는 것까지 빨간불을 켜지 않도록 여유를 둡니다).
export type IntegrationSpec = {
  key: string;
  label: string;
  what: string;
  everyMinutes: number;
  /** 평일 낮에만 도는 것들. 그 밖의 시간에 신호가 없는 건 정상입니다. */
  officeHoursOnly?: boolean;
};

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    key: "cron:shuttle-auto",
    label: "셔틀 자동 도착·출발",
    what: "GPS를 보고 출발·도착을 판단합니다. 멈추면 기록분석이 빕니다.",
    everyMinutes: 1,
    officeHoursOnly: true,
  },
  { key: "google-chat-poll", label: "구글챗 수집", what: "출결알림·문의를 인박스로 가져옵니다.", everyMinutes: 1 },
  { key: "toddle-collector", label: "토들 수집기", what: "학부모 문의를 가져옵니다. 브라우저가 켜져 있어야 합니다.", everyMinutes: 1 },
  { key: "cron:pickup-schedules", label: "픽업 예약 반영", what: "예약된 픽업을 그날 체크표에 겁니다.", everyMinutes: 5 },
  { key: "cron:shuttle-learn-stops", label: "정류장 좌표 학습", what: "실제 주행 GPS로 정류장 위치를 다듬습니다.", everyMinutes: 60 * 24 },
  { key: "cron:purge-shuttle-locations", label: "GPS 기록 정리", what: "오래된 위치 기록을 지웁니다. 용량 관리의 핵심입니다.", everyMinutes: 60 * 24 },
  { key: "cron:purge-trash", label: "휴지통 비우기", what: "30일 지난 삭제 항목을 정리합니다.", everyMinutes: 60 * 24 },
  { key: "cron:archive-tasks", label: "완료업무 보관", what: "끝난 업무를 보관함으로 옮깁니다.", everyMinutes: 60 * 24 },
  { key: "cron:daily-backup", label: "일일 백업", what: "", everyMinutes: 60 * 24 },
  { key: "cron:chat-subscription-renew", label: "구글챗 구독 갱신", what: "실시간 푸시 유효기간을 연장합니다.", everyMinutes: 60 * 24 },
  { key: "cron:term-switch", label: "학기 전환 확인", what: "", everyMinutes: 60 * 24 },
  { key: "cron:education-news", label: "교육뉴스 수집", what: "", everyMinutes: 60 * 24 * 7 },
  { key: "cron:manual-review", label: "수기검토 알림", what: "", everyMinutes: 60 * 24 * 7 },
];
