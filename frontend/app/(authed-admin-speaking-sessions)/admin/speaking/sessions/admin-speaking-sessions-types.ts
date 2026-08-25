export type SpeakingSessionFilters = { email: string; mode: string; status: string; error: string; dateFrom: string; dateTo: string };
export type SpeakingSessionRow = {
  id: string; userId: string | null; userEmail: string | null; userLookupFailed: boolean;
  mode: string | null; part: number | null; topic: string | null; status: string | null;
  startedAt: string | null; completedAt: string | null; overallBand: number | null;
  bandFc: number | null; bandLr: number | null; bandGra: number | null; bandP: number | null;
  errorCode: string | null; errorMessage: string | null; failedStep: string | null; lastErrorAt: string | null;
};
export type SpeakingFeedback = { fc: string | null; lr: string | null; gra: string | null; pronunciation: string | null; strengths: string[]; improvements: string[]; grammarIssues: string[]; vocabularyIssues: string[]; sampleAnswer: string | null };
export type SpeakingResponse = { id: string; questionId: string; transcript: string | null; overallBand: number | null; feedback: SpeakingFeedback | null; audioUrl: string | null; audioStored: boolean; gradingStatus: string | null; sttStatus: string | null };
export type SpeakingSessionDetail = SpeakingSessionRow & {
  userDisplayName: string | null; p1SessionId: string | null; p2SessionId: string | null; p3SessionId: string | null;
  fullTestSiblingsLookupFailed: boolean;
  questions: { id: string; text: string | null; order: number | null }[]; responses: SpeakingResponse[];
  malformedQuestions: number; malformedResponses: number; questionsLookupFailed: boolean; responsesLookupFailed: boolean;
};
export type SessionAction =
  | { kind: 'response'; responseId: string; sessionId: string }
  | { kind: 'repair'; sessionId: string }
  | { kind: 'force'; sessionId: string }
  | { kind: 'rebuild'; sessionId: string; detailId: string; full: boolean; p2Id: string | null; p3Id: string | null };
