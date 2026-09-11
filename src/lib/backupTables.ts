/**
 * **무엇을 백업하는가** — 한 곳에서만 정합니다.
 *
 * ── 무엇이 문제였나 ──────────────────────────────────────────────────
 *
 * 백업이 세 벌 있었는데 셋 다 데이터를 지키지 못했습니다.
 *
 *   · `npm run backup` — **코드**만 남깁니다(깃 태그 + 압축본). 데이터는 없습니다.
 *   · `backups` 표 + `create_backup()` — 사건·회의·업무 등 **열 개 표**만 담습니다.
 *     학생 명부·출결·셔틀·회계가 통째로 빠져 있습니다. 정작 잘못되면 큰일나는 것들입니다.
 *   · Supabase 자동 백업 — 전체를 담지만 **대시보드 안에만** 있고, 학교가 자기 손에
 *     쥘 수가 없습니다.
 *
 * 게다가 앞의 둘은 같은 데이터베이스 안에 있습니다. **DB가 통째로 잘못되면 백업도 같이
 * 사라집니다.** 그건 백업이 아닙니다.
 *
 * ── 그래서 ───────────────────────────────────────────────────────────
 *
 * 담을 표 목록을 여기 한 곳에 적고, 내려받기와 매일 자동 저장이 **같은 목록**을 씁니다.
 * 두 곳에 적으면 반드시 어긋나고, 어긋난 쪽은 백업받은 줄 알았는데 없는 표가 됩니다.
 *
 * 새 표를 만들고 여기 안 적으면 `npm run build` 가 막습니다(`check-backup-tables.mjs`).
 * 백업에서 빠진 표는 **빠진 줄도 모르는 채로** 몇 달 갑니다.
 */

/** 백업에 담는 표. 묶음은 사람이 목록을 읽을 때를 위한 것입니다. */
export const BACKUP_GROUPS: { group: string; tables: string[] }[] = [
  {
    group: "학생·학적",
    tables: [
      "wr_students",
      "wr_classes",
      "wr_enrollments",
      "wr_student_field_defs",
      "wr_term_class_snapshots",
      "student_groups",
      "student_group_members",
      "student_apparel_sizes",
      // 휴가계획서·진단서. **파일은 저장소에 있고 여기 담기는 것은 목록입니다** - 파일까지
      // 담으면 백업 파일이 통째로 무거워집니다. 목록이 없으면 저장소에 파일만 남아 누구
      // 것인지 알 수 없게 되므로, 목록은 반드시 담습니다.
      "student_absence_docs",
      "terms",
      "school_days",
    ],
  },
  {
    group: "출결",
    tables: ["attendance_records", "attendance_entries", "attendance_coverage", "attendance_learning_rules"],
  },
  {
    group: "회계",
    tables: [
      "invoices",
      "invoice_lines",
      "payments",
      "cash_receipts",
      "fee_plans",
      "fee_items",
      "fee_terms",
      "fee_categories",
      "fee_discounts",
      "fee_payment_options",
      "student_fee_enrollments",
      "student_fee_items",
      "student_fee_discounts",
    ],
  },
  {
    group: "셔틀",
    tables: [
      "shuttle_routes",
      "shuttle_stops",
      "shuttle_assignments",
      "shuttle_boardings",
      "shuttle_ride_alongs",
      "shuttle_persistent_notes",
      "shuttle_route_vehicle_history",
      "shuttle_tracker_devices",
      "shuttle_pilot_routes",
      "shuttle_campus_locations",
      "student_dismissal_plans",
      "pickup_requests",
      "pickup_schedules",
      // 토들 방 ↔ 학생. 학기 초에 사람이 한 번 확인한 판단이라, 잃으면 137개를 다시
      // 확인해야 합니다. 다시 만들 수 있는 자료가 아니라 사람 손이 들어간 자료입니다.
      "toddle_channels",
      "toddle_channel_students",
    ],
  },
  {
    group: "업무·기록",
    tables: [
      "tasks",
      "task_comments",
      "task_attachments",
      "board_notes",
      "day_reminders",
      "work_tags",
      "work_notices",
      "department_memos",
      "incidents",
      "incident_students",
      "meetings",
      "events",
      "proposals",
      "adopted",
      "documents",
      "school_documents",
      "manual_sections",
      "teacher_office_requests",
      "inquiries",
    ],
  },
  {
    group: "학사·시간표",
    tables: [
      "academic_checklist_templates",
      "academic_checklist_items",
      "academic_checklist_meetings",
      "wr_timetable",
      "wr_periods",
      "wr_subjects",
      "wr_subject_colors",
      "duty_roster",
      "staff_assignments",
    ],
  },
  {
    group: "관찰기록",
    tables: ["wr_reports", "wr_comments"],
  },
  {
    group: "의류",
    tables: ["apparel_orders", "apparel_order_items", "apparel_order_pieces", "apparel_stock_moves", "apparel_exchanges"],
  },
  {
    group: "학교 연결·양식",
    // **사람이 손으로 만든 것**만 여기 둡니다. 「화면에서 다시 만들면 된다」는 말은 맞지만,
    // 교실 태블릿 열두 대와 안내보드·도착체크 링크를 다시 등록하고 각 기기에 새 주소를
    // 다시 붙이는 일은 하루가 걸립니다. 다시 만들 수 있는 것과 다시 만들기 쉬운 것은
    // 다릅니다.
    tables: ["classroom_links", "shuttle_arrival_links", "shuttle_board_links", "roster_sync_links", "form_import_templates"],
  },
  {
    group: "회계 이력",
    // 지금 값은 fee_items·fee_discounts 에 있지만, **언제 얼마에서 얼마로 바뀌었는지**는
    // 여기에만 있습니다. 되돌릴 수 없는 기록이라 담습니다 - 회계는 「지금 얼마인가」보다
    // 「그때 얼마였나」를 더 자주 묻습니다.
    tables: ["fee_item_price_log", "fee_discount_log", "finance_access_log"],
  },
  {
    group: "오류 판단",
    // 오류 **줄**은 다시 쌓이지만(BACKUP_SKIP), 「이건 고쳤다」는 판단은 사람이 한 번씩
    // 내린 것이고 다시 만들 길이 없습니다. 이것이 사라지면 이미 고친 오류가 전부 미해결로
    // 되살아나, 화면이 다시 못 믿을 목록이 됩니다.
    tables: ["error_resolutions"],
  },
  {
    group: "설정·계정",
    // 계정은 이름·역할만 들어 있고 비밀번호는 Supabase Auth 쪽이라 여기 없습니다.
    tables: ["app_users", "departments", "task_mode_colors", "policy_categories", "gia_systems", "ops_board_links"],
  },
];

export const BACKUP_TABLES: string[] = BACKUP_GROUPS.flatMap((g) => g.tables);

/**
 * **일부러 안 담는 표**와 그 이유.
 *
 * 이유를 적게 하는 것이 요점입니다 - 빼는 것은 쉬워야 하지만, 왜 뺐는지는 남아야 합니다.
 * 나중에 「이 표는 왜 백업에 없지?」를 물었을 때 답이 여기 있어야 합니다.
 */
export const BACKUP_SKIP: Record<string, string> = {
  // ── 담으면 안 되는 것 ──────────────────────────────────────────────
  google_chat_oauth_tokens: "접속 비밀값. 내려받는 파일에 들어가면 그 파일이 곧 열쇠가 됩니다.",
  backups: "백업 안에 백업을 담으면 파일이 회차마다 배로 불어납니다.",
  data_export_log: "내려받기 기록. 백업 자체가 아니라 백업을 누가 가져갔나의 기록입니다.",
  data_restore_log: "되돌리기 기록. 되돌린 백업으로 이 기록까지 덮으면 되돌린 사실이 사라집니다.",

  // ── 다시 만들 수 있는 것 ───────────────────────────────────────────
  applied_migrations: "마이그레이션 실행 이력. supabase/migrations 가 원본입니다.",
  board_revisions: "「바뀌었다」를 알리는 번호. 내용이 없고, 되돌린 뒤 첫 요청에 저절로 다시 셉니다.",
  shuttle_route_paths: "길찾기 결과 캐시. 지우면 다시 계산됩니다.",
  apparel_stock_balance: "재고 원장에서 계산되는 뷰 성격의 값입니다.",
  finance_key_holders: "app_users 를 걸러 만든 뷰입니다. 원본은 app_users 에 담습니다.",
  wr_students_basic: "wr_students 를 좁혀 만든 뷰입니다.",
  shuttle_assignments_basic: "shuttle_assignments 를 좁혀 만든 뷰입니다.",
  wr_import_issues: "명부 반영 때 그때그때 다시 만들어지는 점검 결과입니다.",
  roster_sync_inbox: "구글시트에서 들어온 임시 대기줄. 반영되면 명부가 원본입니다.",
  roster_sync_attempts: "명부 반영 시도 기록. 실패를 되짚는 용도라 잃어도 됩니다.",
  manual_drafts: "AI 초안. 채택되면 manual_sections 로 들어갑니다.",
  manual_review_flags: "매뉴얼 점검 표시. 다시 계산됩니다.",
  manual_section_history: "매뉴얼 판 이력. 본문은 manual_sections 에 있습니다.",
  form_submissions: "양식 제출 임시 보관.",
  student_dup_dismissals: "중복 정리 작업용 임시 표.",

  // ── 지나가는 기록 (보관주기가 이미 있음) ───────────────────────────
  shuttle_pilot_pings: "GPS 위치 기록. 30일 보관이고 지나면 뜻이 없습니다. 담으면 파일만 커집니다.",
  shuttle_run_events: "운행 시작·종료 기록. 지나간 것은 되돌릴 일이 없습니다.",
  shuttle_safety_events: "급가속·급감속 기록. 위와 같습니다.",
  shuttle_stop_arrivals: "정류장 도착 기록. 위와 같습니다.",
  shuttle_stop_observations: "정류장 좌표 학습용 관측값. 다시 쌓입니다.",
  shuttle_checklist_log: "하원 체크 활동 기록. 그날치 확인용입니다.",
  google_chat_mirror_messages: "구글챗 사본. 원본이 구글챗에 그대로 있습니다.",
  google_chat_spaces: "방 목록. 다시 받아올 수 있습니다.",
  google_chat_members: "방 사람 목록. 다시 받아올 수 있습니다.",
  google_chat_event_subscriptions: "구글챗 알림 구독. 다시 겁니다.",
  pickup_sender_feedback: "보낸 사람 교정 기록.",
  error_logs: "오류 기록.",
  ai_usage_logs: "AI 사용량 기록.",
  ai_feature_flags: "AI 기능 스위치. 화면에서 다시 켭니다.",
  integration_heartbeats: "연동 살아있음 신호.",
  version_broadcasts: "새로고침 안내 신호.",
  work_notice_collapses: "공지를 접은 사람 표시.",
  classroom_calls: "교실 태블릿 호출. 그때만 뜻이 있습니다.",
  classroom_notes: "교실 태블릿 쪽지. 그날치입니다.",
  messages: "옛 쪽지. 쓰이지 않습니다.",
  education_news: "교육 뉴스 모음. 다시 받아옵니다.",
  student_apparel_sizes_history: "쓰지 않습니다.",
};

/** 이 표를 백업에 담는가. 담지도 않고 이유도 없으면 검사기가 막습니다. */
export function backupCoverage(table: string): "담음" | "안담음" | "모름" {
  if (BACKUP_TABLES.includes(table)) return "담음";
  if (BACKUP_SKIP[table]) return "안담음";
  return "모름";
}

/** 한 번에 읽어오는 줄 수. 너무 크면 메모리가 터지고, 너무 작으면 왕복이 늘어납니다. */
export const BACKUP_PAGE = 1000;

/** 파일 이름. 날짜가 앞에 와야 목록에서 시간순으로 줄을 섭니다. */
export function backupFileName(nowKst: string): string {
  return `gia-data-${nowKst}.json`;
}
