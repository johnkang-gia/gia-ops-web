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
  created_at: string;
  updated_at: string;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_email: string;
  content: string;
  department: string | null;
  is_system: boolean;
  created_at: string;
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
  created_at: string;
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

export type Department3 = "유치부" | "초등부" | "중고등부";
export type StaffPosition = "교사" | "교직원" | "관리자" | "개발자";

export type AppUser = {
  email: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  name: string | null;
  department: Department3 | null;
  position: StaffPosition | null;
};

export type TeamMember = {
  email: string;
  name: string | null;
};

// ===== 위클리 리포트 (Weekly Student Report) =====
export type BadgeValue = "excellent" | "good" | "warning" | "bad";
export type EvalCategory = "academic" | "improvement" | "participation" | "behavior" | "social";
export type EvalBadges = Partial<Record<EvalCategory | "overall", BadgeValue[]>>;

export type WrTerm = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  is_archived: boolean;
  created_at: string;
};

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
  name: string;
  grade: string | null;
  class_name: string | null;
  parent_phone: string | null;
  note: string | null;
  status: "active" | "inactive";
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
