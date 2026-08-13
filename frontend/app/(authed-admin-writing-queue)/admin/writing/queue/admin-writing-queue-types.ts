export type QueueLane = 'grading' | 'graded' | 'reviewed' | 'delivered' | 'all' | 'mock';
export type QueueFilters = { lane: QueueLane; cohortId: string; overdue: boolean; embed: boolean };
export type QueueRow = {
  id: string; studentId: string | null; studentName: string | null; studentCode: string | null;
  taskType: string; status: string; analysisLevel: number | null; selectedModel: string | null;
  wordCount: number; createdAt: string | null; deliveredAt: string | null; errorMessage: string | null;
  sittingId: string | null; gradingSkippedAt: string | null; band: number | null;
  deadline: string | null; task1ImageMissing: boolean;
};
export type QueueCohort = { id: string; name: string };
export type QueueBanner = null | { kind: 'success' | 'error'; text: string };
export type QueueConfirm = null | { kind: 'deliver'; ids: string[] } | { kind: 'skip' | 'grade'; row: QueueRow };
