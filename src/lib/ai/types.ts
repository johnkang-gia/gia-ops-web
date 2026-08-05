export type IncidentClassifyResult = {
  targetDoc: "학부모용" | "실무자용" | "둘다";
  category: string;
  isNewCategory: boolean;
  // 정책영역(운영계획안/실무자매뉴얼 상위 분류) - MANUAL_DOMAINS 중 하나(항목 4번 요청).
  domain: string;
  remediationOptions: string[];
  parentCommunicationOptions: string[];
  studentEducationOptions: string[];
  suggestedFinal: string;
  legalBasis: string;
  legalApplicability: string;
  benchmarkNote: string;
};

export type MeetingProposalItem = {
  category: string;
  targetDoc: "학부모용" | "실무자용" | "행사학기참고" | "향후계획";
  domain?: string;
  finalText: string;
  eventNameGuess?: string;
  referenceKind?: "행사" | "학기";
};

export type MeetingClassifyResult = {
  proposals: MeetingProposalItem[];
  nextAgendaItems: string[];
};

export type ManualDraftClassifyResult = {
  targetDoc: "학부모용" | "실무자용" | "둘다";
  targetDocReason: string;
  category: string;
  isNewCategory: boolean;
  domain: string;
  finalText: string;
  legalBasis: string;
  legalApplicability: string;
  legalSummary: string;
  benchmarkNote: string;
};

export type MeetingCleanupResult = {
  cleanedContent: string;
};

export type DocumentRecommendResult = {
  documents: { name: string; category: string; reason: string }[];
};

export type DocumentDraftResult = {
  draftText: string;
};

// "학교 문서함 > AI 서류 작성" - 담당자가 상황을 자유 문장으로 설명하면(예: 아르바이트 근로계약
// 조건) AI가 문서명/초안을 만들고, GIA시스템 항목 중 맞는 게 있으면 그 분류(대분류/중분류)를
// 그대로 골라서 서류함 저장 시 자동으로 같은 분류 체계에 들어가도록 합니다(요청: "만들어진 문서는
// 자동으로 시스템의 항목으로 분류되어서 들어가도록"). matchedItemName은 GIA시스템 목록 중 정확히
// 일치하는 항목이 있을 때만 그 이름 그대로를 돌려주고(서버가 gia_system_id를 찾는 데 씀), 없으면
// 빈 문자열입니다(지어내지 않음 - 억지로 아무 항목에나 갖다 붙이지 않도록).
export type QuickDocumentDraftResult = {
  suggestedName: string;
  categoryMajor: string;
  category: string;
  matchedItemName: string;
  draftText: string;
};

export type EventCompareResult = {
  improvements: string[];
  recurringIssues: string[];
  recommendation: string;
};

export type ManualFaqResult = {
  faqs: { question: string; answer: string }[];
};

export type ComplaintAnticipateResult = {
  complaints: { category: string; complaintSummary: string; recommendedResponse: string; legalBasis: string }[];
};

export type ComplaintFinalizeResult = {
  finalText: string;
};

export type AdoptedReviewResult = {
  potentialComplaints: string[];
  blindSpots: string[];
  suggestions: string[];
  summary: string;
};

export type MeetingChatResult = {
  reply: string;
  date: string;
  attendees: string;
  organizedContent: string;
  readyToSave: boolean;
};

export type IncidentFillResult = {
  date: string;
  title: string;
  good: string;
  lack: string;
  suggest: string;
};

// 기존 사건/회의를 정책 항목(policy_categories) 고정 목록으로 소급 태깅할 때 쓰는 가벼운
// 분류 결과입니다(요청 확인: "기존 기록도 AI로 훑어서 새 항목에 소급 태깅"). 전체 재분류
// (remediationOptions 등)를 다시 만들지 않고 항목명만 고르므로 값이 단순합니다. 해당하는
// 항목이 정말 없으면 빈 문자열을 둡니다(지어내지 않음).
export type BackfillCategoryResult = {
  manualCat: string;
  opPlanCat: string;
};

// 채팅 메시지를 눌러 "업무로 등록"할 때 AI가 분석해 내는 결과입니다. assigneeNames는 팀원
// 명단(roster)에 실제로 있는 이름만 넣도록 프롬프트에서 강제하고, 서버에서 이름→이메일로
// 다시 매칭합니다(AI가 이메일을 직접 만들어내지 않도록 하기 위함).
export type TaskAnalyzeResult = {
  title: string;
  assigneeNames: string[];
  dueDate: string;
  priority: "보통" | "긴급";
};
