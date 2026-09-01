// 기존 구글 시트(v18 .gs)의 사건기록/회의록/행사기록 열 구성과 필드명을 그대로 맞춘 타입입니다.
// (case_id 형식도 genId('INC') 등 기존 방식과 동일하게 유지 - 이전 데이터와 값이 섞여도 구분/정렬이 자연스럽게 됩니다.)

export type Incident = {
  id: string;
  case_id: string;
  date: string; // yyyy-MM-dd
  title: string;
  detail: string | null;
  good: string | null;
  lack: string | null;
  suggest: string | null;
  owner: string | null;
  students: string | null;
  manual_cat: string | null;
  // 운영계획안(학부모용) 항목 태그 - policy_categories(target_doc='학부모용')의 category 값을
  // 참조합니다(요청: "그 항목을 기준으로 사건,회의,운영계획안을 항목화 해줘").
  op_plan_cat: string | null;
  status: string | null;
  term_id: string | null;
  // 요청: "사건이 어떻게 완료되었는지 적을 수 있는 조치사항 공간을 만들어줘 - 어떤 조치를
  // 취했는지 적을 수 있도록". good/lack/suggest(회고·제안)와 별개로, 실제로 취한 조치를
  // 남기는 칸입니다(업무탭 tasks.resolution_note와 같은 패턴).
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type Meeting = {
  id: string;
  case_id: string;
  date: string;
  attendees: string | null;
  content: string;
  status: string | null;
  next_agenda: string | null;
  final_record: string | null;
  source_chat: { role: "user" | "assistant"; content: string; at: string }[] | null;
  audio_path: string | null;
  term_id: string | null;
  // 매뉴얼(실무자용)/운영계획안(학부모용) 항목 태그 - incidents와 마찬가지로
  // policy_categories의 category 값을 참조합니다.
  manual_cat: string | null;
  op_plan_cat: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRecord = {
  id: string;
  case_id: string;
  date: string;
  name: string;
  owner: string | null;
  good: string | null;
  lack: string | null;
  suggest: string | null;
  status: string | null;
  kind: "regular" | "adhoc";
  photo_paths: string[];
  created_at: string;
  updated_at: string;
};

export type Term = {
  id: string;
  case_id: string;
  term_type: string;
  year: string;
  start_date: string | null;
  end_date: string | null;
  status: "진행중" | "종료";
  good: string | null;
  lack: string | null;
  suggest: string | null;
  photo_paths: string[];
  created_at: string;
  updated_at: string;
};

// 학사일정 - 반복되는 학교 업무(체크리스트)를 학기 시작일/종료일 기준 D-day로 자동 등록하기
// 위한 두 테이블입니다. 템플릿(academic_checklist_templates)은 관리자가 미리 정의해두는
// "규칙"이고(예: "학생명단 확정, 학기 시작 14일 전"), 항목(academic_checklist_items)은 실제
// 학기에 맞춰 계산된 날짜가 붙은 "발생 건"입니다(예: 2026년 여름학기의 그 규칙 → 2026-06-10).
export type ChecklistAnchor = "term_start" | "term_end";

export type ChecklistTemplate = {
  id: string;
  title: string;
  description: string | null;
  department: string | null;
  anchor: ChecklistAnchor;
  offset_days: number;
  active: boolean;
  sort_order: number;
  // ── 아래는 학사일정 자동화(요청 ④⑤⑥)에서 더한 칸들 ──
  /** 기간(일). 0이면 하루짜리 - 지금까지 만들어진 항목은 전부 여기 해당합니다. */
  duration_days: number;
  /** 회의가 필요한 일인가. 켜면 항목과 함께 회의 줄이 만들어집니다. */
  needs_meeting: boolean;
  /** 몇 번 모일지. 담당자 기준 최소 2번. */
  meeting_count: number;
  /** 회의 간격(일). 주당 1번이 기본이라 7. */
  meeting_interval_days: number;
  /** 업무보드에 저절로 올릴지. */
  auto_task: boolean;
  /** 마감 며칠 전에 업무로 올릴지. */
  task_lead_days: number;
  /** 매 학기 되풀이되는 일인가(학기준비 분석용). */
  recurring: boolean;
  created_at: string;
  updated_at: string;
};

export type ChecklistItem = {
  id: string;
  template_id: string | null;
  term_id: string | null;
  title: string;
  description: string | null;
  department: string | null;
  /** 기간의 시작이자 하루짜리일 때의 그 날. 이름은 옛것 그대로 둡니다(읽는 곳이 많습니다). */
  due_date: string;
  /** 기간의 끝. null이면 due_date 하루짜리. */
  end_date: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  note: string | null;
  /** 업무보드에 올라간 업무. 채워져 있으면 다시 올리지 않습니다. */
  task_id: string | null;
  task_created_at: string | null;
  created_at: string;
  updated_at: string;
};

// 학사일정 항목에 딸린 회의(요청 ⑤).
// 담당자: "적어도 2주에 걸쳐 2번의 회의 - 주당 1번, 그 한 주 동안 일을 맡아 처리하고 다시
//         모여서 처리한 일과 결정한 일에 대해 회의."
// 회의마다 자기 날짜와 자기 완료 여부가 있어야 "2차는 했고 3차는 안 했다"를 적을 수 있습니다.
export type ChecklistMeeting = {
  id: string;
  item_id: string;
  term_id: string | null;
  seq: number;
  meet_date: string;
  title: string | null;
  note: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  task_id: string | null;
  task_created_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualDraft = {
  id: string;
  case_id: string;
  target_doc: string | null; // AI가 판단하기 전까지는 비어있음(학부모용/실무자용/둘다)
  raw_text: string;
  scanned_at: string | null;
  created_at: string;
};

export type Proposal = {
  id: string;
  case_id: string;
  source: "incidents" | "events" | "meetings" | "manual" | "complaint" | "system";
  source_id: string | null;
  date: string;
  target_doc: string;
  category: string;
  remediation: string | null;
  parent_msg: string | null;
  student_edu: string | null;
  final_text: string;
  legal_basis: string | null;
  applicability: string | null;
  legal_summary: string | null;
  benchmark: string | null;
  status: string;
  reflected_at: string | null;
  // 정책영역(운영계획안/실무자매뉴얼 상위 분류) - AI 분류 시 기존 값 중에서 고르므로 새 항목이
  // 만들어져도 카테고리가 무한정 늘어나지 않습니다.
  domain: string | null;
  created_at: string;
  updated_at: string;
};

// proposals 카드에 "이 제안이 어떤 사건/행사/회의/초안에서 나온 건지" 개요를 보여주기 위한
// 원본 기록 요약입니다(요청 7번). `${source}:${source_id}` 키로 조회합니다.
export type ProposalSourceContext = {
  title: string;
  detail: string;
  date: string;
};

export type Adopted = {
  id: string;
  case_id: string;
  source_id: string;
  source: string;
  date: string;
  target_doc: string;
  category: string;
  ai_original: string | null;
  specific_text: string;
  guide: string | null;
  legal_basis: string | null;
  applicability: string | null;
  legal_summary: string | null;
  benchmark: string | null;
  publish: boolean;
  published_at: string | null;
  review_result: {
    potentialComplaints: string[];
    blindSpots: string[];
    suggestions: string[];
    summary: string;
    reviewedText: string; // 이 검증이 이뤄졌을 당시의 specific_text 스냅샷(이후 수정 여부 비교용)
  } | null;
  review_count: number;
  last_reviewed_at: string | null;
  // source가 "system"(GIA시스템 제안)일 때만 채워집니다 - 발행되는 순간 이 gia_systems 행을
  // 자동으로 "보유"로 갱신합니다(/api/adopted/publish).
  system_ref_id: string | null;
  domain: string | null;
  created_at: string;
  updated_at: string;
};

// 매뉴얼 항목이 어느 사건/행사/회의/AI매뉴얼초안에서 비롯됐는지의 역참조입니다(요청: "사건기록,
// 회의록,ai매뉴얼은 유기적으로 맞물려서..."). upsert_manual_section이 발행 때마다 누적합니다.
export type ManualSectionSource = {
  source: "incidents" | "events" | "meetings" | "manual" | "complaint" | "system";
  source_id: string;
  added_at: string;
};

export type ManualSection = {
  id: string;
  target_doc: string;
  category: string;
  content: string;
  requires_signature: boolean;
  domain: string | null;
  sources: ManualSectionSource[];
  updated_at: string;
};

export type ManualSectionHistory = {
  id: string;
  section_id: string;
  target_doc: string;
  category: string;
  content: string;
  changed_by: string | null;
  changed_at: string;
};

export type ManualReviewFlag = {
  id: string;
  section_id: string;
  reason: "오래됨" | "사건급증";
  detail: string | null;
  resolved: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type SchoolDocument = {
  id: string;
  case_id: string;
  name: string;
  category: string | null;
  // GIA시스템(gia_systems)과 같은 대분류 체계를 서류함에도 그대로 적용하기 위한 컬럼입니다(요청:
  // "서류함에 만들때에도 이 분류를 그대로 적용해서 서류도 자동으로 분류화 되도록"). GIA시스템
  // 항목에서 "서류함에 만들기"로 생성된 서류가 아니면 비어있을 수 있습니다.
  category_major: string | null;
  gia_system_id: string | null;
  status: "필요" | "준비중" | "보유" | "만료임박" | "해당없음";
  notes: string | null;
  ai_draft: string | null;
  created_at: string;
  updated_at: string;
};

export type Todo = {
  id: string;
  user_email: string;
  text: string;
  for_date: string;
  due_at: string | null;
  done: boolean;
  notified: boolean;
  created_at: string;
  updated_at: string;
};

export type TaskStatus = "예정" | "진행중" | "완료" | "보류";

export type TaskAck = { email: string; time: string };

// 반복 업무 - 완료 처리되는 순간 이 규칙을 바탕으로 다음 회차를 자동 생성합니다.
// weekly는 weekday(0=일~6=토), monthly는 day_of_month(1~31, 그 달 마지막날보다 크면
// 마지막날로 자동 보정)를 씁니다. daily는 추가 필드가 필요 없습니다.
export type TaskRecurrence = {
  freq: "daily" | "weekly" | "monthly";
  weekday?: number;
  day_of_month?: number;
} | null;

export type Task = {
  id: string;
  case_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: "보통" | "긴급";
  department: string | null;
  owner_email: string;
  assignee_emails: string[];
  position: number;
  due_at: string | null;
  acknowledged_by: TaskAck[];
  updated_by: string | null;
  completed_at: string | null;
  archived_at: string | null;
  // 이 업무를 어떻게 처리/완료했는지 기록하는 처리사항입니다(요청: "아래부분은 이 업무가
  // 어떻게 완료되었는지 처리사항을 기록하도록"). tasks 행 자체에 저장되므로 완료 후
  // archived_at만 채워지는 보관 처리(cron)를 거쳐도 그대로 남아, 업무기록·업무 보고서에서
  // "업무 + 업무결과"로 함께 볼 수 있습니다.
  resolution_note: string | null;
  term_id: string | null;
  origin_mode: "나" | "전체" | "공유";
  recurrence: TaskRecurrence;
  recurrence_group_id: string | null;
  // 선행 업무(요청: "업무 선후관계 표시") - 이 업무를 시작하려면 먼저 끝나야 하는 다른
  // 업무를 가리킵니다. 강제로 막지는 않고(팀 운영 특성상 예외가 잦음) 화면에 경고만 보여줍니다.
  depends_on_task_id: string | null;
  // 소프트 삭제(요청: "삭제 휴지통 7일 복구") - null이 아니면 삭제된 것으로 취급합니다.
  // RLS가 일반 조회에서는 자동으로 걸러내고, 삭제한 지 7일 이내면 본인/담당자/관리자에게만
  // 휴지통 화면에서 보입니다.
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  uploader_email: string;
  file_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_email: string;
  content: string;
  department: string | null;
  is_system: boolean;
  is_issue: boolean;
  created_at: string;
};

export type DepartmentMemo = {
  department: string;
  content: string;
  updated_by: string | null;
  updated_at: string;
  // 출결내역 패널 전용 메모(요청: "부서 메모는 그냥 반영하지 말고... 출결 메모로 적을 수 있게").
  // 위 content(부서 공유 메모)와 완전히 독립된 값으로, 자동 파싱되지 않는 순수 메모입니다.
  attendance_memo: string;
  attendance_memo_updated_by: string | null;
  attendance_memo_updated_at: string | null;
};

export type TaskModeColor = {
  mode: "나" | "전체" | "공유";
  color: string;
};

export type Department = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  department: string;
  author_email: string;
  content: string;
  source_department: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  pinned_at: string | null;
  pinned_by: string | null;
  created_at: string;
};

export type MessageReaction = {
  id: string;
  message_id: string;
  department: string;
  emoji: string;
  author_email: string;
  created_at: string;
};

export type MessageRead = {
  department: string;
  user_email: string;
  last_read_at: string;
};

export type Inquiry = {
  id: string;
  case_id: string;
  category: "오류" | "기능제안" | "기타";
  title: string;
  content: string;
  status: "접수" | "처리중" | "완료";
  reporter_email: string;
  developer_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export type ErrorLog = {
  id: string;
  route: string;
  message: string;
  stack: string | null;
  user_email: string | null;
  created_at: string;
};

export type AiUsageLog = {
  id: string;
  route: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  success: boolean;
  error_message: string | null;
  created_at: string;
};

export type AiFeatureFlag = {
  key: string;
  label: string;
  group_name: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
};

// 데이터 백업/복원(관리자·개발자 전용) - snapshot은 실제 백업 내용(테이블별 행 배열)이라
// 용량이 커질 수 있어, 목록 화면에서는 이 필드를 빼고 조회합니다(id/label/created_by/
// created_at/tables만). 복원 실행 시에는 snapshot을 직접 다루지 않고 restore_backup(id)
// RPC 하나만 호출하므로, 클라이언트가 snapshot 전체를 내려받을 일 자체가 없습니다.
export type BackupSummary = {
  id: string;
  label: string | null;
  created_by: string;
  created_at: string;
  tables: string[];
};

export type Department3 = "유치부" | "초등부" | "중고등부";
// 보이는 직위. 재무 열쇠(finance_access)는 여기 들어가지 않습니다 - 그건 직위가 아니라
// 따로 주는 열쇠이고, 개발자·최고관리자에게만 보입니다(src/lib/roles.ts 참고).
export type StaffPosition = "교사" | "행정직원" | "관리자" | "최고관리자" | "개발자";

export type AppUser = {
  email: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  name: string | null;
  department: Department3 | null;
  position: StaffPosition | null;
  avatar_url: string | null;
  hire_date: string | null;
  leave_date: string | null;
  /**
   * 재무 열쇠. 돈에 관한 화면을 볼 수 있는가.
   *
   * 직위와 별개입니다. 재무관리자 = position '관리자' + finance_access true이며, 그래서
   * 남들에게는 그냥 관리자로 보입니다 - 숨기는 게 아니라 실제로 관리자입니다.
   * 이 칸은 개발자·최고관리자 화면에서만 노출합니다.
   */
  finance_access?: boolean;
};

// 교직원 통합기록의 연도/학기별 이력 한 줄(학생의 WrEnrollment와 같은 역할) - 소속·직위·담당
// 반/역할이 그 시점 스냅샷으로 남습니다.
export type StaffAssignment = {
  id: string;
  staff_email: string;
  term_id: string | null;
  department: Department3 | null;
  position: StaffPosition | null;
  role_label: string;
  grade: string | null;
  class_id: string | null;
  note: string | null;
  created_at: string;
};

export type TeamMember = {
  email: string;
  name: string | null;
};

// ===== 위클리 리포트 (Weekly Student Report) =====
export type BadgeValue = "excellent" | "good" | "warning" | "bad";
// 리포트 항목은 **3개**입니다 - 학업 / 생활 / 종합.
//
// 담당자: "선생님들이 항목이 너무 많다고 하셨어. 통합할 건 통합해서 3개 항목으로 줄여줘."
//
// 예전 5개(학업·보완·참여·태도·교우)를 이렇게 묶었습니다.
//   · 학업(academic)     ← 학업 성취 + 보완점
//   · 생활(behavior)     ← 수업 참여 + 생활 태도 + 교우 관계
//   · 종합(teacher_note) ← 학부모께 전달하는 종합 의견 (예전의 '교사 종합 의견')
//
// **칸 이름을 그대로 재사용합니다.** 새 칸을 만들면 이미 쌓인 기록을 전부 옮겨야 하는데,
// 옮기는 순간 원본과 다른 글이 생깁니다. 이름은 좁아 보여도 자료는 그대로 남습니다.
export type EvalCategory = "academic" | "behavior" | "teacher_note";
/** 3개로 줄이기 전에 쓰던 칸. **읽기 전용**입니다 - 지난 기록을 보여줄 때만 씁니다. */
export type LegacyEvalCategory = "improvement" | "participation" | "social";
export type EvalBadges = Partial<Record<EvalCategory | LegacyEvalCategory | "overall", BadgeValue[]>>;

// 위클리 리포트도 운영(gia-ops)과 동일한 학기 체계(Term: 연도+학기유형)를 씁니다 - 더 이상
// 별도의 wr_terms를 쓰지 않습니다. 기존 코드에서 WrTerm을 쓰던 자리는 Term으로 바꿔주세요.
export type WrTerm = Term;

export type WrClass = {
  id: string;
  grade: string | null;
  class_name: string | null;
  teacher_email: string | null;
  sub_teacher_email: string | null;
  // 담임 계정(giamicro.com 이메일)이 아직 없을 때 임시로 이름만 배정해두는 필드입니다.
  // 실제 계정이 생기면 teacher_email을 채우고, 화면에서는 teacher_email이 있으면 그 계정의
  // 이름을 우선 표시하고 없으면 이 이름을 대신 보여줍니다.
  teacher_name: string | null;
  sub_teacher_name: string | null;
  created_at: string;
};

export type WrStudent = {
  id: string;
  student_no: string; // 영구 고유번호(예: GIA-2026-0001) - 동명이인이어도 절대 겹치지 않습니다.
  name: string;
  name_en: string | null;
  grade: string | null;
  class_name: string | null;
  class_id: string | null;
  birth_date: string | null;
  phone: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  gender: "남" | "여" | null;
  allergies: string | null;
  address: string | null;
  // 셔틀 차량탑승 여부 - 체크하면 address를 지오코딩해 lat/lng를 채우고 가까운 노선을 추천합니다.
  shuttle_mode: "없음" | "등원" | "하원" | "등하원";
  lat: number | null;
  lng: number | null;
  geocoded_at: string | null;
  note: string | null;
  // 관리자가 "+ 칼럼 추가"로 직접 만든 항목의 값입니다. 키는 wr_student_field_defs.field_key와
  // 짝을 이루고, 값은 항상 문자열로 저장합니다(숫자/날짜 칼럼도 표시용 문자열로 저장).
  custom_fields: Record<string, string>;
  // active(재학) / 보류(확정 명부에 없어 판단 보류) / inactive(퇴원·전출).
  // '보류'는 초등부 확정 명부에 없던 학생을 담아두는 자리입니다 - 중고등부 명단을 받아 대조하기
  // 전까지는 퇴소로 단정할 수 없어서 따로 둡니다.
  status: "active" | "inactive" | "보류" | "졸업" | "퇴학" | "전출";
  // 부서 - 학년 글자로 추측하지 않고 명시적으로 저장합니다(유치부는 별도 프로그램으로 분리 예정).
  department: "유치부" | "초등부" | "중고등부" | null;
  // 방과후 수업 참여 여부.
  afterschool: boolean;
  // 배우는 악기(하나만) - 없으면 null.
  instrument: WrInstrument | null;
  // 형제자매 묶음 - 같은 집 아이들에게 같은 값을 넣어두면 부서를 넘나들어도 한 가족으로
  // 이어집니다(유치부 동생 ↔ 초등부 형). 셔틀·보호자 연락·출결 이름 대조에 씁니다.
  family_id: string | null;
  created_at: string;
};

export const WR_INSTRUMENTS = ["첼로", "우쿨렐레", "클라리넷", "바이올린", "플룻"] as const;
export type WrInstrument = (typeof WR_INSTRUMENTS)[number];

// 교직원 누구나 볼 수 있는 공용 학생 명부(뷰 wr_students_basic)입니다. 보호자 연락처·주소·좌표
// 같은 개인정보는 빠져 있고, 요청하신 항목만 담겨 있습니다(요청: "이름(영어이름), 나이(생년월일),
// 성별, 방과후수업진행여부, 악기, 셔틀탑승여부, 특이사항(알러지, 형제자매링크 등)").
// 원본 표(wr_students)는 행정직원·관리자·개발자만 읽고 쓸 수 있습니다.
export type WrStudentBasic = Pick<
  WrStudent,
  | "id"
  | "name"
  | "name_en"
  | "grade"
  | "class_name"
  | "class_id"
  | "department"
  | "status"
  | "birth_date"
  | "gender"
  | "afterschool"
  | "instrument"
  | "shuttle_mode"
  | "allergies"
  | "note"
  | "family_id"
  | "created_at"
>;

// 학생 명부에 관리자가 직접 추가한 커스텀 칼럼의 정의입니다.
export type WrStudentFieldDef = {
  id: string;
  field_key: string;
  label: string;
  field_type: "text" | "number" | "date";
  sort_order: number;
  created_by: string | null;
  created_at: string;
};

// 재학 이력(연도/학기별 학년·반·담임 스냅샷) - "몇년도 어느 학기에 이 학생이 몇학년 몇반이었는지"
export type WrEnrollment = {
  id: string;
  student_id: string;
  term_id: string | null;
  grade: string | null;
  class_id: string | null;
  homeroom_teacher_email: string | null;
  created_at: string;
};

// 사건기록 ↔ 학생 구조적 연결(다대다)
export type IncidentStudent = {
  id: string;
  incident_id: string;
  student_id: string;
  created_at: string;
};

export type WrSubject = {
  id: string;
  name: string;
  teacher_email: string | null;
  teacher_name: string | null;
  class_id: string | null;
  color: string | null;
  student_ids: string[];
  created_at: string;
};

// 학기별 반·담임·과목 세팅 보관본.
//
// 지금 세팅(wr_classes / wr_subjects)은 한 벌뿐이라 새 학기 반을 짜면 지난 학기 모습이
// 사라집니다. 학기가 끝날 때 통째로 떠서 여기 값으로 남깁니다(참조가 아니라 값 - 반이
// 없어지거나 교사가 그만두어도 그 학기 기록은 그대로여야 하기 때문입니다).
// 만들고 읽는 곳: src/lib/termSnapshot.ts
export type WrTermClassSnapshot = {
  id: string;
  term_id: string;
  taken_at: string;
  taken_by: string | null;
  classes: {
    grade: string | null;
    class_name: string | null;
    teacher_name: string | null;
    sub_teacher_name: string | null;
    student_count: number;
    students: { name: string; student_no: string | null; grade: string | null }[];
  }[];
  subjects: {
    name: string;
    teacher_name: string | null;
    class_name: string | null;
    color: string | null;
    student_count: number;
    students: string[];
  }[];
  source: string;
  note: string | null;
  created_at: string;
};

// ── 인보이스: 납부 항목과 할인 ───────────────────────────────────────────
// 금액을 하나하나 적어두지 않습니다. 기준 금액 1회분 + 납부 옵션(몇 회분을 묶고 몇 %
// 깎는가)이면 안내문의 숫자가 전부 만들어집니다(검산 완료).
export type FeePlan = {
  id: string;
  category: "학비" | "학비외";
  name: string;
  description: string | null;
  base_amount: number;
  unit: "월" | "학기" | "연" | "회";
  active: boolean;
  sort_order: number;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FeePaymentOption = {
  id: string;
  plan_id: string;
  name: string;
  /** 기준 금액의 몇 회분인가. */
  periods: number;
  /** 0.10 = 10% 할인. */
  discount_rate: number;
  due_note: string | null;
  active: boolean;
  sort_order: number;
  created_at: string;
};

// 할인 규칙. **지우지 않고 끕니다** - 지난 청구서가 왜 그 금액이었는지 설명할 수 있어야
// 합니다. 이 표 전체가 재무 권한 뒤에 있어 이름조차 권한 없는 사람에게는 안 보입니다.
export type FeeDiscount = {
  id: string;
  name: string;
  description: string | null;
  kind: "percent" | "amount";
  value: number;
  category: "학비" | "학비외" | null;
  plan_id: string | null;
  active: boolean;
  effective_from: string | null;
  effective_to: string | null;
  /** 켜면 최고관리자 승인이 있어야 학생에게 붙일 수 있습니다. */
  requires_approval: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WrReport = {
  id: string;
  student_id: string;
  term_id: string | null;
  class_id: string | null; // 작성 시점 학년/반 스냅샷 - 연도-학기-학년-반 통합 검색용
  grade: string | null;
  subject: string;
  academic: string | null;
  improvement: string | null;
  participation: string | null;
  behavior: string | null;
  social: string | null;
  teacher_note: string | null;
  eval_badges: EvalBadges;
  status: "draft" | "published";
  report_date: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type WrComment = {
  id: string;
  student_id: string;
  author_email: string;
  content: string;
  comment_date: string;
  created_at: string;
};

// ===== 관리자 메뉴: 교육뉴스 / GIA시스템 =====
export type EducationNewsItem = {
  category: string;
  headline: string;
  body: string;
  source_name: string | null;
  source_url: string | null;
};

export type EducationNews = {
  id: string;
  case_id: string;
  published_date: string;
  title: string;
  summary: string;
  items: EducationNewsItem[];
  model: string | null;
  created_at: string;
};

export type GiaSystem = {
  id: string;
  // 대분류(예: 재정, 인사·교직원, 학사, 운영, 시설·안전, 입학·홍보, 행정·문서, 정보보안·법무).
  // category(중분류)는 그대로 두고 그 위 단계로 새로 추가했습니다(요청: "재정,운영과 같은
  // 대분류항목에서부터 더 들어가서 운영-교직원-교직원계약서 뭐 이런식으로 항목을 세분화").
  major: string;
  category: string;
  name: string;
  status: "보유" | "부분보유" | "미보유";
  description: string | null;
  benchmark_school: string | null;
  source: "manual" | "ai_suggested";
  adopted_from_id: string | null;
  adopted_at: string | null;
  // 매뉴얼 항목 발행 시 이름이 겹치는 시스템을 AI 호출 없이 매칭해 채워둡니다(요청: "GIA시스템
  // 자동 매칭" - 관리자가 시스템 구비 여부를 수기로 따로 추적할 필요를 줄임).
  related_manual_category: string | null;
  related_manual_target_doc: string | null;
  // "서류함에 만들기" 버튼으로 documents 행을 만들면 그 행을 가리킵니다(이미 만들었으면 다시
  // 만들지 않고 서류함으로 바로 이동하도록).
  document_id: string | null;
  // AI 제안이 "완전히 새로운 시스템"이 아니라 "이미 있는 항목을 더 구체적으로 쪼갠 세분화
  // 제안"일 때, 그 원래 항목 이름을 담아둡니다(요청: "이미 잘 정리해둔 항목들을 마음대로
  // 지우거나 하지 않도록 해줘" - 원본 항목은 절대 건드리지 않고, 이 필드로만 "어떤 항목을
  // 세분화한 제안인지" 표시합니다).
  refines_name: string | null;
  created_at: string;
  updated_at: string;
};

// 운영계획안(학부모용)/매뉴얼(실무자용) 고정 항목 체계 - 요청: "학부모님들께 보낼 운영계획안에
// 들어가면 좋을 항목들을 추려주고, 그 항목을 기준으로 사건,회의,운영계획안을 항목화... 매뉴얼
// 항목도 만들어줘... 모든 항목들은 편집 가능하도록". 지금까지 AI가 그때그때 자유롭게 짓던
// category 이름을 이 고정 목록으로 완전히 대체합니다(사건/회의 AI 분류, 소급 태깅 모두 이
// 목록 중에서만 고릅니다). 관리자·행정직원이 화면에서 추가/수정/삭제할 수 있습니다.
export type PolicyTargetDoc = "학부모용" | "실무자용";
export type PolicyCategoryStatus = "보유" | "부분보유" | "미보유";

export type PolicyCategory = {
  id: string;
  target_doc: PolicyTargetDoc;
  domain: string;
  category: string;
  description: string | null;
  status: PolicyCategoryStatus;
  sort_order: number;
  source: "gia_system" | "benchmark" | "manual";
  gia_system_id: string | null;
  created_at: string;
  updated_at: string;
};

// 구글폼 연동 신청서(학기/행사) 가져오기 - 요청("구글폼에 링크된 구글시트를 연결하면, 분석해서
// ... 학기,이벤트 별로 저장할 수 있도록"). 열 제목(headers) -> 표준 항목(column_mapping)
// 매칭을 "템플릿"으로 저장해두면, 다음에 같은 형식의 시트를 붙여넣을 때 자동으로 알아봅니다.
export type FormImportKind = "term" | "event";

export type FormImportTemplate = {
  id: string;
  name: string;
  kind: FormImportKind;
  // 붙여넣기 전에 먼저 선택하는 분류값입니다(요청: "구글시트 붙여넣기 전에 무슨학기의 어떤
  // 행사인지... 선택해서"). year/term_type은 terms 테이블과 같은 값 체계를 씁니다(@/lib/termTypes)
  // - 아직 terms에 해당 학기 행이 없어도(다음 학기를 미리 준비하는 경우) 먼저 지정할 수 있고,
  // 학기준비 화면에서 term_type으로 지난 같은 학기의 템플릿을 찾아옵니다.
  year: string;
  term_type: string;
  purpose: string;
  headers: string[];
  column_mapping: Record<string, string>;
  created_by: string;
  created_at: string;
  last_used_at: string | null;
};

export type FormSubmission = {
  id: string;
  template_id: string | null;
  kind: FormImportKind;
  // 템플릿(재사용 매칭 규칙)과 달리 이 값은 그 회차에 실제 선택했던 값 그대로 고정됩니다 -
  // 템플릿이 나중에 다른 연도로 재사용되어도 지난 기록 조회에 영향이 없습니다.
  year: string;
  term_type: string;
  purpose: string;
  term_id: string | null;
  event_id: string | null;
  raw: Record<string, string>;
  mapped: Record<string, string>;
  imported_by: string;
  imported_at: string;
};

// 행정요청 기능은 제거되었습니다(요청: "행정요청도 없애줘, 구글챗 미러링이 된다면 행정요청도
// 여기로 받을거라서 상관없어") - staff_requests 관련 테이블은 DB에는 남아있지만(과거 데이터
// 보존용, 기능적으로는 사용하지 않음) 앱에서는 더 이상 읽거나 쓰지 않습니다. 대신 아래
// GoogleChatMirrorMessage로 구글챗 두 방(출결알림/선생님요청)을 실시간 미러링합니다.

// 구글챗 미러링 - 지정된 구글챗 스페이스(출결알림방/선생님요청방)의 메시지를 읽기전용으로
// 실시간 미러링해서 업무탭에서 보고, 필요하면 바로 업무로 등록할 수 있게 합니다(요청: "구글챗과
// 이 앱을 왔다갔다 하지않고 이앱에서 모든 업무작업이 이루어지도록"). 실제 수신은 Google
// Workspace Events API(Pub/Sub) → /api/google-chat/webhook 라우트가 담당합니다.
export type GoogleChatMirrorSourceKey = "attendance" | "teacher_requests";

export type GoogleChatMirrorMessage = {
  id: string;
  source_key: GoogleChatMirrorSourceKey;
  google_message_id: string;
  google_space_id: string | null;
  sender_display_name: string | null;
  sender_email: string | null;
  content: string;
  created_at_google: string;
  received_at: string;
  task_id: string | null;
};

// 학생 출석부(요청: "학생출석부를 교사가 실시간 체크할 수 있게... 결석학생 보호자에게 연락할
// 수 있는 출석부 시스템"). 학생-날짜 조합으로 하루 한 행만 존재합니다.
export type AttendanceStatus = "출석" | "지각" | "결석" | "조퇴" | "기타";

export type AttendanceRecord = {
  id: string;
  student_id: string;
  class_id: string | null;
  date: string;
  status: AttendanceStatus;
  note: string | null;
  checked_by: string | null;
  checked_by_name: string | null;
  checked_at: string | null;
  contacted_guardian: boolean;
  contact_note: string | null;
  contacted_by: string | null;
  contacted_by_name: string | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

// ===== 셔틀(등하원 차량) =====
export type ShuttleDirection = "등원" | "하원";

export type ShuttleRoute = {
  id: string;
  direction: ShuttleDirection;
  route_no: string;
  name: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_no: string | null;
  teacher_name: string | null;
  teacher_phone: string | null;
  depart_time: string;
  sort_order: number;
  active: boolean;
  seat_capacity: number | null; // 차량 정원(몇 인승)
  usable_capacity: number | null; // 실제 탑승 가능 인원(정원보다 적을 수 있음)
  regions: string[]; // 지역별 대시보드용 정규화 지역 태그(자동 백필 후 노선 관리에서 수정)
  // 정규학기 vs 방학 캠프 등 학기 외 임시 셔틀을 구분합니다(요청: "지금 여름캠프2 기간이야...
  // 지금데이터는 정규학기에 사용할예정으로 분류해주고"). 기존 노선은 모두 '정규학기'이고,
  // 실시간 셔틀·파일럿 관리자 화면은 term='정규학기'만 보여줍니다.
  term: "정규학기" | "여름캠프2";
  created_at: string;
  updated_at: string;
};

export type ShuttleStop = {
  id: string;
  route_id: string;
  seq: number;
  stop_time: string | null;
  address: string | null;
  gate: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  gu: string | null;
  dong: string | null;
  geocoded_at: string | null;
  // 실제 주행 GPS에서 학습한 좌표(요청: "gps를 통해서 정류장과... 정확도를 높여서"). 기존
  // lat/lng(주소 지오코딩 결과)를 덮어쓰지 않고 따로 담아두고, 담당자가 확인 후 반영합니다.
  gps_lat: number | null;
  gps_lng: number | null;
  gps_sample_count: number;
  // 정류장/신호대기 판별 근거(v0.245~). 며칠 중 며칠 관측됐는지와 그 비율, 평균 체류시간입니다.
  // 마이그레이션 전 DB에서는 없을 수 있어 옵셔널입니다.
  gps_day_count?: number | null;
  gps_confidence?: number | null;
  gps_dwell_seconds?: number | null;
  gps_updated_at: string | null;
  created_at: string;
};

// Traccar Client(기사님 휴대폰의 무료 위치 전송 앱)와 노선을 연결하는 등록 정보입니다.
export type ShuttleTrackerDevice = {
  id: string;
  device_id: string;
  route_id: string;
  label: string | null;
  enabled: boolean;
  last_seen_at: string | null;
  created_at: string;
  // 기사님께 문자로 보내는 설정 링크(/s/{코드})의 코드. device_id와 따로 두어, 링크가 새어
  // 나가도 이 코드만 새로 발급하면 되고 기사님 휴대폰 설정은 건드리지 않아도 됩니다.
  // 기사님 성함·연락처는 shuttle_routes 쪽 값을 그대로 씁니다.
  setup_code: string | null;
  setup_opened_at: string | null;
  // 시간대와 무관하게 항상 위치를 기록하는 테스트 기기인지(기사님 배포 전 확인용).
  always_on?: boolean;
  // 진단: 앱이 마지막으로 신호를 보낸 시각과 그때 서버 판정('stored'|'out_of_window'|'no_coords').
  last_hit_at?: string | null;
  last_hit_reason?: string | null;
};

// 주행 기록에서 찾아낸 "차가 실제로 멈춰 있던 지점".
export type ShuttleStopObservation = {
  id: number;
  route_id: string;
  service_date: string;
  lat: number;
  lng: number;
  arrived_at: string;
  departed_at: string;
  dwell_seconds: number;
  sample_count: number;
  order_index: number | null;
  matched_stop_id: string | null;
  distance_m: number | null;
  created_at: string;
};

// weekdays: 1=월 ... 5=금. 요일별로 내리는 곳이 다른 학생은 같은 학생이 여러 행을 갖습니다.
export type ShuttleAssignment = {
  id: string;
  stop_id: string;
  student_id: string | null;
  student_name_raw: string;
  class_raw: string | null;
  weekdays: number[];
  guardian_phone: string | null;
  note: string | null;
  created_at: string;
  /**
   * 학생과 연결되지 않은 이유. student_id가 있으면 비어 있습니다.
   * '유치부' = 별도 운영이라 연결하지 않음 / '퇴소' = 명부에 없는(나간) 아이 / '확인필요' = 사람이 봐야 함
   */
  unlinked_reason?: string | null;
};

export type ShuttleBoardingStatus = "예정" | "탑승" | "미탑승" | "결석" | "픽업";

export type ShuttleBoarding = {
  id: string;
  service_date: string;
  assignment_id: string;
  auto_status: "결석" | "픽업" | "지각" | "조퇴" | null;
  status: ShuttleBoardingStatus;
  checked_by: string | null;
  checked_at: string | null;
  // 정류장에서 내렸는지 별도 확인(요청: 2단계-a, 하원 자동화 제안 11장). status(탑승했는지)와
  // 별개로 관리합니다 - 탑승은 했지만 아직 하차 전인 상태를 구분하기 위해서입니다.
  alighted_at: string | null;
  note: string | null;
  created_at: string;
  // 그날 하루만 다른 노선을 타는 경우(요청: "특정 학생이 특정 하루만 다른셔틀을 타는 경우도
  // 있기때문에 표안에서 아이들의 이름을 자유롭게 끌어서 이동할 수 있게"). null이면 평소
  // 배정된 노선 그대로입니다.
  override_route_id: string | null;
};

export type ShuttleRunEvent = {
  id: string;
  service_date: string;
  route_id: string;
  event: "출발" | "5분전" | "도착" | "현장도착";
  created_by: string | null;
  created_at: string;
};

// 노선의 실제 도로 경로(카카오모빌리티 다중경유지 길찾기 결과) 캐시.
export type ShuttleRoutePath = {
  route_id: string;
  path: { lat: number; lng: number }[];
  distance_m: number | null;
  duration_s: number | null;
  legs: { distance_m: number; duration_s: number }[]; // 지점 순서(정류장+GIA)에 대응하는 구간별 소요시간
  stop_ids: string[];
  computed_at: string;
};

// 정식 앱 이전 파일럿 검증용(학부모 제외, 동승선생님만 - 하원 우선 도입) - 로그인 없이 토큰으로만 접속.
export type ShuttlePilotRoute = {
  id: string;
  route_id: string;
  token: string;
  enabled: boolean;
  created_at: string;
};

export type ShuttlePilotPing = {
  id: number;
  route_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
};

// 안내보드(로그인 없는 전용 화면) 링크(요청: "운영앱에서 로그인하지 않고 별도의 페이지로
// 안내보드는 나오도록"). 화면(로비용/복도용 등)마다 유튜브 영상을 따로 설정할 수 있습니다.
export type ShuttleBoardLink = {
  id: string;
  label: string;
  token: string;
  // 요청: "주소가 너무 복잡해서... 짧은 주소로 만들어줘" - 공용컴퓨터 주소창에 바로 입력할 수
  // 있는 짧은 코드입니다(/b/[short_code]로 접속하면 이 안내보드로 자동 연결됩니다). null이면
  // 아직 짧은 주소가 없는(예전에 만든) 링크입니다.
  short_code: string | null;
  youtube_video_id: string | null;
  term: "정규학기" | "여름캠프2";
  enabled: boolean;
  created_at: string;
};

// 교직원이 로그인 없이 링크 하나로 접속해 노선별 "도착"/"출발" 두 버튼만 누르는 단독 화면용
// 링크입니다(요청: "교직원이 모바일로 도착한 차량 누를 수 있는 단독 링크" - 여름캠프처럼 GPS
// 위치 전송이나 학생별 탑승 체크 없이 빠르게 도착·출발만 알리면 되는 경우에 씁니다).
export type ShuttleArrivalLink = {
  id: string;
  label: string;
  token: string;
  term: "정규학기" | "여름캠프2";
  enabled: boolean;
  created_at: string;
};

// 교시 정의 - 부서마다 교시 수와 시각이 달라서 부서별로 둡니다(요청: "지금 시간에 각반이 무슨
// 수업시간인지"를 판단하는 기준).
export type WrPeriod = {
  id: string;
  department: "유치부" | "초등부" | "중고등부";
  period_no: number;
  label: string | null;
  start_time: string; // 'HH:MM:SS'
  end_time: string;
  created_at: string;
};

// 시간표 한 칸 = 어느 반이 무슨 요일 몇 교시에 무슨 수업을 하는지(weekday 1=월 ... 5=금).
export type WrTimetableEntry = {
  id: string;
  class_id: string;
  weekday: number;
  period_id: string;
  subject_name: string;
  subject_id: string | null;
  teacher_name: string | null;
  room: string | null;
  created_at: string;
  updated_at: string;
};

// 사무실 대형 모니터용 통합 운영 대시보드 접속 링크(안내보드와 같은 토큰 방식).
export type OpsBoardLink = {
  id: string;
  label: string;
  token: string;
  default_department: "유치부" | "초등부" | "중고등부";
  // 이 시각(KST)이 되면 대시보드가 통째로 하원 차량 화면으로 바뀝니다.
  shuttle_switch_hour: number;
  shuttle_switch_minute: number;
  // 이 시각이 되면 하원 화면이 끝나고 평소 대시보드(CCTV 반반 배치)로 돌아갑니다. 전체화면도
  // 함께 풀립니다(요청: "종료시간이 되면 다시 화면 되돌리게").
  shuttle_end_hour: number;
  shuttle_end_minute: number;
  shuttle_board_token: string | null;
  // 주소창에 직접 칠 수 있는 짧은 코드입니다(/d/{short_code}로 접속하면 이 대시보드로 자동
  // 연결됩니다). 토큰(36자리)은 그대로 두고 지름길만 하나 더 두는 방식입니다.
  short_code: string | null;
  enabled: boolean;
  created_at: string;
};

// 업무 보드 상단 전체공지(요청: "업무에서 전체공지가 있을경우 바로 상단으로 옮겨지고, 새로운
// 공지가 있으면 이전공지가 사라지고, 다음공지가 상단으로"). 공지는 지우지 않고 쌓아두고 가장
// 최근 것 하나만 상단에 띄웁니다 - 나머지는 히스토리에서 볼 수 있습니다.
export type WorkNotice = {
  id: string;
  scope: "전체" | "부서";
  department: string | null;
  title: string;
  body: string | null;
  author_email: string;
  archived_at: string | null;
  created_at: string;
};

// 안전운행지수(3단계-a) - 급가속·급감속 "기준치 초과 순간"만 기록합니다.
export type ShuttleSafetyEventType = "급가속" | "급감속";

export type ShuttleSafetyEvent = {
  id: number;
  route_id: string;
  service_date: string;
  event_type: ShuttleSafetyEventType;
  magnitude: number | null;
  recorded_at: string;
};

// ── 학비외 수납(교재·악기·수리·교복)과 인보이스 ────────────────────────────
//
// 단가는 fee_items 한 곳에만 있고, 아이별로는 **기본 세트와 다른 것만** 남깁니다.
// 발행한 인보이스는 그 순간의 이름·금액을 베껴 굳혀서, 나중에 값이 올라도 흔들리지 않습니다.

export const FEE_ITEM_CATEGORIES = ["교재", "악기", "악기수리", "교복", "기타"] as const;
export type FeeItemCategory = (typeof FEE_ITEM_CATEGORIES)[number];

export type FeeItem = {
  id: string;
  category: string;
  /** 인보이스에 그대로 찍히는 이름(영문 양식이라 이쪽이 본문). */
  name: string;
  /** 화면에서 고를 때 쓰는 한글 이름. */
  name_ko: string | null;
  unit_price: number;
  /** 기본으로 붙는 학년. 비어 있으면 자동으로 붙지 않습니다. */
  default_grades: string[];
  default_classes: string[];
  term_id: string | null;
  active: boolean;
  sort_order: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type StudentFeeItem = {
  id: string;
  student_id: string;
  item_id: string;
  term_id: string | null;
  /** include = 기본 대상이 아닌데 산다 · exclude = 기본 대상인데 안 산다 */
  mode: "include" | "exclude";
  qty: number;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  invoice_no: string;
  student_id: string | null;
  student_name: string;
  student_name_ko: string | null;
  grade_label: string | null;
  issue_date: string;
  due_date: string;
  total_amount: number;
  status: "발행" | "취소";
  note: string | null;
  issued_by: string | null;
  created_at: string;
};

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  seq: number;
  name: string;
  qty: number;
  unit_price: number;
  amount: number;
};
