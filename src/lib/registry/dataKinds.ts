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
  /** 넣기·내리기가 아직 짝이 아니면 그 사실을 적습니다. 숨기지 않습니다. */
  gap: string | null;
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
    ],
    // 학생은 이름으로 겹칩니다(김재이가 셋). 학생 번호가 유일한 열쇠입니다.
    dedupe: { by: ["id"] },
    apply: "src/lib/classAssign.ts",
    undo: null,
    gap: "학생을 지우는 길이 없습니다. 졸업·전학은 status 로만 표시하고 줄은 남깁니다 - 지난 청구·출결이 함께 사라지면 안 됩니다.",
    rules: ["attendance_learning_rules", "toddle_channel_students"],
  },
  {
    key: "픽업",
    canonical: "pickup_requests",
    satellites: ["pickup_schedules", "pickup_sender_feedback", "shuttle_boardings", "attendance_entries", "tasks", "toddle_channels", "teacher_office_requests"],
    dedupe: { by: ["source", "source_ref"] },
    apply: "src/lib/pickupIngest.ts",
    undo: "src/lib/pickupUndo.ts",
    gap: "pickup_requests 의 상태를 바꾸는 자리 7곳 중 2곳만 undo 를 거칩니다. 나머지 5곳은 각자 처리합니다.",
    rules: ["attendance_learning_rules", "toddle_channel_students"],
  },
  {
    key: "출결",
    canonical: "attendance_entries",
    satellites: ["attendance_records", "attendance_coverage", "school_days"],
    dedupe: { by: ["source", "source_message_id", "student_name", "status"] },
    apply: "src/lib/attendanceEntries.ts",
    undo: null,
    gap: "출결을 내리는 짝 함수가 없습니다. 지금은 state='무시' 로 바꾸는 코드가 화면마다 따로 있습니다.",
    rules: ["attendance_learning_rules"],
  },
  {
    key: "셔틀",
    canonical: "shuttle_assignments",
    satellites: ["shuttle_boardings", "shuttle_ride_alongs", "shuttle_checklist_log", "shuttle_persistent_notes", "shuttle_stops"],
    dedupe: { by: ["service_date", "assignment_id"] },
    apply: "src/lib/pickups.ts",
    undo: "src/lib/pickupUndo.ts",
    gap: "shuttle_boardings 에 (service_date, assignment_id) unique 색인이 없습니다. 코드로만 막고 있어, 두 사람이 동시에 누르면 두 줄이 생길 수 있습니다.",
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
    ],
    dedupe: { by: ["student_id", "term_id", "kind"] },
    apply: "src/app/api/finance/invoices",
    undo: "src/app/api/finance/invoices/cancel/route.ts",
    gap: "청구서를 취소해도 cash_receipts 는 그대로 남습니다. 화면에서 가리고 있을 뿐이라 현금영수증 화면과 숫자가 다릅니다.",
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
    rules: [],
  },
];

/** 자료가 아니라 **기록**인 표. 쌓이는 것이 맞고, 중복을 막지 않습니다. */
export const LOG_TABLES = [
  "finance_access_log",
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
