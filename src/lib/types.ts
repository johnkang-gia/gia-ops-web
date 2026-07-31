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

export type AppUser = {
  email: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
};
