export type WritingStatusName = 'pending' | 'grading' | 'graded' | 'reviewed' | 'delivered' | 'failed';

export interface WritingStatusPayload {
  essayId: string;
  status: WritingStatusName;
  errorMessage: string | null;
  etaSeconds: number;
  gradingTier: 'quick' | 'standard' | 'deep' | 'instructor';
  createdAt: string;
  attemptCount: number;
  maxAttempts: number;
  attemptFailures: number;
  lastFailure: { attempt: number; model: string | null; kind: string | null; message: string | null; at: string | null } | null;
  malformedOptional: number;
}
