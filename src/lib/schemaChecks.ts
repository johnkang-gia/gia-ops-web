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
  /**
   * 칸이 다 있어도 **저장이 안 되는** 경우를 잡습니다.
   *
   * 실제로 겪은 일입니다. attendance_entries는 칸이 전부 멀쩡했는데, 유일 인덱스에 조건이
   * 붙어 있어(`where source_message_id is not null`) upsert가 매번 42P10으로 실패했습니다.
   * 칸만 보는 점검은 초록불을 켰고, 화면은 조용히 아무것도 저장하지 않았습니다.
   *
   * 그래서 여기서는 **앱과 똑같이 한 줄을 넣어보고 곧바로 지웁니다.** 되는지 안 되는지는
   * 해봐야 압니다.
   */
  upsertProbe?: {
    onConflict: string;
    row: Record<string, unknown>;
    /** 넣어본 줄을 지울 때 쓸 조건(칸: 값). */
    cleanup: Record<string, string>;
  };
};

export const SCHEMA_CHECKS: SchemaCheck[] = [
  // ── 이 아래는 이번 주에 만든 것들입니다 ──────────────────────────────────
  //
  // 여기 없으면 점검 화면이 못 잡습니다. 실제로 지속 특이사항 표가 통째로 없는 채로
  // 며칠이 지났는데 아무도 몰랐습니다 - 위젯에 적으면 조용히 사라졌을 겁니다.
  // 새 마이그레이션을 만들 때는 반드시 여기에도 한 줄 적습니다.
  {
    feature: "지속 특이사항",
    table: "shuttle_persistent_notes",
    columns: ["student_name", "content", "effect_kind", "effect_days"],
    migration: "20260827200000_persistent_note_period.sql",
    impact: "하원체크표의 '지속 특이사항 입력'이 조용히 저장되지 않습니다.",
  },
  {
    feature: "기간 픽업·결석",
    table: "shuttle_persistent_notes",
    columns: ["effect_from", "effect_to", "request_id"],
    migration: "20260827200000_persistent_note_period.sql",
    impact: '"금요일까지 픽업"처럼 기간으로 온 연락이 반영되지 않습니다.',
  },
  {
    feature: "출결 등록 상태",
    table: "attendance_entries",
    columns: ["source", "source_message_id", "student_name", "status", "date_from"],
    migration: "20260826230000_attendance_entries.sql",
    impact: "인박스에서 등록한 출결이 대시보드에 반영되지 않고, 지운 것이 되살아납니다.",
  },
  {
    feature: "관찰기록 저장(upsert)",
    table: "wr_reports",
    columns: ["student_id", "subject", "report_date", "term_id"],
    migration: "20260828000000_wr_reports_scale.sql",
    impact:
      "유일 인덱스가 없으면 선생님들의 관찰기록 저장이 전부 실패합니다(42P10). 화면에는 '자동 저장 실패'만 뜹니다.",
    // 여기는 넣어보기(upsertProbe)를 하지 않습니다. wr_reports.student_id가 NOT NULL이라
    // 가짜 줄을 만들 수 없고, 아무 학생이나 골라 넣으면 그 아이 기록에 흔적이 남습니다.
    // 대신 outputs/관찰기록_부하테스트.sql 의 ②가 유일 인덱스를 직접 확인합니다.
  },
  {
    feature: "정류장 도착 근거",
    table: "shuttle_stop_arrivals",
    columns: ["matched_by"],
    migration: "20260827235500_stop_arrival_matched_by.sql",
    impact: "정류장 반경을 어떻게 줄여왔는지 되짚을 수 없고, 도착 기록이 아예 저장되지 않습니다.",
  },
  {
    feature: "출결 저장(upsert)",
    table: "attendance_entries",
    columns: [],
    migration: "20260827230000_attendance_entries_uniq_fix.sql",
    impact:
      "출결내역이 전부 ⬜로만 보이고, ✕(출결 아님)을 눌러도 사라지지 않습니다. 유일 인덱스에 조건이 붙어 있으면 저장 자체가 실패합니다.",
    upsertProbe: {
      onConflict: "source,source_message_id,student_name,status",
      row: {
        source: "manual",
        source_message_id: "__schema_probe__",
        student_name: "__점검용__",
        status: "결석",
        date_from: "1900-01-01",
        date_to: "1900-01-01",
        state: "무시",
        note: "스키마 점검용 - 자동으로 지워집니다",
      },
      cleanup: { source_message_id: "__schema_probe__" },
    },
  },
  {
    feature: "출결 이름 가르치기",
    table: "attendance_learning_rules",
    columns: ["kind", "pattern", "student_id"],
    migration: "20260826170000_attendance_learning.sql",
    impact: "🔎로 가르쳐도 저장되지 않아 같은 이름을 매번 다시 묻습니다.",
  },
  {
    feature: "셔틀 배정 미연결 사유",
    table: "shuttle_assignments",
    columns: ["unlinked_reason"],
    migration: "20260827110000_shuttle_link_reason.sql",
    impact: "명부와 안 붙은 배정이 왜 안 붙었는지 구분되지 않습니다.",
  },
  {
    feature: "학기별 반·과목 기록",
    table: "wr_term_class_snapshots",
    columns: ["term_id", "classes", "subjects", "taken_at"],
    migration: "20260831120000_term_class_snapshots.sql",
    impact: "학기가 끝나도 그 학기 반·담임·과목 세팅이 남지 않아, 학기를 바꿔도 지난 학기 세팅을 볼 수 없습니다.",
  },
  {
    feature: "재무 권한 분리",
    table: "app_users",
    columns: ["finance_access"],
    migration: "20260831180000_finance_role.sql",
    impact: "**모든 행정직원·관리자의 메뉴가 비어 보입니다.** 신분 조회가 이 칸을 함께 읽어서, 칸이 없으면 조회 전체가 실패하고 직위를 못 읽습니다. 재무 열쇠도 줄 수 없습니다.",
  },
  {
    feature: "납부 항목 · 할인",
    table: "fee_discounts",
    columns: ["name", "kind", "value", "active"],
    migration: "20260831200000_fee_plans_discounts.sql",
    impact: "재무 화면에서 납부 항목·할인을 만들 수 없습니다.",
  },
  {
    feature: "재무 권한 기록",
    table: "finance_access_log",
    columns: ["target_email", "granted", "changed_by"],
    migration: "20260831180000_finance_role.sql",
    impact: "재무 권한을 누가 언제 주고 뺏었는지가 남지 않습니다.",
  },
  {
    feature: "학사일정 회의",
    table: "academic_checklist_meetings",
    columns: ["item_id", "seq", "meet_date", "done"],
    migration: "20260831160000_academic_schedule_automation.sql",
    impact: "회의가 필요한 일정에 회의 줄이 만들어지지 않고, 업무보드에도 회의가 올라가지 않습니다.",
  },
  {
    feature: "과목 색",
    table: "wr_subject_colors",
    columns: ["name", "color"],
    migration: "20260831140000_subject_colors.sql",
    impact: "시간표에서 과목 색을 바꿔도 저장되지 않습니다(자동 색은 그대로 나옵니다).",
  },
  {
    feature: "구글챗 실시간 푸시",
    table: "google_chat_event_subscriptions",
    columns: ["subscription_name", "expire_time"],
    migration: "20260826210000_chat_event_subscriptions.sql",
    impact: "구글챗이 1분 주기 폴링으로만 들어오고 실시간 푸시가 동작하지 않습니다.",
  },
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
    feature: "답글 해결/진행중 판단",
    table: "pickup_requests",
    columns: ["reply_status"],
    migration: "20260824230000_reply_status.sql",
    impact: "직원 답글이 해결인지 진행중인지 구분되지 않습니다.",
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
  {
    feature: "수납(입금)",
    table: "payments",
    columns: ["invoice_id", "paid_at", "amount", "payer_name", "source_key"],
    migration: "20260901180000_payments.sql",
    impact: "들어온 돈을 인보이스에 붙일 수 없어 '누가 안 냈나'에 답할 수 없습니다.",
  },
  {
    feature: "항목 단가 이력",
    table: "fee_item_price_log",
    columns: ["item_id", "before_price", "after_price", "changed_at"],
    migration: "20260901180000_payments.sql",
    impact: "값이 오르면 덮어써져서 '작년엔 얼마였나'에 답할 수 없습니다.",
  },
  {
    feature: "학비외 항목",
    table: "fee_items",
    columns: ["category", "name", "unit_price", "default_grades", "default_classes", "active"],
    migration: "20260901160000_fee_items_invoices.sql",
    impact: "교재·교복 등을 등록할 수 없어 인보이스를 만들 수 없습니다.",
  },
  {
    feature: "학생별 항목 가감",
    table: "student_fee_items",
    columns: ["student_id", "item_id", "mode", "qty"],
    migration: "20260901160000_fee_items_invoices.sql",
    impact: "기본 세트에서 빼거나 더한 것이 저장되지 않습니다.",
  },
  {
    feature: "인보이스",
    table: "invoices",
    columns: ["invoice_no", "student_name", "issue_date", "due_date", "total_amount", "status"],
    migration: "20260901160000_fee_items_invoices.sql",
    impact: "인보이스를 발행할 수 없습니다.",
  },
  {
    feature: "인보이스 내역",
    table: "invoice_lines",
    columns: ["invoice_id", "seq", "name", "qty", "unit_price", "amount"],
    migration: "20260901160000_fee_items_invoices.sql",
    impact: "총액만 있고 내역이 없는 인보이스가 나갑니다.",
  },
  {
    feature: "반 교실 위치",
    table: "wr_classes",
    columns: ["class_name", "grade", "room"],
    migration: "(기본 스키마)",
    impact: "학생 검색에서 '몇 동 몇 층'이 안 뜹니다. 아이를 찾아가야 하는 사람에게는 반 이름보다 이게 필요합니다.",
  },
  {
    feature: "오늘 탑승 기록",
    table: "shuttle_boardings",
    columns: ["service_date", "assignment_id", "status", "checked_by", "checked_at", "override_route_id"],
    migration: "(기본 스키마)",
    impact:
      "하원 체크표가 오늘 눌러둔 픽업·결석·노선이동을 읽지 못합니다. 화면에는 오류가 없고 아무도 안 누른 것처럼 보입니다.",
  },
  {
    feature: "체크표 활동 기록",
    table: "shuttle_checklist_log",
    columns: ["service_date", "student_name", "action", "actor_email", "created_at"],
    migration: "20260901120000_checklist_activity_log.sql",
    impact: "체크표에서 누가 무엇을 바꿨는지 남지 않습니다. 표시가 바뀌어 있어도 물어볼 곳이 없습니다.",
  },
  {
    feature: "하원수단(요일별)",
    table: "student_dismissal_plans",
    columns: ["student_id", "weekday", "kind", "depart_time"],
    migration: "20260831220000_dismissal_plans.sql",
    impact: "요일마다 다른 차를 타는 아이의 하원 방법을 적을 수 없습니다.",
  },
  {
    feature: "재무 열쇠",
    table: "app_users",
    columns: ["finance_access"],
    migration: "20260831180000_finance_role.sql",
    impact: "돈 화면 권한을 줄 수 없습니다. 예전에는 이 칸이 없으면 신분 조회 전체가 400으로 막혀 모든 사람의 메뉴가 사라졌습니다.",
  },
  {
    feature: "납부 항목·납부 옵션",
    table: "fee_plans",
    columns: ["category", "name", "base_amount", "unit", "active"],
    migration: "20260831200000_fee_plans_discounts.sql",
    impact: "청구서의 재료가 없어 납부 항목 화면이 비어 있습니다.",
  },
  {
    feature: "할인 규칙",
    table: "fee_discounts",
    columns: ["name", "kind", "value", "active", "requires_approval"],
    migration: "20260831200000_fee_plans_discounts.sql",
    impact: "할인을 만들거나 끌 수 없습니다.",
  },
  {
    feature: "학생 납부 선택·할인",
    table: "student_fee_enrollments",
    columns: ["student_id", "plan_id", "option_id", "signed_at"],
    migration: "20260831200000_fee_plans_discounts.sql",
    impact: "학부모가 서명해서 고른 납부 옵션을 저장할 수 없습니다.",
  },
];
