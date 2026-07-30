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
  targetDoc: "학부모용" | "실무자용" | "향후계획";
  finalText: string;
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
