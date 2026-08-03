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
  status: string | null;
  term_id: string | null;
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
  source: "incidents" | "events" | "meetings" | "manual" | "complaint";
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
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
};

export type ManualSection = {
  id: string;
  target_doc: string;
  category: string;
  content: string;
  requires_signature: boolean;
  updated_at: string;
};

export type SchoolDocument = {
  id: string;
  case_id: string;
  name: string;
  category: string | null;
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
  term_id: string | null;
  origin_mode: "나" | "전체" | "공유";
  recurrence: TaskRecurrence;
  recurrence_group_id: string | null;
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
  address: string | null;
  note: string | null;
  status: "active" | "inactive";
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
