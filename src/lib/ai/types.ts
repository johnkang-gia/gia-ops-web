export type IncidentClassifyResult = {
  targetDoc: "학부모용" | "실무자용" | "둘다";
  category: string;
  isNewCategory: boolean;
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
