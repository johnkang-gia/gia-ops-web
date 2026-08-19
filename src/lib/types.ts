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
  due_date: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  note: string | null;
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
export type StaffPosition = "교사" | "행정직원" | "관리자" | "개발자";

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
export type EvalCategory = "academic" | "improvement" | "participation" | "behavior" | "social";
export type EvalBadges = Partial<Record<EvalCategory | "overall", BadgeValue[]>>;

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
  status: "active" | "inactive";
  created_at: string;
};

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
  class_id: string | null;
  color: string | null;
  student_ids: string[];
  created_at: string;
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
