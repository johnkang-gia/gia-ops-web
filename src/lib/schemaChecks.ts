// 데이터베이스가 앱이 기대하는 모양을 갖췄는지 확인할 목록.
//
// 마이그레이션을 올려도 실제로 적용됐는지는 지금까지 화면이 깨져야 알 수 있었습니다.
// 그것도 "어느 기능이 안 되는지"만 알 뿐, 왜 안 되는지는 짐작해야 했습니다.
//
// 그래서 기능마다 "이게 있어야 돌아간다"를 적어두고, 실제 데이터베이스에 물어봐서
// 초록/빨강으로 보여줍니다. 빨간 줄이 있으면 어느 마이그레이션이 안 걸렸는지도 함께 나옵니다.
//
// 새 마이그레이션을 만들 때 여기에도 한 줄 추가하면, 다음부터 그 기능도 자동으로 점검됩니다.

export type SchemaCheck = {
  /** 사람이 읽는 기능 이름. 빨간 줄일 때 "무엇이 안 되는지"가 바로 보여야 합니다. */
  feature: string;
  table: string;
  /** 이 컬럼들이 모두 있어야 그 기능이 돕니다. */
  columns: string[];
  /** 없을 때 실행해야 할 마이그레이션 파일. */
  migration: string;
  /** 없으면 무엇이 안 되는지. */
  impact: string;
};

export const SCHEMA_CHECKS: SchemaCheck[] = [
  {
    feature: "픽업 인박스",
    table: "pickup_requests",
    columns: ["service_date", "source", "raw_text", "ai_confidence", "status"],
    migration: "20260824090000_pickup_inbox.sql",
    impact: "토들·전화로 들어온 픽업이 아예 저장되지 않습니다.",
  },
  {
    feature: "수집기 상태 표시",
    table: "integration_heartbeats",
    columns: ["key", "last_seen_at", "status"],
    migration: "20260824090000_pickup_inbox.sql",
    impact: "수집기가 멈춰도 화면에 경고가 뜨지 않습니다.",
  },
  {
    feature: "학부모 문의 분류",
    table: "pickup_requests",
    columns: ["kind", "inquiry_type", "summary", "urgency", "source_url", "answered_at"],
    migration: "20260824140000_parent_inquiries.sql",
    impact: "문의 탭과 운영 대시보드의 문의 칸이 비어 보입니다.",
  },
  {
    feature: "앞날 픽업 예약",
    table: "pickup_schedules",
    columns: ["service_date", "status", "needs_confirm", "student_id"],
    migration: "20260824180000_pickup_schedules.sql",
    impact: '"이번주 목금 픽업" 같은 연락에서 오늘 것만 처리되고 나머지 날짜는 사라집니다.',
  },
  {
    feature: "토들·구글챗 중복 묶기",
    table: "pickup_requests",
    columns: ["merged_sources", "merged_count"],
    migration: "20260824200000_pickup_dedupe.sql",
    impact: "같은 연락이 두 줄로 뜹니다.",
  },
  {
    feature: "문의 처리·답글 감지",
    table: "pickup_requests",
    columns: ["answered_via", "replied_by", "replied_at"],
    migration: "20260824210000_inquiry_resolve.sql",
    impact: "체크로 넘기기와 답글 자동 감지가 동작하지 않습니다.",
  },
  {
    feature: "기사님 설정 링크",
    table: "shuttle_tracker_devices",
    columns: ["setup_code", "setup_opened_at"],
    migration: "20260823120000_driver_setup_link.sql",
    impact: "기사님께 보내는 설정 링크를 만들 수 없습니다.",
  },
  {
    feature: "도서 정리 계획",
    table: "lib_books",
    columns: ["audience", "target_location_id"],
    migration: "20260824160000_library_shelf_plan.sql",
    impact: "책의 '가야 할 자리'를 기록할 수 없어 도서정리 계획이 동작하지 않습니다.",
  },
];
