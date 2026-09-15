/**
 * **자료 등기소** — 이 앱이 다루는 자료의 종류를 한 곳에 적어 둡니다.
 *
 * ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
 *
 * 표가 55개입니다. 새 기능을 만들 때마다 표가 하나씩 늘고, 그때마다
 *
 *   · 이 자료는 어느 종류인가
 *   · 같은 것이 두 번 들어오면 무엇으로 막나
 *   · 넣었으면 내리는 함수는 어디에 있나
 *   · 사람이 가르친 규칙은 어디서 읽나
 *
 * 를 **그 자리에서 다시** 정했습니다. 그래서 화면마다 답이 달라졌고, 같은 아이가 세 줄로
 * 들어오거나(오늘 픽업), 한 곳에서 지웠는데 다른 곳에 남거나(강하라), 가르친 별칭이 한
 * 화면에만 붙는 일이 반복됐습니다.
 *
 * 이 파일은 그 답을 **자료 종류마다 한 번만** 적어 두는 자리입니다. 코드가 읽고, 빌드
 * 검사기가 읽고, 사람도 읽습니다.
 *
 * ── 이 파일이 실제로 하는 일 ────────────────────────────────────────────────
 *
 * 1. `scripts/check-data-registry.mjs` 가 **마이그레이션이 만든 표를 전부 훑어**, 여기
 *    등록되지 않은 표가 있으면 빌드를 멈춥니다. 새로 생기는 자리가 규칙 밖으로 새 나가지
 *    못하게 하는 것이 요점입니다 - 사람의 기억에 맡기면 반드시 빠집니다.
 * 2. 「중복 열쇠」와 「내리기 함수」가 비어 있으면 **이유를 적게** 합니다. 비워두는 것은
 *    쉬워야 하지만, 왜 비웠는지는 남아야 합니다.
 *
 * 이 파일이 **하지 않는** 일: 자료를 실제로 넣거나 내리지 않습니다. 여기는 지도이고,
 * 일하는 것은 각 갈래의 apply/undo 함수입니다. 지도가 일까지 하면 모든 화면이 이 파일을
 * 거치게 되어, 한 줄 고칠 때마다 앱 전체가 흔들립니다.
 */

export type DedupeKey =
  /** 이 칸들이 모두 같으면 같은 자료입니다. DB 의 unique 색인과 **같은 값**이어야 합니다. */
  | { by: string[] }
  /** 중복을 막지 않는 표. 왜 안 막는지 적습니다(기록·로그처럼 쌓이는 것이 맞는 표). */
  | { none: string };

export type DataKindDef = {
  /** 사람이 부르는 이름. 화면·보고서에 그대로 씁니다. */
  key: string;
  /** 이 종류의 자료가 **모이는 단 한 곳**. 여기가 정답이고 나머지는 사본입니다. */
  canonical: string;
  /** 정식 표에 딸린 표들. 정식 표의 줄이 바뀌거나 사라지면 **함께 봐야 합니다.** */
  satellites: string[];
  dedupe: DedupeKey;
  /** 넣는 일을 하는 함수(파일 경로). 화면이 표를 직접 고치지 않고 이걸 부릅니다. */
  apply: string | null;
  /** 되돌리는 일을 하는 함수. **null 이면 한 곳에서 지워도 다른 곳에 남습니다.** */
  undo: string | null;
  /**
   * 넣기·내리기가 아직 짝이 아니면 그 사실을 적습니다. 숨기지 않습니다.
   *
   * **여기 적힌 것은 「고쳐야 하는 것」입니다.** 일부러 짝을 안 둔 것은 아래 `byDesign`
   * 으로 갈랐습니다 - 섞어두면 고칠 목록이 줄지 않고, 줄지 않는 목록은 아무도 안 봅니다.
   */
  gap: string | null;
  /**
   * **일부러 짝을 두지 않은 것.** 고칠 일이 아니라 정해진 일입니다.
   *
   * 그래도 적어 둡니다 - 「왜 여긴 내리는 길이 없지?」를 다음 사람이 다시 묻지 않도록.
   */
  byDesign: string | null;
  /** 사람이 가르친 규칙이 담긴 표. 이 종류를 해석할 때 **반드시 함께 읽습니다.** */
  rules: string[];
};

/**
 * ── 갈래 ────────────────────────────────────────────────────────────────────
 *
 * 「전수 조사」(docs/데이터-이어짐-전수조사.md)에서 센 다섯 갈래를 그대로 씁니다. 새로
 * 만든 분류가 아니라 **이미 있는 구조를 적어 둔 것**입니다 - 없는 분류를 새로 만들면
 * 코드와 문서가 서로 다른 세계를 말하게 됩니다.
 */
export const DATA_KINDS: DataKindDef[] = [
  {
    key: "학생",
    canonical: "wr_students",
    satellites: [
      "wr_classes",
      "wr_term_class_snapshots",
      "student_groups",
      "student_group_members",
      "student_apparel_sizes",
      "student_dismissal_plans",
      "student_fee_items",
      "toddle_channel_students",
      "student_dup_dismissals",
      "student_absence_docs",
      // 오늘 이 아이에 대해 알아야 할 것(약·결제·준비물). 학생 줄이 사라지면 함께
      // 사라집니다(on delete cascade) - 그 아이가 없으면 그 아이의 오늘도 없습니다.
      "student_day_notes",
    ],
    // 학생은 이름으로 겹칩니다(김재이가 셋). 학생 번호가 유일한 열쇠입니다.
    dedupe: { by: ["id"] },
    apply: "src/lib/classAssign.ts",
    undo: null,
    gap: null,
    byDesign:
      "학생을 지우는 길은 **일부러 없습니다.** 졸업·전학은 status 로만 표시하고 줄은 남깁니다 - " +
      "지우면 그 아이의 지난 청구·출결이 함께 사라지고, 몇 년 뒤 «그때 얼마를 냈나»에 답할 수 없습니다.",
    rules: ["attendance_learning_rules", "toddle_channel_students"],
  },
  {
    key: "픽업",
    canonical: "pickup_requests",
    satellites: ["pickup_schedules", "pickup_sender_feedback", "shuttle_boardings", "attendance_entries", "tasks", "toddle_channels", "teacher_office_requests"],
    dedupe: { by: ["source", "source_ref"] },
    apply: "src/lib/pickupIngest.ts",
    undo: "src/lib/pickupUndo.ts",
    gap: null,
    byDesign:
      "연락을 **내리는** 자리는 둘뿐이고(인박스 「무시」·「픽업 아님」) 둘 다 `pickupUndo` 를 지납니다. " +
      "나머지 자리(확정·업무 만들기·답변 표시·다시 읽기·되짚어 채우기)는 내리는 일이 아니라 **붙이거나 고치는** 일이라 " +
      "되돌릴 자국이 없습니다. 예약 취소(`pickup_schedules`)도 이제 업무 카드를 함께 내립니다.",
    rules: ["attendance_learning_rules", "toddle_channel_students"],
  },
  {
    key: "출결",
    canonical: "attendance_entries",
    satellites: ["attendance_records", "attendance_coverage", "school_days"],
    dedupe: { by: ["source", "source_message_id", "student_name", "status"] },
    apply: "src/lib/attendanceEntries.ts",
    undo: "src/lib/attendanceUndo.ts",
    gap: null,
    byDesign:
      "담임이 출석부에서 직접 찍은 줄(`confirmed_by_human`)은 **되돌리지 않습니다.** " +
      "그날 교실에서 보고 찍은 값이 인박스 판단보다 셉니다 - 몇 줄을 안 건드렸는지 세어서 화면에 적습니다.",
    rules: ["attendance_learning_rules"],
  },
  {
    key: "셔틀",
    canonical: "shuttle_assignments",
    satellites: ["shuttle_boardings", "shuttle_ride_alongs", "shuttle_checklist_log", "shuttle_persistent_notes", "shuttle_stops"],
    dedupe: { by: ["service_date", "assignment_id"] },
    apply: "src/lib/pickups.ts",
    undo: "src/lib/pickupUndo.ts",
    gap: null,
    byDesign:
      "(service_date, assignment_id) 유일 색인을 데이터베이스가 지킵니다" +
      "(20261005000000_boarding_unique.sql — 이미 있으면 그대로 두고, 겹친 줄이 있으면 먼저 정리합니다). " +
      "겹친 줄이 생겼는지는 `select * from shuttle_boarding_duplicates;` 로 언제든 봅니다. 비어 있어야 정상입니다.",
    rules: [],
  },
  {
    key: "재무",
    canonical: "invoices",
    satellites: [
      "invoice_lines",
      "payments",
      "cash_receipts",
      "fee_items",
      "fee_plans",
      "fee_discounts",
      "student_fee_items",
      "student_fee_discounts",
      "student_fee_enrollments",
      "apparel_orders",
      "apparel_order_items",
      "apparel_order_pieces",
      // 마감한 달. 닫힌 달의 청구서·입금은 고칠 수 없습니다(트리거).
      "finance_month_closes",
      // 올린 파일과 그 줄들. 승인하기 전까지는 어떤 집계에도 안 잡힙니다.
      "payment_imports",
      "payment_import_rows",
    ],
    dedupe: { by: ["student_id", "term_id", "kind"] },
    apply: "src/app/api/finance/invoices",
    undo: "src/app/api/finance/invoices/cancel/route.ts",
    gap: null,
    byDesign:
      "청구서를 취소하면 그 청구서의 현금영수증 **신청**도 함께 내립니다. " +
      "**이미 발행된 것은 건드리지 않습니다** - 종이가 이미 나갔고 국세청에도 올라갔으므로 앱에서 상태만 바꾼다고 없던 일이 " +
      "되지 않습니다. 몇 건이 남았는지 세어 화면이 「취소 신고는 따로 해주세요」라고 적습니다.",
    rules: [],
  },
  {
    key: "업무",
    canonical: "tasks",
    satellites: ["board_notes", "board_revisions", "work_notices", "day_reminders", "work_tags"],
    dedupe: { none: "업무는 같은 내용이 여러 번 생겨도 각각 다른 일입니다. 픽업에서 생기는 업무만 pickup_requests.task_id 로 한 번만 만듭니다." },
    apply: "src/lib/pickupTask.ts",
    undo: "src/lib/pickupUndo.ts",
    gap: null,
    byDesign: null,
    rules: [],
  },
];

/** 자료가 아니라 **기록**인 표. 쌓이는 것이 맞고, 중복을 막지 않습니다. */
export const LOG_TABLES = [
  "finance_access_log",
  // 청구 합계가 바뀐 내력. 트리거가 항목에서 합계를 다시 셀 때마다 한 줄 남습니다 -
  // 돈이 바뀌면 왜 바뀌었는지 물어볼 곳이 있어야 합니다.
  "invoice_amount_log",
  "fee_discount_log",
  "fee_item_price_log",
  "data_export_log",
  "data_restore_log",
  "roster_sync_attempts",
  "shuttle_route_vehicle_history",
  "shuttle_checklist_log",
  "classroom_calls",
  "apparel_stock_moves",
  "apparel_exchanges",
  // 교직원이 어느 화면을 언제 얼마나 봤나. 학교 운영 자료가 아니라 **화면 사용량**을
  // 세는 기록이라, 어느 갈래에도 붙지 않고 혼자 쌓입니다.
  "usage_events",
];

/** 어느 갈래에도 안 붙는 표. **왜 안 붙는지** 적습니다 - 이유 없이는 뺄 수 없습니다. */
export const UNFILED: Record<string, string> = {
  // 바깥 서비스에서 **받아 적는** 자료. 우리가 만드는 것이 아니라 그쪽이 진짜입니다.
  "google_chat_spaces": "구글챗의 방 목록. 우리 자료가 아니라 받아 적는 자료입니다.",
  "google_chat_members": "구글챗의 사람 번호. @멘션에 씁니다.",
  "google_chat_event_subscriptions": "구글챗 구독 상태.",

  // 기준표 — 다른 갈래가 가리키기만 하고, 그 자체로 늘어나지 않습니다.
  "fee_terms": "학기 목록. 재무가 참조하는 기준표입니다.",
  "fee_categories": "요금 분류 기준표.",
  "fee_payment_options": "납부 방법 기준표.",
  "wr_subject_colors": "과목 색 기준표. 시간표 화면만 씁니다.",

  // 글·메모 — 다른 표와 이어지지 않습니다.
  "academic_checklist_meetings": "회의록. 자료가 아니라 글입니다.",
  "classroom_notes": "교실 태블릿 메모. 학생에 붙지만 다른 화면이 읽지 않습니다.",

  // 열쇠·표시 — 자료가 아닙니다.
  "classroom_links": "로그인 없이 여는 화면의 열쇠입니다.",
  "version_broadcasts": "새로고침 안내를 띄운 기록입니다.",
  "error_resolutions": "오류를 고쳤다고 표시한 자리. 학교 자료가 아니라 우리 판단입니다.",
};

export function kindOfTable(table: string): DataKindDef | null {
  return DATA_KINDS.find((k) => k.canonical === table || k.satellites.includes(table)) ?? null;
}

/** 짝이 없는 갈래. 개발자 화면이 이 목록을 그대로 띄웁니다 - 숨기면 아무도 안 고칩니다. */
export function openGaps(): { key: string; gap: string }[] {
  return DATA_KINDS.filter((k) => k.gap).map((k) => ({ key: k.key, gap: k.gap as string }));
}

/**
 * **일부러 짝을 두지 않은 자리.** 고칠 목록이 아니라 「이렇게 정했다」는 기록입니다.
 *
 * 고칠 것과 섞어두면 목록이 줄지 않고, 줄지 않는 목록은 아무도 안 봅니다.
 */
export function byDesignNotes(): { key: string; note: string }[] {
  return DATA_KINDS.filter((k) => k.byDesign).map((k) => ({ key: k.key, note: k.byDesign as string }));
}
